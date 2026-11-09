/** 对比度解析：hex / rgb / hsl / 现代颜色函数 / alpha 边界。 */
import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../src/cli/contrast.ts';

describe('contrastRatio', () => {
  it('黑白色对比度为 21', () => {
    expect(contrastRatio('#000', '#fff')).toBe(21);
    expect(contrastRatio('rgb(0, 0, 0)', 'rgb(255, 255, 255)')).toBe(21);
    expect(contrastRatio('rgb(0 0 0)', 'rgb(255 255 255)')).toBe(21);
  });

  it('HSL 按真实色相计算，不把 HSL 数字误当 RGB', () => {
    // red (#ff0000) on white 约 3.998:1，四舍五入为 4；旧实现会错误得到 7.32。
    expect(contrastRatio('hsl(0, 100%, 50%)', '#fff')).toBe(4);
    expect(contrastRatio('hsl(0 100% 50%)', '#fff')).toBe(4);
  });

  it('带 alpha 的颜色解析失败返回 null', () => {
    expect(contrastRatio('rgba(0, 0, 0, 0.5)', '#fff')).toBeNull();
    expect(contrastRatio('rgb(0 0 0 / 50%)', '#fff')).toBeNull();
    expect(contrastRatio('#00000080', '#fff')).toBeNull();
    expect(contrastRatio('#abcd', '#fff')).toBeNull();
  });

  it('alpha=1 的不透明色仍然可算', () => {
    expect(contrastRatio('rgba(0, 0, 0, 1)', '#fff')).toBe(21);
    expect(contrastRatio('#000000ff', '#fff')).toBe(21);
    // alpha 解析不出来时宁可 null 也不猜
    expect(contrastRatio('rgba(0, 0, 0, abc)', '#fff')).toBeNull();
  });

  it('非法颜色返回 null 而不是 NaN', () => {
    expect(contrastRatio('#zzzzzz', '#fff')).toBeNull();
    expect(contrastRatio('red', '#fff')).toBeNull();
    expect(contrastRatio('', '#fff')).toBeNull();
  });

  /**
   * 回归：旧实现的兜底 `text.match(/[\d.]+/g)` 会把任何含 3 个数字的字符串
   * 当 RGB。`oklch(0.7 0.1 200)` 因此得到 11.44（看着像达标），真实值 ≈ 1.6。
   */
  it('现代颜色函数返回 null，不能被兜底当成裸三元组', () => {
    for (const color of [
      'oklch(0.7 0.1 200)',
      'oklab(0.7 0.1 0.1)',
      'lab(50% 40 59.5)',
      'lch(52.2% 72.2 50)',
      'hwb(0 0% 0%)',
      'color(display-p3 1 0 0)',
      'color-mix(in srgb, #000 50%, #fff)',
    ]) {
      expect(contrastRatio(color, '#fff'), color).toBeNull();
    }
  });

  it('裸三元组只接受三个非负整数、以空白分隔的整串', () => {
    expect(contrastRatio('32 32 36', '#fff')).not.toBeNull();
    // 负号不能被吃掉当成 10,20,30
    expect(contrastRatio('-10 20 30', '#fff')).toBeNull();
    // 任意三个数字不算颜色
    expect(contrastRatio('10px 20px', '#fff')).toBeNull();
    expect(contrastRatio('1.2.3', '#fff')).toBeNull();
    expect(contrastRatio('a 1 b 2 c 3', '#fff')).toBeNull();
  });
});
