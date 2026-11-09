/**
 * 会话命令：open / reload / status / close。
 *
 * `open` 起浏览器；已有会话上加载新产物用 `reload`（内部 goto），
 * 因为 playwright-core cli 的 open 会杀掉旧 Chrome 起一个新的。
 *
 * ## 设备模拟不必重开浏览器
 *
 * `--device` 是 `open` 的参数，但已有会话也能就地切设备：走 CDP 的
 * Emulation 域（见 `device.ts`），实测与 `open --device` 逐项一致。
 * 所以 `reload --frontend mobile`、`audit` 的 mobile 计划、`shot` 的多前端
 * 都可以在同一个会话里完成，不必杀掉用户的浏览器。
 *
 * 唯一的额外要求：切换后必须**重新导航**，因为 `navigator.maxTouchPoints`
 * 与 `'ontouchstart' in window` 在页面加载时固化。
 *
 * ## 为什么 open/reload 也接受 --theme / --density
 *
 * 导航会把这两个维度重置回思源配置（实测 dark → reload → light），所以
 * 「设暗色 → 改 CSS → reload → 测量」这条最常用的循环，如果不重放，测的就是
 * 亮色，而且退出码 0。把它们记进会话状态、并在每次 `reload` 之后重放，
 * 这条循环才不需要 agent 自己维护隐藏状态。
 *
 * 判断「当前是什么前端」用**页面上实际的 data-frontend**，不是状态文件：
 * 状态文件可能被删、写失败，或者会话是别的工具开的。
 *
 * 状态提示走 stderr（clig.dev：日志走 stderr，数据走 stdout），
 * 这样 `... --json | jq` 不会被「已打开」这类话打断。
 */
import { lastValue, parseArgs } from '../args.ts';
import { deviceNameFor, deviceProfile, deviceScript } from '../device.ts';
import { DIMENSIONS, parseDimension, isThemeMode } from '../dimensions.ts';
import type { Density, ThemeMode } from '../dimensions.ts';
import { UserError } from '../errors.ts';
import { note, output } from '../format.ts';
import { ensureWorkspace, evalScript, listSessions, runCli, runCode, sessionExists } from '../playwright.ts';
import { ATTR_FN, ENV_FN, evalExpr, READY_FN, SNAPSHOT_ROOT_FN, THEME_FN } from '../script/recipe.ts';
import { clearState, readState, writeState } from '../session-state.ts';
import type { SessionState } from '../session-state.ts';
import { READY_TIMEOUT_MS } from '../timing.ts';
import { parseFrontend, resolveFrontendUrl } from '../url.ts';
import type { Frontend } from '../url.ts';
import { sleep, isRecord } from '../util.ts';
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
 * 前端对应的默认模拟设备（仅用于 `open` 时的原生设备模拟）。
 *
 * 只设视口尺寸是不够的：真实移动端的 dpr 是 3，UA 也是移动端。
 * 少了设备模拟，`@media (min-resolution: 2dppx)`、`pointer: coarse`
 * 以及依赖 UA 的样式分支都不会生效，测出来的不是真实移动端。
 */
export { MOBILE_DEVICE } from '../device.ts';

/** 打开浏览器时要带上的设备模拟参数（desktop 不需要）。 */
export function deviceArgsFor(frontend: Frontend, device: string | null = null): string[] {
  const name = deviceNameFor(frontend, device);
  return name ? [`--device=${name}`] : [];
}

/** 一次 launch 的入参。 */
export interface LaunchOptions {
  device?: string | null;
  viewport?: Viewport | null;
  headed?: boolean;
  /** 打开后要应用的明暗；null / 省略表示不指定。 */
  theme?: ThemeMode | null;
  /** 打开后要应用的密度；null / 省略表示不指定。 */
  density?: Density | null;
}

/**
 * 在**现有会话**上就地切换设备模拟。
 *
 * 走 CDP 的 Emulation 域，与 `open --device` 等价（实测 innerWidth / dpr /
 * screen / UA / pointer / hover / min-resolution / orientation 全部一致），
 * 但不用杀掉浏览器。切换后必须重新导航：`navigator.maxTouchPoints` 与
 * `'ontouchstart' in window` 在页面加载时固化。
 *
 * `viewport` 决定 CSS 视口尺寸；设备只提供 dpr / UA / touch。
 * 不传 device 时显式写回桌面参数（不能只 clear，clear 不会复原 dpr/UA）。
 */
