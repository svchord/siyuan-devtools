/**
 * 截图命令：用 CDP `Page.captureScreenshot` 出图，输出文件路径（数据，走 stdout）。
 *
 * ## 为什么是 `--theme` + `--density` 而不是一个 `--state`
 *
 * 明暗与密度是**两个独立维度**，各对应一个 `<html>` 属性：
 *   data-theme-mode  → dark | light
 *   data-ui-density  → compact（普通态没有这个属性）
 * 用一个互斥的 `--state` 表达不了「暗色 + 紧凑」这种组合。
 * 取值规则与格子展开见 `dimensions.ts`——那边同时被 `open` / `reload` 用。
 *
 * ## 一次命令出多格
 *
 * 两个维度都接受逗号多值（`--theme light,dark --density default,compact`），
 * 展开成 frontend × theme × density。执行顺序按 **frontend 分组**：每次
 * `captureScript` 都要导航一次（2–5s，且清掉 hover/菜单/滚动），而切 theme /
 * density 只是改属性（~100–200ms），同前端的格子连续跑才谈得上复用同一页。
 *
 * 本轮仍是「一格一次 runCode」：导航与截图必须在同一个 CDP 会话里完成
 * （见 device.ts 的说明），把多格塞进一次 runCode 需要把整条循环搬进页面侧，
 * 与「失败要能定位到具体格子」冲突，留待以后。
 *
 * ## 跳过不存在的组合
 *
 * mobile × compact 上游不存在（`isCompactModeAvailable` 只允许桌面系）。
 * 跳过时 `note` 一行原因走 stderr，让 agent 知道少了一张图是刻意的。
 *
 * ## 文件名带维度
 *
 * `${frontend}${theme ? '-' + theme : ''}${density ? '-' + density : ''}.png`。
 * 旧实现只带密度，`--theme dark` 与 `--theme light` 会互相覆盖。
 *
 * ## 结束时必须恢复
 *
 * `shot` 会导航到别的前端、改视口、改这两个属性。不恢复的话，紧接着的
 * `read env` / `read element` 读到的就是截图用的临时状态（实测
 * `shot --theme dark` 之后 `read env` 仍返回 `themeMode: dark`）。
 *
 * 恢复用的是**截图前读到的实际值**，不是 root 快照——导航之后快照记录的是
 * 新页面的初始值，不能拿来还原截图前的自定义状态。
 * 恢复失败不能掩盖原始错误：`finally` 里的异常只在没有原始错误时抛出。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { lastValue, parseArgs } from '../args.ts';
import { captureScript, deviceNameFor, deviceProfile } from '../device.ts';
import { parseAt } from '../cell.ts';
import { DIMENSIONS, parseDimensionList, planCells } from '../dimensions.ts';
import type { Density, ThemeMode } from '../dimensions.ts';
import { EnvironmentError, UserError } from '../errors.ts';
import { note, output } from '../format.ts';
import { evalScript, runCli, runCode } from '../playwright.ts';
import { ENV_FN, evalExpr, THEME_FN } from '../script/recipe.ts';
import { readState, writeState } from '../session-state.ts';
import type { SessionState } from '../session-state.ts';
import { THEME_SWITCH_MS } from '../timing.ts';
import { parseFrontend, resolveFrontendUrl } from '../url.ts';
import type { Frontend } from '../url.ts';
import { viewportFor } from '../viewport.ts';
import { requireSession, restoreSession } from './session.ts';

// 维度定义搬到了 dimensions.ts（session 命令也要用，从 shot.ts import 会成环）。
// 这里 re-export，保持既有 import 路径与测试不变。
export { DIMENSIONS, parseDimension } from '../dimensions.ts';

/** 删掉 `<html>` 上的若干属性。 */
function removeAttributes(attributes: readonly string[]): void {
  if (!attributes.length) return;
  const body = attributes.map((attribute) => `document.documentElement.removeAttribute(${JSON.stringify(attribute)});`).join(' ');
  runCli(['eval', `(() => { ${body} return true; })()`]);
}

interface EnvSnapshot {
  frontend: string | null;
  themeMode: string | null;
  uiDensity: string | null;
}

