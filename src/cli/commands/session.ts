/**
 * 会话命令：open / reload / status / close。
 *
 * `open` 只调一次；会话已存在时加载新产物用 `reload`（内部 goto），
 * 因为 playwright-core cli 的 open 会杀掉旧 Chrome 起一个新的。
 *
 * ## 设备模拟只能在 open 时指定
 *
 * `--device` 是 `open` 的参数，已有会话改不了。所以凡是「前端变了」的场景
 * （`reload --frontend mobile`、`audit` 的 mobile 计划）都必须**重开浏览器**，
 * 否则 dpr 停在 1、UA 还是桌面，`min-resolution` / `pointer: coarse`
 * 全部走错分支——测出来的不是真实移动端。
 *
 * 判断依据是**页面上实际的前端**，不是状态文件：状态文件可能被删、写失败，
 * 或者会话是别的工具开的，那时代码不能假设「没状态就是没变」。
 *
 * 状态提示走 stderr（clig.dev：日志走 stderr，数据走 stdout），
 * 这样 `... --json | jq` 不会被「已打开」这类话打断。
 */
import { lastValue, parseArgs } from '../args.ts';
import { UserError } from '../errors.ts';
import { note, output } from '../format.ts';
import { ensureWorkspace, evalScript, listSessions, runCli, sessionExists } from '../playwright.ts';
import { ENV_FN, evalExpr, READY_FN, SNAPSHOT_ROOT_FN } from '../script/recipe.ts';
import { clearState, readState, writeState } from '../session-state.ts';
import type { SessionState } from '../session-state.ts';
import { READY_TIMEOUT_MS } from '../timing.ts';
import { parseFrontend, resolveFrontendUrl } from '../url.ts';
import type { Frontend } from '../url.ts';
import { sleep } from '../util.ts';
import { parseViewport, viewportFor } from '../viewport.ts';
import type { Viewport } from '../viewport.ts';

/** 除 open / audit 外的命令都要求会话已存在。 */
export function requireSession(): void {
  if (!sessionExists()) throw new UserError('未启动浏览器会话；先运行 siyuan-devtools open [--frontend …]');
}

/**
 * 等 SiYuan 前端完成启动。
 *
 * Playwright 的 `goto` 只等到 load，思源还要异步初始化 `window.siyuan.config`
 * 并设置 `data-frontend`。不等的话，紧接着的 `read env` 会读到主题和前端都是
 * null，截图也可能拍到未挂主题的页面。
 *
 * 每次轮询要 spawn 一个 node 进程（~800ms），所以 sleep 只是不让失败路径空转；
 * 真实节奏由 spawn 本身决定。
 */
export async function waitForReady(timeoutMs = READY_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (evalScript(evalExpr(READY_FN)) === true) return;
    } catch {
      // 页面可能还在导航/初始化，继续等。
    }
    await sleep(250);
  }
  throw new UserError('页面未就绪：等待 SiYuan 前端加载超时（检查 --url 或 SIYUAN_PORT）');
}

/** 记录根元素属性快照，供 `do reset` 恢复。 */
export function captureRootSnapshot(): void {
  evalScript(evalExpr(SNAPSHOT_ROOT_FN));
}

/** 应用 CSS 视口尺寸。 */
export function applyViewport(viewport: Viewport): void {
  runCli(['resize', String(viewport.width), String(viewport.height)]);
}

/** 页面上的 `data-frontend` 值。 */
const FRONTEND_ATTR: Record<string, Frontend> = {
  'browser-desktop': 'desktop',
  'browser-mobile': 'mobile',
};

/** 当前页面是哪个前端；页面还没启动时返回 null。 */
export function currentFrontend(): Frontend | null {
  try {
    const env = evalScript(evalExpr(ENV_FN)) as { frontend?: unknown } | null;
    const value = typeof env?.frontend === 'string' ? env.frontend : null;
    return value ? FRONTEND_ATTR[value] ?? null : null;
  } catch {
    // 页面可能还没初始化。
  }
  return null;
}

/**
 * 前端对应的默认模拟设备。
 *
 * 只设视口尺寸是不够的：真实移动端的 dpr 是 3，UA 也是移动端。
 * 少了设备模拟，`@media (min-resolution: 2dppx)`、`pointer: coarse`
 * 以及依赖 UA 的样式分支都不会生效，测出来的不是真实移动端。
 */
export const MOBILE_DEVICE = 'iPhone 13';

