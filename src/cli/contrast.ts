/**
 * WCAG 对比度：颜色解析与亮度计算，纯 Node 侧，不依赖浏览器。
 *
 * 只接受能用 sRGB 三元组精确表达的颜色。解析不出来一律返回 null，绝不猜：
 * 猜出来的数字比 `null` 危险得多，agent 会把它当成 WCAG 达标。
 */

/**
 * 无法用 sRGB 三元组表达的现代颜色函数。
 *
 * `oklch()` / `lab()` / `lch()` / `hwb()` / `color()` 里也有 3 个数字，
 * 一旦落进下面的「裸三元组」兜底分支，就会被当成 RGB 算出一个看着合理的
 * 错值（实测 `oklch(0.7 0.1 200)` 得到 11.44，真实值 ≈ 1.6）。必须显式拒绝。
 */
const UNSUPPORTED_FUNCTIONS = /^(?:oklch|oklab|lab|lch|hwb|color|color-mix|light-dark)\(/i;

/** 带透明度的颜色一律返回 null：静默丢掉 alpha 比报 null 更糟。 */
function hasAlpha(text: string): boolean {
  if (/^rgba?\(/i.test(text) || /^hsla?\(/i.test(text)) {
    // 4 段逗号形式（`rgba(r,g,b,a)`）；alpha >= 1 视为不透明，仍可算。
    const parts = text.replace(/^[a-z]+\(|\)$/gi, '').split(/[,\s/]+/).filter(Boolean);
    if (parts.length === 4) {
      const alpha = Number.parseFloat(parts[3]!);
      // 解析不了就当有 alpha（宁可 null 也不猜）。
      if (!Number.isFinite(alpha)) return true;
      return alpha < 1;
    }
  }
  if (text.includes('/')) return true;
  // `#rgba` / `#rrggbbaa`：alpha 为 ff 时同样不透明。
  if (text.startsWith('#') && (text.length === 5 || text.length === 9)) {
    return text.slice(-1).toLowerCase() !== 'f';
  }
  return false;
}

/** HSL → 0–255 RGB。 */
function hslToRgb(hue: number, saturation: number, lightness: number): [number, number, number] {
  const h = (((hue % 360) + 360) % 360) / 360;
  const s = saturation / 100;
  const l = lightness / 100;
  if (s === 0) {
    const value = Math.round(l * 255);
    return [value, value, value];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number): number => {
    let value = t;
    if (value < 0) value += 1;
    if (value > 1) value -= 1;
    if (value < 1 / 6) return p + (q - p) * 6 * value;
    if (value < 1 / 2) return q;
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
    return p;
  };
  return [Math.round(channel(h + 1 / 3) * 255), Math.round(channel(h) * 255), Math.round(channel(h - 1 / 3) * 255)];
}

/** 0–255 通道；越界或非有限值返回 null。 */
function channel(value: number): number | null {
  return Number.isFinite(value) && value >= 0 && value <= 255 ? value : null;
}

function parseColor(value: string): [number, number, number] | null {
  const text = value.trim();
  if (!text || hasAlpha(text)) return null;
  if (UNSUPPORTED_FUNCTIONS.test(text)) return null;

  if (text.startsWith('#')) {
    const hex = text.slice(1);
    // 带 alpha 的 hex 已经在 hasAlpha 里被拦下（alpha 为 ff 的会走到这里，
    // 此时取前 6 位）。
    const opaque = hex.length === 8 ? hex.slice(0, 6) : hex;
    if (opaque.length === 3) {
      const rgb = [...opaque].map((c) => Number.parseInt(c + c, 16));
      if (rgb.some((c) => !Number.isFinite(c))) return null;
      return rgb as [number, number, number];
    }
    if (opaque.length === 6) {
      const rgb = [0, 2, 4].map((i) => Number.parseInt(opaque.slice(i, i + 2), 16));
      if (rgb.some((c) => !Number.isFinite(c))) return null;
      return rgb as [number, number, number];
    }
    return null;
  }

  const hsl = /^hsla?\((.*)\)$/i.exec(text);
  if (hsl) {
    const parts = hsl[1]!.split(/[,\s/]+/).filter(Boolean);
    if (parts.length !== 3) return null;
    const hue = Number.parseFloat(parts[0]!);
    const saturation = Number.parseFloat(parts[1]!);
    const lightness = Number.parseFloat(parts[2]!);
    if (![hue, saturation, lightness].every(Number.isFinite)) return null;
    return hslToRgb(hue, saturation, lightness);
  }

  const rgb = /^rgba?\((.*)\)$/i.exec(text);
  if (rgb) {
    const parts = rgb[1]!.split(/[,\s]+/).filter(Boolean);
    // `rgba(r,g,b,a)` 的 alpha 已在 hasAlpha 里判定：到这里的 4 段一定是
    // alpha >= 1（不透明），丢掉第 4 段即可。
    if (parts.length !== 3 && parts.length !== 4) return null;
    const channels = parts.slice(0, 3).map((part) => (part.endsWith('%') ? (Number.parseFloat(part) / 100) * 255 : Number.parseFloat(part)));
    if (!channels.every((value) => channel(value) !== null)) return null;
    return channels as [number, number, number];
  }

  // 兼容 "32 32 36" 这种不带函数名的裸三元组。
  // 必须是「三个非负整数、以空白分隔、整串匹配」，否则 "10px 20px" 之类的
  // 任意三元组都会被当成颜色。负号在这里同样会被拒掉（旧的 /[\d.]+/g 会把
  // "-10 20 30" 读成 10,20,30）。
  const bare = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(text);
  if (!bare) return null;
  const channels = [Number(bare[1]), Number(bare[2]), Number(bare[3])];
  if (!channels.every((value) => channel(value) !== null)) return null;
  return channels as [number, number, number];
}

function luminance([r, g, b]: [number, number, number]): number {
  const channelValue = (value: number): number => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channelValue(r) + 0.7152 * channelValue(g) + 0.0722 * channelValue(b);
}

/** 1–21 的两位小数；任一侧解析不了（含带 alpha、现代颜色函数）返回 null。 */
export function contrastRatio(foreground: string, background: string): number | null {
  const fg = parseColor(foreground);
  const bg = parseColor(background);
  if (!fg || !bg) return null;
  const a = luminance(fg);
  const b = luminance(bg);
  return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
}