/** 读当前页面的前端与两个维度（截图前保存，截图后还原）。 */
function snapshotEnv(): EnvSnapshot {
  const env = evalScript(evalExpr(ENV_FN)) as Partial<EnvSnapshot> | null;
  return {
    frontend: env?.frontend ?? null,
    themeMode: env?.themeMode ?? null,
    uiDensity: env?.uiDensity ?? null,
  };
}

/**
 * 把两个维度还原成截图前的值。
 *
 * ## 明暗必须走 `THEME_FN`，不能只写属性
 *
 * 截图时换主题会**换掉 `#themeDefaultStyle` / `#themeStyle` 的 href**（内置
 * daylight/midnight 的配色是两张独立 CSS）。只把 `data-theme-mode` 写回去，
 * 页面会停在「属性=light、样式表=midnight」的不一致状态：紧接着的
 * `read env` 报 `themeMode: light`，配色却仍是暗的，比不恢复更容易误导。
 * 所以这里复用 `THEME_FN`，属性和样式表一起回滚。
 *
 * 顺带满足另一条：`THEME_FN` 会按当前配置决定是否保留 `#themeStyle`
 * （没有自定义主题就删掉）。截图前没有这个 `<link>` 时，恢复不会凭空留下一个。
 *
 * ## 截图前读不到明暗时不动它
 *
 * `before.themeMode` 为 null 说明截图前页面还没就绪（没有属性）。此时
 * `restoreSession` 的重新导航已经把页面带回配置里的默认明暗，再删属性只会
 * 造出「属性缺失、样式表是某一张」的不一致。没有可信的旧值就不要猜。
 *
 * ## 密度相反：普通态就是「没有属性」
 *
 * 原本没有 `data-ui-density` 就删掉它。也不能写回旧版本可能留下的
 * `comfortable`——上游没有这个值，写回去等于恢复一个不存在的状态。
 */
function restoreDimensions(before: EnvSnapshot): void {
  if (before.themeMode === 'light' || before.themeMode === 'dark') {
    evalScript(evalExpr(THEME_FN, before.themeMode));
  }
  if (before.uiDensity === 'compact') {
    runCli(['eval', `document.documentElement.setAttribute('data-ui-density', 'compact')`]);
  } else {
    removeAttributes([DIMENSIONS['--density'].attribute]);
  }}

/** `--frontend both|desktop|mobile` → 前端列表。 */
function parseFrontends(raw: string | undefined): Frontend[] {
  const which = raw ?? 'both';
  return which === 'both' ? ['desktop', 'mobile'] : [parseFrontend(which)];
}

/**
 * 多值维度展开成「至少一项」的列表：未传该选项时用 `[null]`，
 * 表示这一格不改这个维度（与单值语义完全兼容）。
 */
function axesFor<T>(values: T[] | null): (T | null)[] {
  return values ?? [null];
}

