/**
 * batch 执行器：把一个场景列表 + 一组步骤，编译成**一次** `run-code`。
 *
 * ## 页面模型（这是整个设计的关键）
 *
 * - 每个前端最多一个页面。
 * - `policy: 'live-first'`：当前前端直接用你交互的那一页（`open` 的那页），
 *   其它前端懒创建「测量页」放在独立 context 里，之后一直复用。
 * - `policy: 'measure-only'`：所有前端都用测量页（`audit` 用，因为要 reload）。
 *
 * 主题/密度/附加属性都是页面内属性，切一格约 25ms，不导航、不重建，
 * 所以 `read --at` / `shot --at` 跑完只需要把属性设回去，交互态不丢。
 *
 * ## 为什么只有一次 run-code
 *
 * 一次 node 子进程约 0.8–1.5s。逐格一条命令会让 6 格变成 6 次 spawn；
 * 把循环放进页面侧只花一次。截图直接在 run-code 里 `page.screenshot({ path })`
 * 落盘（沙箱里没有 `process`/`require`，但 Playwright 自己的 API 有 fs），
 * 不再用 base64 回传，66 格也不会撞 stdout 上限。
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { deviceNameFor, deviceProfile } from './device.ts';
import { EnvironmentError, UserError } from './errors.ts';
import { expandAxes, parseAt } from './scene.ts';
import { runCode, sessionExists } from './playwright.ts';
import { sceneFile, sceneLabel } from './scene.ts';
import type { Scene } from './scene.ts';
import { readState } from './session-state.ts';
import type { Plan, PlanStep } from './script/plan-schema.ts';
import { compilePlanStatements } from './script/plan.ts';
import { resolveFrontendUrl } from './url.ts';
import type { Frontend } from './url.ts';
import { viewportFor } from './viewport.ts';
import type { Viewport } from './viewport.ts';

/** 一格的读数；失败格的 `error` 有值。 */
export interface BatchReading {
  at: string;
  value: unknown;
  error?: string;
}

/** 一张截图。 */
export interface BatchShot {
  at: string;
  path: string;
  bytes: number;
}

export interface BatchResult {
  readings: BatchReading[];
  shots: BatchShot[];
}

export interface BatchOptions {
  scenes: readonly Scene[];
  /** 每格执行的步骤；读数为空表示只截图。 */
  steps?: readonly PlanStep[];
  /** 截图输出目录；null / 省略表示不截图。 */
  shotsDir?: string | null;
  /** `live-first` 用当前前端那一页；`measure-only` 全部用测量页。 */
  policy: 'live-first' | 'measure-only';
  /** 步骤里有动作时，每格开始前 reload（只在 measure-only / 跨格时生效）。 */
  reloadWhenDirty?: boolean;
  url?: string | null;
  viewport?: Viewport | null;
  /** 会话里记录的设备名（移动端用）。 */
  device?: string | null;
}

interface TargetConfig {
  url: string;
  viewport: Viewport;
  dpr: number;
  mobile: boolean;
  touch: boolean;
  ua: string;
}

/** 某个前端的页面参数（`open` 与 batch 共用同一套视口语义）。 */
export function targetConfig(
  frontend: Frontend,
  url: string | null,
  viewport: Viewport | null,
  device: string | null
): TargetConfig {
  const spec = viewport ?? viewportFor(frontend);
  const deviceName = frontend === 'mobile' ? deviceNameFor(frontend, device) : null;
  const profile = deviceName ? deviceProfile(deviceName) : null;
  return {
    url: `${resolveFrontendUrl(frontend, url)}#syd-measure=${frontend}`,
    viewport: spec,
    dpr: profile?.deviceScaleFactor ?? 1,
    mobile: profile?.mobile ?? frontend === 'mobile',
    touch: profile?.hasTouch ?? frontend === 'mobile',
    ua: profile?.userAgent ?? '',
  };
}

