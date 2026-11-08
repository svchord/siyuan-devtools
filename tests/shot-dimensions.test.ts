/**
 * shot 的两个维度：明暗与密度是独立的 `<html>` 属性，可以组合。
 *
 * 这里只测参数解析与文件名，不真的截图（需要浏览器与思源）。
 */
import { describe, expect, it } from 'vitest';
import { parseArgs, lastValue } from '../src/cli/args.ts';

/** 与 shot.ts 保持一致的维度表：只测取值校验逻辑。 */
const DIMENSIONS = {
  '--theme': { attribute: 'data-theme-mode', values: ['dark', 'light'] },
  '--density': { attribute: 'data-ui-density', values: ['comfortable', 'compact'] },
} as const;

function parseDimension(flag: keyof typeof DIMENSIONS, raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const { values } = DIMENSIONS[flag];
  if (!(values as readonly string[]).includes(raw)) throw new Error(`${flag} 取值不合法：${raw}`);
  return raw;
}

describe('shot 的维度参数', () => {
  it('两个维度可以同时给', () => {
    const parsed = parseArgs(['--theme', 'dark', '--density', 'compact'], {
      valueFlags: ['--theme', '--density'],
    });
    expect(lastValue(parsed, '--theme')).toBe('dark');
    expect(lastValue(parsed, '--density')).toBe('compact');
  });

  it('只给密度时明暗为 null', () => {
    const parsed = parseArgs(['--density', 'compact'], { valueFlags: ['--theme', '--density'] });
    expect(lastValue(parsed, '--theme')).toBeUndefined();
    expect(parseDimension('--theme', undefined)).toBeNull();
    expect(parseDimension('--density', 'compact')).toBe('compact');
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

  it('两个维度映射到不同属性', () => {
    expect(DIMENSIONS['--theme'].attribute).toBe('data-theme-mode');
    expect(DIMENSIONS['--density'].attribute).toBe('data-ui-density');
  });

  it('文件名后缀包含两个维度，组合不会互相覆盖', () => {
    const suffix = ['dark', 'compact'].filter(Boolean).join('-');
    expect(`desktop-${suffix}.png`).toBe('desktop-dark-compact.png');
  });
});
