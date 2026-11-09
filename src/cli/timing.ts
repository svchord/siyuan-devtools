/**
 * 等待/过渡时长集中定义。
 *
 * 这些数字散落在各命令里时，两处「动作后等 500ms」必然漂移；
 * 统一放这里，也方便在测试里替换成 0。
 *
 * ## 为什么维度切换与导航是两档成本
 *
 * 三个轴的代价差一个数量级（实测）：frontend 要 CDP 切设备 + 导航 + 等就绪
 * （2–5s，还会清掉 hover/菜单/滚动），theme 要换两张样式表（~200ms），
 * density 只是加删一个属性（~100ms）。`shot` 因此按「frontend 外层、
 * theme × density 内层」执行：同一前端的格子连续跑，才谈得上复用同一页。
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

/**
 * 切换 `data-theme-mode` / `data-ui-density` 后等主题 CSS 生效。
 *
 * `captureScript` 用它做截图前的落定等待。`reload` / `open` 的维度重放不需要
 * 额外的固定等待：`THEME_FN` 自己会等新样式表 `load` 完再返回。
 */
export const THEME_SWITCH_MS = settleMs(200);

/** 等思源前端启动的总超时。 */
export const READY_TIMEOUT_MS = 15_000;