export function applyDevice(
  frontend: Frontend,
  device: string | null = null,
  viewport?: Viewport
): void {
  const name = deviceNameFor(frontend, device);
  runCode(deviceScript(name === null ? null : deviceProfile(name), viewport));
}

/**
 * 应用明暗与密度。
 *
 * 明暗走 `THEME_FN`：只写 `data-theme-mode` 对内置 daylight/midnight 无效
 * （配色是两张独立 CSS），必须同时换 `#themeDefaultStyle` / `#themeStyle`
 * 的 href。密度只是属性有无：`compact` 设值，`default` 删属性。
 *
 * 两个维度都没传时什么都不做——不能顺手把密度删掉，否则
 * `reload --theme dark` 会悄悄把用户设的紧凑模式清掉。
 */
export function applyDimensions(theme: ThemeMode | null, density: Density | null): void {
  if (theme !== null) {
    // THEME_FN 内部会等新样式表 load 完再返回（eval 会 await 页面侧的 promise），
    // 所以这里不需要再补 sleep。
    evalScript(evalExpr(THEME_FN, theme));
  }
  if (density !== null) {
    // 复用 recipe 的 ATTR_FN（值为 null 即删属性）：属性读写的转义规则只写一份。
    evalScript(evalExpr(ATTR_FN, [DENSITY_ATTR, density === 'compact' ? 'compact' : null]));
  }
}

/** `data-ui-density` 的属性名；密度只在这一个属性上表达。 */
const DENSITY_ATTR = DIMENSIONS['--density'].attribute;

/**
 * 打开浏览器（或复用已有会话）并切到目标前端。
 *
 * 已有会话时**不再重开**：用 CDP 切设备。只有会话不存在时才真开浏览器。
 *
 * 顺序很关键：**先 goto 再 applyDevice**。CDP 的 Emulation 覆盖绑定在
 * 当前文档上，导航到新文档会把它清掉；反过来做的话，`shot` 的 mobile 那一轮
 * 会拍到 1600x1000 的桌面尺寸。
 *
 * 切完再 reload 一次：`navigator.maxTouchPoints` 与 `'ontouchstart' in window`
 * 在文档创建时固化，不 reload 的话 `hasTouch` 仍是 false。
 *
 * 维度必须放在**导航与 reload 之后**：导航会重置 `data-theme-mode`，
 * 先设后导航等于没设。
 *
 * 视口规则（三条路径必须一致，否则同一个前端会有两种测量视口）：
 *  - 显式 viewport ⇒ 用它；
 *  - 有设备模拟 ⇒ 用设备自带视口，不要再 resize；
 *  - 都没有 ⇒ 用前端预设视口。
 */
export async function launch(frontend: Frontend, url: string, options: LaunchOptions = {}): Promise<void> {
  ensureWorkspace();
  const device = options.device ?? null;
  const reuse = sessionExists();

  // 视口只由前端预设或 --viewport 决定。设备（iPhone 13 等）只负责
  // dpr / UA / touch——它的自带视口是 390x664（不含浏览器 chrome），
  // 与本工具一直使用的 390x844 语义不同，不能拿来当测量视口。
  const viewport = options.viewport ?? viewportFor(frontend);

  if (reuse) {
    // 复用会话：先导航到目标页，再套设备模拟，最后 reload 让 touch 生效。
    runCli(['goto', url]);
    applyDevice(frontend, device, viewport);
    runCli(['reload']);
  } else {
    // 新会话：设备模拟直接由 open 原生完成，不用 CDP。
    const args = ['open', '--browser=chrome', ...deviceArgsFor(frontend, device)];
    if (options.headed) args.push('--headed');
    args.push(url);
    runCli(args);
    applyViewport(viewport);
  }

  await waitForReady();
  // 维度在就绪之后应用：页面还没挂主题时设属性，会被随后的初始化覆盖。
  applyDimensions(options.theme ?? null, options.density ?? null);
  captureRootSnapshot();
}

