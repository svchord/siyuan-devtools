/**
 * 截图命令：原生 `cli screenshot`。输出的是文件路径（数据，走 stdout）。
 *
 * ## 为什么是 `--theme` + `--density` 而不是一个 `--state`
 *
 * 明暗与密度是**两个独立维度**，各对应一个 `<html>` 属性：
 *   data-theme-mode  → dark | light
 *   data-ui-density  → comfortable | compact
 * 用一个互斥的 `--state` 表达不了「暗色 + 紧凑」这种组合。
 *
 * ## 结束时必须恢复
 *
 * `shot` 会重开浏览器、改视口、改这两个属性。不恢复的话，紧接着的
 * `read env` / `read element` 读到的就是截图用的临时状态（实测
 * `shot --theme dark` 之后 `read env` 仍返回 `themeMode: dark`）。
 *
 * 恢复用的是**截图前读到的实际值**，不是 root 快照——重开浏览器之后
 * 快照记录的是新页面的初始值，不能拿来还原截图前的自定义状态。
 * 恢复失败不能掩盖原始错误：`finally` 里的异常只在没有原始错误时抛出。
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lastValue, parseArgs } from '../args.ts';
import { EnvironmentError, UserError } from '../errors.ts';
import { note, output } from '../format.ts';
import { evalScript, runCli } from '../playwright.ts';
import { ENV_FN, evalExpr } from '../script/recipe.ts';
import { readState, writeState } from '../session-state.ts';
import type { SessionState } from '../session-state.ts';
import { THEME_SWITCH_MS } from '../timing.ts';
import { parseFrontend, resolveFrontendUrl } from '../url.ts';
import type { Frontend } from '../url.ts';
import { sleep } from '../util.ts';
import { requireSession, restoreSession } from './session.ts';

/** 两个维度各自的属性名与合法取值。 */
export const DIMENSIONS = {
  '--theme': { attribute: 'data-theme-mode', values: ['dark', 'light'] },
  '--density': { attribute: 'data-ui-density', values: ['comfortable', 'compact'] },
} as const;

export type DimensionFlag = keyof typeof DIMENSIONS;

/** 校验某个维度的取值；拼错时列出可用值。 */
export function parseDimension(flag: DimensionFlag, raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const { values } = DIMENSIONS[flag];
  if (!(values as readonly string[]).includes(raw)) {
    throw new UserError(`${flag} 取值不合法：${raw}（可用：${values.join(' / ')}）`);
  }
  return raw;
}

/** 一次性设置 `<html>` 上的若干属性。 */
function applyAttributes(assignments: ReadonlyArray<readonly [string, string]>): void {
  if (!assignments.length) return;
  const body = assignments
    .map(([attribute, value]) => `document.documentElement.setAttribute(${JSON.stringify(attribute)}, ${JSON.stringify(value)});`)
    .join(' ');
  runCli(['eval', `(() => { ${body} return true; })()`]);
}

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

/** 把两个维度还原成截图前的值；原本没有的属性要删掉，不能留成截图值。 */
function restoreDimensions(before: EnvSnapshot): void {
  const assignments: Array<[string, string]> = [];
  const removals: string[] = [];
  if (before.themeMode) assignments.push([DIMENSIONS['--theme'].attribute, before.themeMode]);
  else removals.push(DIMENSIONS['--theme'].attribute);
  if (before.uiDensity) assignments.push([DIMENSIONS['--density'].attribute, before.uiDensity]);
  else removals.push(DIMENSIONS['--density'].attribute);
  applyAttributes(assignments);
  removeAttributes(removals);
}

export async function shot(argv: string[], url: string | null, json: boolean): Promise<void> {
  const parsed = parseArgs(argv, {
    valueFlags: ['--frontend', '--theme', '--density', '--out'],
    booleanFlags: [],
    allowUnknown: false,
  });
  const outDir = lastValue(parsed, '--out') ?? 'shots';
  const theme = parseDimension('--theme', lastValue(parsed, '--theme'));
  const density = parseDimension('--density', lastValue(parsed, '--density'));
  const which = lastValue(parsed, '--frontend') ?? 'both';
  const frontends: Frontend[] = which === 'both' ? ['desktop', 'mobile'] : [parseFrontend(which)];
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
  };

  // 文件名带上生效的维度，两种组合不会互相覆盖。
  const suffix = [theme, density].filter(Boolean).join('-');

  try {
    mkdirSync(outDir, { recursive: true });
  } catch (cause) {
    throw new EnvironmentError(`建不了输出目录：${outDir}（${cause instanceof Error ? cause.message : String(cause)}）`);
  }
  const files: string[] = [];
  let failure: unknown = null;
  try {
    for (const frontend of frontends) {
      // 设备模拟（--device）只能在 open 时指定，改不了已有会话。所以每换一个
      // 前端就重开浏览器：否则 mobile 那一轮会沿用 desktop 的 dpr 与 UA，
      // min-resolution / pointer 之类的媒体查询全部走错分支。
      //
      // 注意：这与 SKILL 里「不要再 open 第二次」不冲突——那句话是给用户/agent
      // 的手工操作说的；shot 必须重开才能换设备模拟，且结束时会把会话还原。
      await restoreSession({ ...savedState, frontend, url: resolveFrontendUrl(frontend, url) });
      const assignments: Array<[string, string]> = [];
      if (theme) assignments.push([DIMENSIONS['--theme'].attribute, theme]);
      if (density) assignments.push([DIMENSIONS['--density'].attribute, density]);
      applyAttributes(assignments);
      // 给主题 CSS/过渡一帧以上时间；否则可能截到切换中的状态。
      if (assignments.length) await sleep(THEME_SWITCH_MS);

      const file = join(outDir, `${frontend}${suffix ? `-${suffix}` : ''}.png`);
      // --hires 按设备像素截图（计入 dpr）。不加的话 mobile 仍输出 390x844 的
      // CSS 像素图，在真机 3x 屏上相当于把 1170x2532 压缩了三分之一。
      runCli(['screenshot', '--hires', `--filename=${file}`]);
      files.push(file);
    }
  } catch (cause) {
    failure = cause;
  } finally {
    // 即使中途截图失败也要还原，别把临时状态留给后续命令。
    // 但还原本身失败不能掩盖原始错误：没有原始错误时才抛。
    try {
      await restoreSession(savedState);
      restoreDimensions(before);
      writeState(savedState);
    } catch (restoreError) {
      if (failure === null) failure = restoreError;
      else note(`恢复会话失败（已保留原始错误）：${restoreError instanceof Error ? restoreError.message : String(restoreError)}`);
    }
  }
  if (failure !== null) throw failure;

  output(json ? files : files.join('\n'), json);
}