export async function shot(argv: string[], url: string | null, json: boolean, at: string | null = null): Promise<void> {
  const parsed = parseArgs(argv, {
    valueFlags: ['--frontend', '--theme', '--density', '--out'],
    booleanFlags: [],
    allowUnknown: false,
  });
  const outDir = lastValue(parsed, '--out') ?? 'shots';
  // 每个值分别校验：`--theme dark,purple` 里只有 purple 会报错，且报错文本
  // 与单值一致（不会出现「dark,purple 取值不合法」这种让人不知道错在哪的提示）。
  const themes = parseDimensionList('--theme', lastValue(parsed, '--theme'));
  const densities = parseDimensionList('--density', lastValue(parsed, '--density'));
  const frontends = parseFrontends(lastValue(parsed, '--frontend'));
  // `--at` 与三组维度 flag 是两种写法，混用会产生「以谁为准」的歧义。
  // `--at` 表达的是完整格，三组 flag 表达的是轴，只允许选一种。
  if (at !== null && (themes !== null || densities !== null || lastValue(parsed, '--frontend') !== undefined)) {
    throw new UserError('--at 不能与 --frontend / --theme / --density 同时使用：它们是两种写法');
  }
  const planned =
    at === null
      ? (() => {
          const { cells, skipped } = planCells({
            frontends,
            themes: axesFor<ThemeMode>(themes),
            densities: axesFor<Density>(densities),
          });
          return {
            cells: cells.map((cell) => ({ ...cell, theme: cell.theme ?? 'light', density: cell.density ?? 'default' })),
            skipped: skipped.map((item) => item.message),
          };
        })()
      : parseAt(at);
  const cells = planned.cells.map((cell) => ({
    frontend: cell.frontend,
    theme: cell.theme,
    density: cell.density,
    file: `${cell.frontend}-${cell.theme}-${cell.density}.png`,
  }));
  const skipped = planned.skipped;
  // 全部被跳过时必须报错：`--frontend mobile --density compact` 只跳过不出图，
  // 若静默返回空列表，agent 会以为截图成功、只是路径没打印出来。
  if (!cells.length) {
    throw new UserError(`没有可截的格子：${skipped.join('；') || '维度组合为空'}`);
  }
  requireSession();

  // 截图前记住会话状态与页面维度，结束时原样还原。
  const saved = readState();
  const before = snapshotEnv();
  const savedFrontend: Frontend = saved?.frontend ?? (before.frontend === 'browser-mobile' ? 'mobile' : 'desktop');
  const savedState: SessionState = saved ?? {
    url: resolveFrontendUrl(savedFrontend, url),
    frontend: savedFrontend,
    device: null,
    viewport: null,
    theme: null,
    density: null,
  };

  try {
    mkdirSync(outDir, { recursive: true });
  } catch (cause) {
    throw new EnvironmentError(`建不了输出目录：${outDir}（${cause instanceof Error ? cause.message : String(cause)}）`);
  }
  const files: string[] = [];
  let failure: unknown = null;
  try {
    for (const reason of skipped) note(reason);
    for (const cell of cells) {
      const { frontend, theme, density } = cell;
      // 会话显式指定过设备时沿用（否则 mobile 会被默认值顶成 iPhone 13）。
      // --device 只在 mobile 语义下有意义，desktop 一律不模拟。
      const deviceName = deviceNameFor(frontend, frontend === 'mobile' ? savedState.device : null);
      // 视口：只有「正在截的就是保存的那个前端」才沿用会话的自定义视口，
      // 否则用该前端自己的标准视口（mobile 390x844 / desktop 1600x1000）。
      const viewport =
        frontend === savedState.frontend && savedState.viewport ? savedState.viewport : viewportFor(frontend);
      const file = join(outDir, cell.file);

      // 一次 run-code 内完成「切设备 + 导航 + 设主题/密度 + 截图」：
      // Page.captureScreenshot 只在设置设备覆盖的那个 CDP 会话里看到设备参数，
      // 拆成两次调用会退回 CSS 像素尺寸（实测 390x664 而不是 1170x2532）。
      const captured = runCode(
        captureScript({
          profile: deviceName ? deviceProfile(deviceName) : null,
          viewport,
          url: resolveFrontendUrl(frontend, url),
          mode: theme,
          density,
          settleMs: THEME_SWITCH_MS,
        })
      ) as { data?: unknown } | null;
      const data = typeof captured?.data === 'string' ? captured.data : null;
      if (!data) throw new EnvironmentError('截图失败：CDP 没有返回图像数据');
      writeFileSync(file, Buffer.from(data, 'base64'));
      files.push(file);
    }
  } catch (cause) {
    failure = cause;
  } finally {
    // 即使中途截图失败也要还原，别把临时状态留给后续命令。
    // 但还原本身失败不能掩盖原始错误：没有原始错误时才抛。
    try {
      // 导航回原前端/URL，但**不带**状态文件里的维度：真正要还原的是截图前
      // 页面上实际的样子（`before` 快照）。状态文件记的是「上次要求的值」，
      // 期间可能被 `do attr` 改过；两者都应用会让后一次覆盖前一次。
      await restoreSession({ ...savedState, theme: null, density: null });
      restoreDimensions(before);
      // 状态文件保持原样：它记录的是会话的期望值，不该被这次临时截图改写。
      writeState(savedState);
    } catch (restoreError) {
      if (failure === null) failure = restoreError;
      else note(`恢复会话失败（已保留原始错误）：${restoreError instanceof Error ? restoreError.message : String(restoreError)}`);
    }
  }
  if (failure !== null) throw failure;

  output(json ? files : files.join('\n'), json);
}