/**
 * 恢复一个已保存的会话（shot 结束时用）。
 *
 * 与 `launch` 的区别：状态里可能记录了显式 viewport、设备与维度，要一起还原。
 */
export async function restoreSession(state: SessionState): Promise<void> {
  await launch(state.frontend, state.url, {
    device: state.device,
    viewport: state.viewport,
    // 旧状态文件里没有这两个字段：缺省即「不指定」，别把它当成 null 传下去
    // （exactOptionalPropertyTypes 下 undefined 与 null 是两种类型）。
    theme: state.theme ?? null,
    density: state.density ?? null,
  });
}

export async function open(argv: string[], url: string | null): Promise<void> {
  const parsed = parseArgs(argv, {
    valueFlags: ['--frontend', '--device', '--viewport', '--theme', '--density'],
    booleanFlags: ['--headed'],
    allowUnknown: false,
  });
  const frontend = parseFrontend(lastValue(parsed, '--frontend'));
  const device = lastValue(parsed, '--device') ?? null;
  const viewportRaw = lastValue(parsed, '--viewport');
  const viewport = viewportRaw === undefined ? null : parseViewport(viewportRaw);
  // 与 shot 共用同一套取值校验：两处各写一份必然漂移（旧实现就多出一个
  // 上游不存在的 comfortable）。
  const theme = parseDimension('--theme', lastValue(parsed, '--theme'));
  const density = parseDimension('--density', lastValue(parsed, '--density'));
  const targetUrl = resolveFrontendUrl(frontend, url);

  await launch(frontend, targetUrl, { device, viewport, headed: parsed.flags.has('--headed'), theme, density });
  writeState({ url: targetUrl, frontend, device, viewport, theme, density });
  // 移动端没有紧凑模式（上游 isCompactModeAvailable 只允许桌面系）：属性写下去
  // 也不生效，明确说一声，别让 agent 以为已经切到紧凑态。
  if (frontend === 'mobile' && density === 'compact') note('移动端没有紧凑模式：--density compact 不会生效');
  note(`已打开 ${frontend}：${targetUrl}`);
}

export async function reload(argv: string[], url: string | null): Promise<void> {
  // 参数先校验、再要求会话（与 do / read 一致）。
  const parsed = parseArgs(argv, {
    valueFlags: ['--frontend', '--viewport', '--theme', '--density'],
    allowUnknown: false,
  });
  const requested = lastValue(parsed, '--frontend');
  const requestedFrontend = requested === undefined ? null : parseFrontend(requested);
  const viewportRaw = lastValue(parsed, '--viewport');
  const viewport = viewportRaw === undefined ? null : parseViewport(viewportRaw);
  const requestedTheme = parseDimension('--theme', lastValue(parsed, '--theme'));
  const requestedDensity = parseDimension('--density', lastValue(parsed, '--density'));

  requireSession();

  const state = readState();
  const actual = currentFrontend();
  const frontend = requestedFrontend ?? actual ?? state?.frontend ?? 'desktop';
  const targetUrl = resolveFrontendUrl(frontend, url);

  // 没显式给维度就重放会话里记的：导航会把它们重置回配置值，
  // 不重放的话「设暗色 → 改 CSS → reload → 测量」会静默测成亮色。
  const theme = requestedTheme ?? state?.theme ?? null;
  const density = requestedDensity ?? state?.density ?? null;

  // 设备跟着前端走：切到 mobile 就模拟真机，切回 desktop 就清掉设备模拟。
  // `launch` 会就地用 CDP 切换（不重开浏览器），再 goto，最后应用维度。
  await launch(frontend, targetUrl, { device: state?.device ?? null, viewport, theme, density });
  writeState({ url: targetUrl, frontend, device: state?.device ?? null, viewport, theme, density });
  if (frontend === 'mobile' && density === 'compact') note('移动端没有紧凑模式：--density compact 不会生效');
  note(`已重新加载：${targetUrl}`);
}

