/** 视口参数：唯一解析/校验入口。 */
import { UserError } from './support.ts';
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

/** 前端对应的标准视口。 */
export function viewportFor(frontend: Frontend): Viewport {
  return frontend === 'mobile' ? { ...MOBILE_VIEWPORT } : { ...DESKTOP_VIEWPORT };
}

/**
 * 解析 `宽x高`。
 *
 * 这里必须拒绝 0：`resize 0 0` 在 Chrome 里会被夹成不可预期的小视口
 * （实测 512x6），不能让它静默流进浏览器。
 */
export function parseViewport(raw: string): Viewport {
  const text = raw.trim();
  const match = /^(\d+)x(\d+)$/.exec(text);
  if (!match) throw new UserError(`--viewport 格式应为 宽x高，如 390x844：${raw}`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new UserError(`--viewport 宽高必须是正整数，如 390x844：${raw}`);
  }
  return { width, height };
}
