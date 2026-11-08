/**
 * 会话命令：open / reload / status / close。
 *
 * `open` 只调一次；会话已存在时加载新产物用 `reload`（内部 goto），
 * 因为 playwright-core cli 的 open 会杀掉旧 Chrome 起一个新的。
 *
 * 状态提示走 stderr（clig.dev：日志走 stderr，数据走 stdout），
 * 这样 `... --json | jq` 不会被「已打开」这类话打断。
 */
import { lastValue, parseArgs } from '../args.ts';
import { output } from '../format.ts';
import { evalScript, listSessions, runCli, sessionExists } from '../playwright.ts';
import { ENV_FN, evalExpr, READY_FN, SNAPSHOT_ROOT_FN } from '../script/recipe.ts';
import { sleep, UserError } from '../support.ts';
import { frontendUrl, parseFrontend } from '../url.ts';
import type { Frontend } from '../url.ts';
import { parseViewport, viewportFor } from '../viewport.ts';
import type { Viewport } from '../viewport.ts';

/** 除 open / audit 外的命令都要求会话已存在。 */
export function requireSession(): void {
  if (!sessionExists()) throw new UserError('未启动浏览器会话；先运行 siyuan-devtools open [--frontend …]');
}

/** 状态提示：走 stderr，不污染 stdout 的数据。 */
function note(message: string): void {
  console.error(message);
}

/**
 * 等 SiYuan 前端完成启动。
 *
 * Playwright 的 `goto` 只等到 load，思源还要异步初始化 `window.siyuan.config`
 * 并设置 `data-frontend`。不等的话，紧接着的 `read env` 会读到主题和前端都是
 * null，截图也可能拍到未挂主题的页面。
 */
export async function waitForReady(timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if (evalScript(evalExpr(READY_FN)) === true) return;
    } catch {
      // 页面可能还在导航/初始化，继续等。
    }
    await sleep(150);
  }
  throw new UserError('页面未就绪：等待 SiYuan 前端加载超时（检查 --url 或 SIYUAN_PORT）');
}

/** 记录根元素属性快照，供 `do reset` 恢复。 */
export async function captureRootSnapshot(): Promise<void> {
  evalScript(evalExpr(SNAPSHOT_ROOT_FN));
}

/** 应用 CSS 视口尺寸。 */
export function applyViewport(viewport: Viewport): void {
  runCli(['resize', String(viewport.width), String(viewport.height)]);
}

/** 当前页面是哪个前端；页面还没启动时返回 null。 */
function currentFrontend(): Frontend | null {
  try {
    const env = evalScript(evalExpr(ENV_FN)) as { frontend?: unknown } | null;
    if (env?.frontend === 'browser-mobile') return 'mobile';
    if (env?.frontend === 'browser-desktop') return 'desktop';
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
const MOBILE_DEVICE = 'iPhone 13';

/** 打开浏览器时要带上的设备模拟参数（desktop 不需要）。 */
export function deviceArgsFor(frontend: Frontend, device: string | null = null): string[] {
  if (device) return [`--device=${device}`];
  return frontend === 'mobile' ? [`--device=${MOBILE_DEVICE}`] : [];
}

export async function open(argv: string[], url: string | null): Promise<void> {
  const parsed = parseArgs(argv, {
    valueFlags: ['--frontend', '--device', '--viewport'],
    booleanFlags: ['--headed'],
    allowUnknown: false,
  });
  const frontend = parseFrontend(lastValue(parsed, '--frontend'));
  const device = lastValue(parsed, '--device');
  const viewportRaw = lastValue(parsed, '--viewport');
  const viewport = viewportRaw === undefined ? null : parseViewport(viewportRaw);
  const args = ['open', '--browser=chrome', ...deviceArgsFor(frontend, device ?? null)];
  if (parsed.flags.has('--headed')) args.push('--headed');
  args.push(frontendUrl(frontend, url));
  runCli(args);
  if (viewport) applyViewport(viewport);
  else if (!device) applyViewport(viewportFor(frontend));
  await waitForReady();
  await captureRootSnapshot();
  note(`已打开 ${frontend}：${frontendUrl(frontend, url)}`);
}

export async function reload(argv: string[], url: string | null): Promise<void> {
  requireSession();
  const parsed = parseArgs(argv, {
    valueFlags: ['--frontend', '--viewport'],
    allowUnknown: false,
  });
  const requested = lastValue(parsed, '--frontend');
  const frontend = requested === undefined ? currentFrontend() ?? 'desktop' : parseFrontend(requested);
  const viewportRaw = lastValue(parsed, '--viewport');
  applyViewport(viewportRaw === undefined ? viewportFor(frontend) : parseViewport(viewportRaw));
  runCli(['goto', frontendUrl(frontend, url)]);
  await waitForReady();
  await captureRootSnapshot();
  note(`已重新加载：${frontendUrl(frontend, url)}`);
}

/** status 的输出是数据，留在 stdout。 */
export function status(json: boolean): void {
  if (!sessionExists()) {
    output(json ? { browsers: [] } : '未启动', json);
    return;
  }
  if (json) {
    output(listSessions(), true);
    return;
  }
  console.log(runCli(['list']).out);
}

export function close(): void {
  if (!sessionExists()) {
    note('未启动');
    return;
  }
  runCli(['close']);
  note('已关闭');
}
