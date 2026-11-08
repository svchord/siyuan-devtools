/** WCAG 对比度：颜色解析与亮度计算，纯 Node 侧，不依赖浏览器。 */

/** 带透明度的颜色一律返回 null：静默丢掉 alpha 比报 null 更糟。 */
function hasAlpha(text: string): boolean {
  if (/^rgba?\(/i.test(text) || /^hsla\(/i.test(text)) {
    if (text.includes(',') && text.split(',').length > 3) return true;
  }
  if (text.includes('/')) return true;
  return text.startsWith('#') && (text.length === 5 || text.length === 9);
}

function parseColor(value: string): [number, number, number] | null {
  const text = value.trim();
  if (!text || hasAlpha(text)) return null;
  if (text.startsWith('#')) {
    const hex = text.slice(1);
    if (hex.length === 3) return [...hex].map((c) => Number.parseInt(c + c, 16)) as [number, number, number];
    if (hex.length === 6) return [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
    return null;
  }
  const numbers = text.match(/[\d.]+/g);
  if (!numbers || numbers.length !== 3) return null;
  const rgb = numbers.map(Number);
  if (!rgb.every((channel) => Number.isFinite(channel) && channel >= 0 && channel <= 255)) return null;
  return rgb as [number, number, number];
}

function luminance([r, g, b]: [number, number, number]): number {
  const channel = (value: number): number => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** 1–21 的两位小数；任一侧解析不了（含带 alpha）返回 null。 */
export function contrastRatio(foreground: string, background: string): number | null {
  const fg = parseColor(foreground);
  const bg = parseColor(background);
  if (!fg || !bg) return null;
  const a = luminance(fg);
  const b = luminance(bg);
  return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
}
