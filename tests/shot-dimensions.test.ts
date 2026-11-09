/**
 * shot 的维度参数与格子展开：明暗与密度是独立的 `<html>` 属性，可以组合。
 *
 * 这里只测参数解析与 `planCells` 的纯逻辑，不真的截图（需要浏览器与思源）。
 *
 * 两条事实决定了取值域（上游思源 3.8.8+ 实测）：
 *  - `data-ui-density` 只有 `compact` 一个合法值，普通态是**没有属性**；
 *  - 紧凑模式只在桌面系可用，移动端永远没有。
 */
import { describe, expect, it } from 'vitest';
import { DIMENSIONS, parseDimension, parseDimensionList } from '../src/cli/dimensions.ts';
import { planCells } from '../src/cli/dimensions.ts';

describe('parseDimension', () => {
  it('未传返回 null（保持「不改变当前状态」语义）', () => {
    expect(parseDimension('--theme', undefined)).toBeNull();
    expect(parseDimension('--density', undefined)).toBeNull();
  });

  it('密度只接受 default / compact', () => {
    expect(parseDimension('--density', 'default')).toBe('default');
    expect(parseDimension('--density', 'compact')).toBe('compact');
  });

  it('comfortable 报错，并指出上游普通态是没有该属性', () => {
    // 旧实现把 comfortable 当合法值写进属性：实测与「删掉属性」逐项一致
    // （空操作），但 read env 会把它回显成一个产品到不了的状态。
    expect(() => parseDimension('--density', 'comfortable')).toThrow('comfortable');
    expect(() => parseDimension('--density', 'comfortable')).toThrow('default');
  });

  it('主题只接受 dark / light', () => {
    expect(parseDimension('--theme', 'dark')).toBe('dark');
    expect(parseDimension('--theme', 'light')).toBe('light');
    expect(() => parseDimension('--theme', 'compact')).toThrow('取值不合法');
  });

  it('密度不接受主题的值（两个维度不能混用）', () => {
    expect(() => parseDimension('--density', 'dark')).toThrow('取值不合法');
    expect(() => parseDimension('--density', 'loose')).toThrow('取值不合法');
  });

  it('两个维度映射到不同属性（可以组合成「暗色 + 紧凑」）', () => {
    expect(DIMENSIONS['--theme'].attribute).toBe('data-theme-mode');
    expect(DIMENSIONS['--density'].attribute).toBe('data-ui-density');
    expect(DIMENSIONS['--theme'].attribute).not.toBe(DIMENSIONS['--density'].attribute);
  });
});

describe('parseDimensionList', () => {
  it('单值兼容', () => {
    expect(parseDimensionList('--theme', 'dark')).toEqual(['dark']);
    expect(parseDimensionList('--density', 'compact')).toEqual(['compact']);
  });

  it('逗号多值按给出顺序展开', () => {
    expect(parseDimensionList('--theme', 'light,dark')).toEqual(['light', 'dark']);
    expect(parseDimensionList('--density', 'default,compact')).toEqual(['default', 'compact']);
  });

  it('重复值去重（否则同一个文件名会被截两次）', () => {
    expect(parseDimensionList('--theme', 'dark,dark')).toEqual(['dark']);
  });

  it('逐个校验：只有错的那个值报错', () => {
    expect(() => parseDimensionList('--theme', 'dark,purple')).toThrow('purple');
    expect(() => parseDimensionList('--density', 'default,comfortable')).toThrow('default');
  });

  it('未传返回 null', () => {
    expect(parseDimensionList('--theme', undefined)).toBeNull();
  });
});

describe('planCells', () => {
  it('frontend 外层、theme × density 内层（同前端连续，才能复用一次导航）', () => {
    const { cells } = planCells({
      frontends: ['desktop', 'mobile'],
      themes: ['light', 'dark'],
      densities: ['default'],
    });
    expect(cells.map((cell) => `${cell.frontend}/${cell.theme}/${cell.density}`)).toEqual([
      'desktop/light/default',
      'desktop/dark/default',
      'mobile/light/default',
      'mobile/dark/default',
    ]);
  });

  it('完整矩阵：mobile × compact 被跳过并给出原因', () => {
    const { cells, skipped } = planCells({
      frontends: ['desktop', 'mobile'],
      themes: ['light', 'dark'],
      densities: ['default', 'compact'],
    });
    // 2×2×2 = 8 种组合，减去上游不存在的 mobile×compact×2 = 6 格。
    expect(cells).toHaveLength(6);
    expect(cells.some((cell) => cell.frontend === 'mobile' && cell.density === 'compact')).toBe(false);
    expect(skipped).toHaveLength(2);
    for (const item of skipped) {
      expect(item.frontend).toBe('mobile');
      expect(item.density).toBe('compact');
      expect(item.message).toContain('移动端没有紧凑模式');
    }
  });

  it('desktop × compact 是合法格子', () => {
    const { cells, skipped } = planCells({
      frontends: ['desktop'],
      themes: ['dark'],
      densities: ['compact'],
    });
    expect(skipped).toHaveLength(0);
    expect(cells).toEqual([{ frontend: 'desktop', theme: 'dark', density: 'compact', file: 'desktop-dark-compact.png' }]);
  });

  it('文件名带全部生效维度（旧实现只带密度，明暗会互相覆盖）', () => {
    const { cells } = planCells({
      frontends: ['desktop', 'mobile'],
      themes: ['light', 'dark'],
      densities: ['default', 'compact'],
    });
    const files = cells.map((cell) => cell.file);
    expect(files).toContain('desktop-light-default.png');
    expect(files).toContain('desktop-dark-compact.png');
    expect(files).toContain('mobile-dark-default.png');
    expect(new Set(files).size).toBe(files.length);
  });

  it('维度为 null 时不出现在文件名里（单前端单组合仍是 desktop.png）', () => {
    const { cells } = planCells({ frontends: ['desktop'], themes: [null], densities: [null] });
    expect(cells).toEqual([{ frontend: 'desktop', theme: null, density: null, file: 'desktop.png' }]);
  });
});