/** status 的测量状态形状（`--json` 时原样输出）。 */
export interface MeasurementStatus {
  open: boolean;
  frontend?: Frontend;
  theme?: ThemeMode | null;
  density?: Density | null;
  url?: string;
  viewport?: Viewport | null;
}

/** `ENV_FN` 里本命令用到的字段（页面侧返回 unknown，这里逐项收窄）。 */
interface EnvReading {
  frontend?: unknown;
  themeMode?: unknown;
  uiDensity?: unknown;
  url?: unknown;
  viewport?: unknown;
}

/**
 * 测量状态：状态文件 + 页面上实际的维度。
 *
 * 只读状态文件是不够的：文件可能被删、写失败，或者会话是别的工具开的；
 * 而 agent 真正要知道的是「现在这一页是什么状态」。所以页面在会话里时，
 * 以页面上实际的 `data-theme-mode` / `data-ui-density` / URL / 视口为准，
 * 读不到才退回状态文件。
 *
 * `density` 报告 `default` 而不是 null：页面上没有这个属性**就是**普通态，
 * 这与「没指定」是两回事（后者只在参数语义里存在）。
 */
function measurementStatus(): MeasurementStatus {
  if (!sessionExists()) return { open: false };
  const state = readState();
  let env: EnvReading | null = null;
  try {
    env = evalScript(evalExpr(ENV_FN)) as EnvReading | null;
  } catch {
    // 页面可能还没就绪：退回状态文件里的记录。
  }
  const frontendValue = typeof env?.frontend === 'string' ? env.frontend : null;
  const frontend = frontendValue ? FRONTEND_ATTR[frontendValue] ?? state?.frontend ?? null : state?.frontend ?? null;
  const themeMode = typeof env?.themeMode === 'string' ? env.themeMode : null;
  const theme: ThemeMode | null = isThemeMode(themeMode) ? themeMode : state?.theme ?? null;
  // 属性不存在 = 普通态；只有读不到页面（env 为 null）才退回状态文件。
  const densityRaw = env === null ? undefined : typeof env.uiDensity === 'string' ? env.uiDensity : null;
  const density: Density | null =
    densityRaw === undefined ? state?.density ?? null : densityRaw === 'compact' ? 'compact' : 'default';
  const url = typeof env?.url === 'string' ? env.url : state?.url;
  // 视口优先用页面实际尺寸：会话可能被 resize 过，状态文件里没有这次改动。
  const viewport = pageViewport(env?.viewport) ?? state?.viewport ?? null;
  return {
    open: true,
    ...(frontend === null ? {} : { frontend }),
    theme,
    density,
    ...(url === undefined ? {} : { url }),
    viewport,
  };
}

/** 从页面读数里取 CSS 视口尺寸；形状不对返回 null。 */
function pageViewport(raw: unknown): Viewport | null {
  if (!isRecord(raw)) return null;
  const { width, height } = raw;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return { width: Math.round(width as number), height: Math.round(height as number) };
}

/**
 * status：默认给测量状态，`--raw` 给 playwright 自己的会话列表。
 *
 * 旧实现的 `--json` 只吐 playwright 的内部字段（318 B），不含
 * frontend/theme/density/viewport，agent 还得再跑一次 `read env`。
 */
export function status(json: boolean, raw: boolean): void {
  if (raw) {
    if (!sessionExists()) {
      output(json ? { browsers: [] } : '未启动', json);
      return;
    }
    output(json ? { browsers: listSessions() } : runCli(['list']), json);
    return;
  }

  const state = measurementStatus();
  if (!json) {
    output(state.open ? renderStatus(state) : '未启动', false);
    return;
  }
  output(state, true);
}

/** 文本模式下给人读的一行一项。 */
function renderStatus(state: MeasurementStatus): string {
  const lines = [
    'open: true',
    `frontend: ${state.frontend ?? '(无)'}`,
    `theme: ${state.theme ?? '(无)'}`,
    `density: ${state.density ?? '(无)'}`,
    `url: ${state.url ?? '(无)'}`,
    `viewport: ${state.viewport ? `${String(state.viewport.width)}x${String(state.viewport.height)}` : '(无)'}`,
  ];
  return lines.join('\n');
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