/** 生成整段 run-code 脚本（导出以便测试）。 */
export function buildBatchScript(
  scenes: readonly Scene[],
  steps: readonly PlanStep[],
  shots: readonly { at: string; path: string }[] | null,
  policy: 'live-first' | 'measure-only',
  reloadWhenDirty: boolean,
  targets: Record<string, TargetConfig>
): string {
  const cells = scenes.map((scene) => ({
    at: sceneLabel(scene),
    frontend: scene.frontend,
    theme: scene.theme,
    density: scene.density,
    attrs: scene.attrs,
  }));
  const attrKeys = [...new Set(scenes.flatMap((scene) => Object.keys(scene.attrs)))];
  const hasActions = steps.some((step) => step.do !== undefined);
  const statements = compilePlanStatements({ at: 'all', steps } as Plan, 'results');
  return `async (page) => {
  const CELLS = ${JSON.stringify(cells)};
  const ATTR_KEYS = ${JSON.stringify(attrKeys)};
  const TARGETS = ${JSON.stringify(targets)};
  const SHOTS = ${JSON.stringify(shots)};
  const POLICY = ${JSON.stringify(policy)};
  const RELOAD_WHEN_DIRTY = ${JSON.stringify(reloadWhenDirty)};
  const HAS_ACTIONS = ${JSON.stringify(hasActions)};
  const browser = page.context().browser();
  const live = page;
  const result = { readings: [], shots: [] };
  let liveFrontend = null;
  try {
    liveFrontend = await live.evaluate(() => {
      const value = document.documentElement.getAttribute('data-frontend');
      return value === 'browser-mobile' ? 'mobile' : value === 'browser-desktop' ? 'desktop' : null;
    });
  } catch {}

  const pages = {};
  const targetErrors = {};
  const isLive = {};
  const fresh = new Set();  for (const fe of Object.keys(TARGETS)) {
    if (POLICY === 'live-first' && fe === liveFrontend) {
      pages[fe] = live;
      isLive[fe] = true;
      continue;
    }
    try {
      let found = null;
      for (const ctx of browser.contexts()) {
        for (const candidate of ctx.pages()) {
          if (candidate.url().includes('#syd-measure=' + fe)) found = candidate;
        }
      }
      if (!found) {
        const t = TARGETS[fe];
        const ctx = await browser.newContext({
          viewport: t.viewport,
          deviceScaleFactor: t.dpr,
          isMobile: t.mobile,
          hasTouch: t.touch,
          userAgent: t.ua || undefined,
          locale: 'zh-CN',
        });
        found = await ctx.newPage();
        await found.goto(t.url);
        await found.waitForFunction(
          () => Boolean(window.siyuan?.isReady === true && document.documentElement.getAttribute('data-frontend')),
          undefined,
          { timeout: 20000 }
        );
      }
      pages[fe] = found;
      isLive[fe] = false;
      fresh.add(fe);
    } catch (cause) {
      targetErrors[fe] = String(cause && cause.message ? cause.message : cause);
    }
  }

  // 测量页上的选择器可能只在某个前端存在（比如 .dock__item 在移动端没有）；
  // 5s 足够判定“找不到”，不要用 playwright 默认的 30s 把整轮拖死。
  for (const fe of Object.keys(pages)) {
    try {
      pages[fe].setDefaultTimeout(5000);
    } catch {}
  }

  /** 预载另一张内置主题表；之后切主题只改 media，约 25ms。 */
  const prepare = async (p) => p.evaluate(async () => {
    if (window.__sydPrepared) return window.__sydPrepared;
    const def = document.getElementById('themeDefaultStyle');
    if (!def) {
      window.__sydPrepared = 'no-default';
      return 'no-default';
    }
    const href = def.getAttribute('href') || '';
    const baseDark = href.includes('/midnight/');
    const otherHref = baseDark ? href.replace('/midnight/', '/daylight/') : href.replace('/daylight/', '/midnight/');
    const other = document.createElement('link');
    other.rel = 'stylesheet';
    other.id = 'syd-other';
    other.href = otherHref;
    other.media = 'not all';
    def.parentNode.insertBefore(other, def.nextSibling);
    const load = (link) => new Promise((resolve) => {
      link.addEventListener('load', () => resolve(true), { once: true });
      link.addEventListener('error', () => resolve(false), { once: true });
      setTimeout(() => resolve(true), 3000);
    });
    await load(other);

    const custom = document.getElementById('themeStyle');
    const cfg = (window.siyuan && window.siyuan.config && window.siyuan.config.appearance) || {};
    if (custom && cfg.themeLight && cfg.themeDark && cfg.themeLight !== cfg.themeDark) {
      const chref = custom.getAttribute('href') || '';
      const otherName = baseDark ? cfg.themeLight : cfg.themeDark;
      const next = chref.replace(/\\/appearance\\/themes\\/[^/]+\\//, '/appearance/themes/' + otherName + '/');
      if (next !== chref) {
        const cother = document.createElement('link');
        cother.rel = 'stylesheet';
        cother.id = 'syd-other-custom';
        cother.href = next;
        cother.media = 'not all';
        custom.parentNode.insertBefore(cother, custom.nextSibling);
        await load(cother);
      }
    }
    window.__sydBaseDark = baseDark;
    window.__sydPrepared = 'ok';
    return 'ok';
  });

  /** 把一页切到某个场景：只改属性 + 切换预载样式表。 */
  const apply = async (p, cell) => p.evaluate((payload) => {
    const c = payload.cell;
    const root = document.documentElement;
    root.setAttribute('data-theme-mode', c.theme);
    if (c.density === 'compact') root.setAttribute('data-ui-density', 'compact');
    else root.removeAttribute('data-ui-density');
    // 同一批里属性轴可能只出现在某些场景：先清掉本批涉及、但当前场景没有的属性。
    for (const name of payload.keys) if (!(name in (c.attrs || {}))) root.removeAttribute(name);
    for (const name of Object.keys(c.attrs || {})) root.setAttribute(name, c.attrs[name]);
    if (window.__sydPrepared === 'ok') {
      const dark = c.theme === 'dark';
      const baseDark = window.__sydBaseDark === true;
      const def = document.getElementById('themeDefaultStyle');
      const other = document.getElementById('syd-other');
      if (def) def.media = dark === baseDark ? 'all' : 'not all';
      if (other) other.media = dark === baseDark ? 'not all' : 'all';
      const custom = document.getElementById('themeStyle');
      const cother = document.getElementById('syd-other-custom');
      if (custom && cother) {
        custom.media = dark === baseDark ? 'all' : 'not all';
        cother.media = dark === baseDark ? 'not all' : 'all';
      }
    }
    // 强制样式重算，确保随后的读数是新场景的值。
    getComputedStyle(root).getPropertyValue('--b3-theme-background');
    return true;
  }, { cell, keys: ATTR_KEYS });

  const KEY = ['data-theme-mode', 'data-ui-density'];
  for (const cell of CELLS) for (const name of Object.keys(cell.attrs || {})) if (!KEY.includes(name)) KEY.push(name);
  let liveSnapshot = null;
  if (isLive[liveFrontend]) {
    try {
      liveSnapshot = await live.evaluate((keys) => {
        const root = document.documentElement;
        const snap = {};
        for (const name of keys) snap[name] = root.hasAttribute(name) ? root.getAttribute(name) : null;
        return snap;
      }, KEY);
    } catch {}
  }

  const runSteps = async (page) => {
${statements}
    return results;
  };

  // 含动作的计划要求每格从干净文档开始：刚创建的页是干净的，之前用过的
  // 测量页上一轮可能留下了打开的菜单/hover，先 reload 一次。
  const dirty = new Set(RELOAD_WHEN_DIRTY && HAS_ACTIONS ? Object.keys(pages).filter((fe) => !fresh.has(fe)) : []);
  for (const cell of CELLS) {
    const p = pages[cell.frontend];
    try {
      if (!p) throw new Error(targetErrors[cell.frontend] || '页面没有就绪');
      if (RELOAD_WHEN_DIRTY && dirty.has(cell.frontend)) {
        await p.reload();
        await p.waitForFunction(
          () => Boolean(window.siyuan?.isReady === true && document.documentElement.getAttribute('data-frontend')),
          undefined,
          { timeout: 20000 }
        );
        await prepare(p);
        dirty.delete(cell.frontend);
      }
      await apply(p, cell);
      const value = await runSteps(p);
      result.readings.push({ at: cell.at, value });
      if (HAS_ACTIONS) dirty.add(cell.frontend);
      if (SHOTS) {
        const shot = SHOTS.find((item) => item.at === cell.at);
        if (shot) {
          await p.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => {
            document.documentElement.getBoundingClientRect();
            resolve(true);
          }))));
          const buffer = await p.screenshot({ path: shot.path });
          result.shots.push({ at: cell.at, path: shot.path, bytes: buffer ? buffer.length : 0 });
        }
      }
    } catch (cause) {
      result.readings.push({ at: cell.at, value: null, error: String(cause && cause.message ? cause.message : cause) });
    }
  }

  if (liveSnapshot) {
    await live.evaluate((snap) => {
      const root = document.documentElement;
      for (const name of Object.keys(snap)) {
        if (snap[name] === null) root.removeAttribute(name);
        else root.setAttribute(name, snap[name]);
      }
      if (window.__sydPrepared === 'ok') {
        const dark = root.getAttribute('data-theme-mode') === 'dark';
        const baseDark = window.__sydBaseDark === true;
        const def = document.getElementById('themeDefaultStyle');
        const other = document.getElementById('syd-other');
        if (def) def.media = dark === baseDark ? 'all' : 'not all';
        if (other) other.media = dark === baseDark ? 'not all' : 'all';
        const custom = document.getElementById('themeStyle');
        const cother = document.getElementById('syd-other-custom');
        if (custom && cother) {
          custom.media = dark === baseDark ? 'all' : 'not all';
          cother.media = dark === baseDark ? 'not all' : 'all';
        }
      }
    }, liveSnapshot);
  }
  return result;
}`;
}

