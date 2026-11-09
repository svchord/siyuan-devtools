/**
 * shot 的维度参数：明暗与密度是独立的 `<html>` 属性，可以组合。
 *
 * 这里只测参数解析与文件名，不真的截图（需要浏览器与思源）。
 */
import { describe, expect, it } from 'vitest';
import { DIMENSIONS, parseDimension } from '../src/cli/commands/shot.ts';

describe('parseDimension', () => {
  it('未传返回 null（保持「不改变当前状态」语义）', () => {
    expect(parseDimension('--theme', undefined)).toBeNull();
    expect(parseDimension('--density', undefined)).toBeNull();
  });

  it('comfortable 是合法密度（思源默认值）', () => {
    expect(parseDimension('--density', 'comfortable')).toBe('comfortable');
  });

  it('主题只接受 dark / light', () => {
    expect(parseDimension('--theme', 'dark')).toBe('dark');
    expect(parseDimension('--theme', 'light')).toBe('light');
    expect(() => parseDimension('--theme', 'compact')).toThrow('取值不合法');
  });

  it('密度只接受 comfortable / compact', () => {
    expect(() => parseDimension('--density', 'dark')).toThrow('取值不合法');
    expect(() => parseDimension('--density', 'loose')).toThrow('取值不合法');
  });

  it('两个维度映射到不同属性（可以组合成「暗色 + 紧凑」）', () => {
    expect(DIMENSIONS['--theme'].attribute).toBe('data-theme-mode');
    expect(DIMENSIONS['--density'].attribute).toBe('data-ui-density');
    expect(DIMENSIONS['--theme'].attribute).not.toBe(DIMENSIONS['--density'].attribute);
  });
});
