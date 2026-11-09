/**
 * 等待/过渡时长集中定义。
 *
 * 这些数字散落在各命令里时，两处「动作后等 500ms」必然漂移；
 * 统一放这里，也方便在测试里替换成 0。
 */

/** 读取时长；`SIYUAN_DEVTOOLS_SETTLE_MS` 可在测试里覆盖。 */
function settleMs(fallback: number): number {
  const raw = process.env.SIYUAN_DEVTOOLS_SETTLE_MS;
  if (raw === undefined) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** 页面动作（click/hover/menu…）之后等过渡与异步渲染落定。 */
export const ACTION_SETTLE_MS = settleMs(500);

/** `--diff` 前把指针停到角落，等 hover 态退出。 */
export const POINTER_PARK_MS = settleMs(120);

/** 切换 `data-theme-mode` / `data-ui-density` 后等主题 CSS 生效。 */
export const THEME_SWITCH_MS = settleMs(200);

/** 等思源前端启动的总超时。 */
export const READY_TIMEOUT_MS = 15_000;
