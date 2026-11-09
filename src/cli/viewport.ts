/** 视口参数：唯一解析/校验入口。 */
import { UserError } from './errors.ts';
import type { Frontend } from './url.ts';

/** CSS 像素尺寸。 */
export interface Viewport {
  width: number;
  height: number;
}

/** 桌面缺省：够放思源停靠栏、编辑器和侧栏。 */
export const DESKTOP_VIEWPORT: Viewport = { width: 1600, height: 1000 };

/** 移动端缺省（与旧工具一致的 CSS 视口尺寸）。 */
export const MOBILE_VIEWPORT: Viewport = { width: 390, height: 844 };

/** 上限：超过它 Chrome 会给出不可预期的大视口，截图与布局断言都失去意义。 */
const MAX_DIMENSION = 10_000;

/** 前端对应的标准视口。 */
export function viewportFor(frontend: Frontend): Viewport {
  return frontend === 'mobile' ? { ...MOBILE_VIEWPORT } : { ...DESKTOP_VIEWPORT };
}

/**
 * 解析 `宽x高`。
 *
 * 这里必须拒绝 0：`resize 0 0` 在 Chrome 里会被夹成不可预期的小视口
 * （实测 512x6），不能让它静默流进浏览器。上限同理——`99999x99999` 会被
 * 接受并真的生效，之后所有坐标断言都不可信。
 */
export function parseViewport(raw: string): Viewport {
  const text = raw.trim();
  const match = /^(\d+)x(\d+)$/.exec(text);
  if (!match) throw new UserError(`--viewport 格式应为 宽x高，如 390x844：${raw}`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  const valid = (value: number): boolean => Number.isSafeInteger(value) && value > 0 && value <= MAX_DIMENSION;
  if (!valid(width) || !valid(height)) {
    throw new UserError(`--viewport 宽高必须是 1–${MAX_DIMENSION} 的正整数，如 390x844：${raw}`);
  }
  return { width, height };
}
