/** 对比度解析：hex / rgb / hsl / alpha 边界。 */
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
  });

  it('非法颜色返回 null 而不是 NaN', () => {
    expect(contrastRatio('#zzzzzz', '#fff')).toBeNull();
    expect(contrastRatio('red', '#fff')).toBeNull();
  });
});