/** 读计划文件里的 `at` / `axes`。 */
export function planScenes(plan: Plan): { scenes: Scene[]; skipped: string[] } {
  return plan.at !== undefined ? parseAt(plan.at) : expandAxes(plan.axes ?? {});
}

/** 执行一次 batch；`url` 缺省时沿用会话状态。 */
export function runBatch(options: BatchOptions): BatchResult {
  if (!sessionExists()) throw new UserError('未启动浏览器会话；先运行 siyuan-devtools open [--frontend …]');
  const shotsDir = options.shotsDir ?? null;
  if (shotsDir !== null) {
    try {
      mkdirSync(shotsDir, { recursive: true });
    } catch (cause) {
      throw new EnvironmentError(`建不了输出目录：${shotsDir}（${cause instanceof Error ? cause.message : String(cause)}）`);
    }
  }
  const frontends = [...new Set(options.scenes.map((scene) => scene.frontend))];
  const state = readState();
  const device = options.device ?? state?.device ?? null;
  const targets: Record<string, TargetConfig> = {};
  for (const frontend of frontends) {
    // 会话里显式设的视口只对「同一个前端」有意义；跨前端时用各自的标准视口。
    const viewport = options.viewport ?? (state?.frontend === frontend ? state.viewport : null);
    targets[frontend] = targetConfig(frontend, options.url ?? null, viewport, device);
  }
  const shots = shotsDir === null ? null : options.scenes.map((scene) => ({ at: sceneLabel(scene), path: join(shotsDir, sceneFile(scene)) }));
  const script = buildBatchScript(
    options.scenes,
    options.steps ?? [],
    shots,
    options.policy,
    options.reloadWhenDirty === true,
    targets
  );
  const raw = runCode(script);
  if (!raw || typeof raw !== 'object') throw new EnvironmentError('batch 执行没有返回结果');
  const record = raw as { readings?: unknown; shots?: unknown };
  return {
    readings: Array.isArray(record.readings) ? (record.readings as BatchReading[]) : [],
    shots: Array.isArray(record.shots) ? (record.shots as BatchShot[]) : [],
  };
}

/** 把 `read --at` 的读数解成单值矩阵。 */
export function singleStepValues(result: BatchResult): { at: string; value: unknown; error?: string }[] {
  return result.readings.map((reading) => {
    if (reading.error !== undefined) return { at: reading.at, value: null, error: reading.error };
    const steps = reading.value;
    if (!Array.isArray(steps) || steps.length === 0) return { at: reading.at, value: null };
    const first = steps[0] as { value?: unknown };
    return { at: reading.at, value: first.value ?? null };
  });
}

/** 截图当前 live 页（不导航、不改状态）。 */
export function captureCurrent(outDir: string, file: string): { path: string; bytes: number } {
  const path = join(outDir, file);
  try {
    mkdirSync(outDir, { recursive: true });
  } catch (cause) {
    throw new EnvironmentError(`建不了输出目录：${outDir}（${cause instanceof Error ? cause.message : String(cause)}）`);
  }
  const bytes = runCode(`async (page) => {
  const buffer = await page.screenshot({ path: ${JSON.stringify(path)} });
  return buffer ? buffer.length : 0;
}`);
  return { path, bytes: typeof bytes === 'number' ? bytes : 0 };
}