/** 打开浏览器时要带上的设备模拟参数（desktop 不需要）。 */
export function deviceArgsFor(frontend: Frontend, device: string | null = null): string[] {
  if (device) return [`--device=${device}`];
  return frontend === 'mobile' ? [`--device=${MOBILE_DEVICE}`] : [];
}

/** 一次 launch 的入参。 */
export interface LaunchOptions {
  device?: string | null;
  viewport?: Viewport | null;
  headed?: boolean;
}

/**
 * 重开浏览器并打开指定前端。
 *
 * `open` 会杀掉同 workspace 的旧 Chrome 起新的，所以不需要先 close。
 *
 * 视口规则（三条路径必须一致，否则同一个前端会有两种测量视口）：
 *  - 显式 viewport ⇒ 用它；
 *  - 有设备模拟 ⇒ 用设备自带视口（`iPhone 13` 是 390x664），不要再 resize；
 *  - 都没有 ⇒ 用前端预设视口。
 */
export async function launch(frontend: Frontend, url: string, options: LaunchOptions = {}): Promise<void> {
  ensureWorkspace();
  const device = options.device ?? null;
  const deviceArgs = deviceArgsFor(frontend, device);
  const args = ['open', '--browser=chrome', ...deviceArgs];
  if (options.headed) args.push('--headed');
  args.push(url);
  runCli(args);
  if (options.viewport) applyViewport(options.viewport);
  else if (!deviceArgs.length) applyViewport(viewportFor(frontend));
  await waitForReady();
  captureRootSnapshot();
}

/**
 * 恢复一个已保存的会话（shot 结束时用）。
 *
 * 与 `launch` 的区别：状态里可能记录了显式 viewport 和设备，两者要一起还原。
 */
export async function restoreSession(state: SessionState): Promise<void> {
  await launch(state.frontend, state.url, {
    device: state.device,
    viewport: state.viewport,
  });
}

export async function open(argv: string[], url: string | null): Promise<void> {
  const parsed = parseArgs(argv, {
    valueFlags: ['--frontend', '--device', '--viewport'],
    booleanFlags: ['--headed'],
    allowUnknown: false,
  });
  const frontend = parseFrontend(lastValue(parsed, '--frontend'));
  const device = lastValue(parsed, '--device') ?? null;
  const viewportRaw = lastValue(parsed, '--viewport');
  const viewport = viewportRaw === undefined ? null : parseViewport(viewportRaw);
  const targetUrl = resolveFrontendUrl(frontend, url);

  await launch(frontend, targetUrl, { device, viewport, headed: parsed.flags.has('--headed') });
  writeState({ url: targetUrl, frontend, device, viewport });
  note(`已打开 ${frontend}：${targetUrl}`);
}

export async function reload(argv: string[], url: string | null): Promise<void> {
  // 参数先校验、再要求会话（与 do / read 一致）。
  const parsed = parseArgs(argv, {
    valueFlags: ['--frontend', '--viewport'],
    allowUnknown: false,
  });
  const requested = lastValue(parsed, '--frontend');
  const requestedFrontend = requested === undefined ? null : parseFrontend(requested);
  const viewportRaw = lastValue(parsed, '--viewport');
  const viewport = viewportRaw === undefined ? null : parseViewport(viewportRaw);

  requireSession();

  const state = readState();
  const actual = currentFrontend();
  const frontend = requestedFrontend ?? actual ?? state?.frontend ?? 'desktop';
  const targetUrl = resolveFrontendUrl(frontend, url);

  // 判断依据是页面上实际的前端：状态文件可能缺失/过期，不能假设「没状态就是没变」。
  const frontendChanged = actual !== null && actual !== frontend;
  const device = frontendChanged ? null : state?.device ?? null;
  if (frontendChanged) {
    await launch(frontend, targetUrl, { device, viewport });
  } else {
    if (viewport) applyViewport(viewport);
    runCli(['goto', targetUrl]);
    await waitForReady();
    captureRootSnapshot();
  }
  writeState({ url: targetUrl, frontend, device, viewport });
  note(`已重新加载：${targetUrl}`);
}

/** status 的输出是数据，留在 stdout。 */
export function status(json: boolean): void {
  if (!sessionExists()) {
    output(json ? { browsers: [] } : '未启动', json);
    return;
  }
  const sessions = listSessions();
  output(json ? { browsers: sessions } : sessions, json);
}

export function close(): void {
  if (!sessionExists()) {
    clearState();
    note('未启动');
    return;
  }
  runCli(['close']);
  clearState();
  note('已关闭');
}
