/**
 * 参数解析：令牌名以 `--` 开头、缺参要报错。
 */
import { describe, expect, it } from 'vitest';
import { lastValue, parseArgs, positiveInt, splitList } from '../src/cli/args.ts';

describe('parseArgs', () => {
  it('带值选项收集为数组', () => {
    const parsed = parseArgs(['--props', 'color', '--props', 'background'], { valueFlags: ['--props'] });
    expect(parsed.values['--props']).toEqual(['color', 'background']);
  });

  it('支持 --flag=value', () => {
    const parsed = parseArgs(['--frontend=mobile'], { valueFlags: ['--frontend'] });
    expect(lastValue(parsed, '--frontend')).toBe('mobile');
  });

  it('令牌名以 -- 开头时落到位置参数', () => {
    const parsed = parseArgs(['--brand-8', '--rc-text-primary'], {});
    expect(parsed.positional).toEqual(['--brand-8', '--rc-text-primary']);
  });

  it('带值选项后跟已知选项时报缺参', () => {
    expect(() => parseArgs(['--frontend', '--json'], { valueFlags: ['--frontend'], booleanFlags: ['--json'] })).toThrow(
      '--frontend 需要一个参数'
    );
  });

  it('布尔选项进 flags', () => {
    const parsed = parseArgs(['--json', '--box'], { booleanFlags: ['--json', '--box'] });
    expect(parsed.flags.has('--json')).toBe(true);
    expect(parsed.flags.has('--box')).toBe(true);
  });
});

describe('splitList', () => {
  it('拆逗号并去空白', () => {
    expect(splitList('color, background-color')).toEqual(['color', 'background-color']);
  });

  it('未传返回 undefined', () => {
    expect(splitList(undefined)).toBeUndefined();
  });
});

describe('positiveInt', () => {
  it('非法值报错而不是静默变 NaN', () => {
    const parsed = parseArgs(['--limit', 'abc'], { valueFlags: ['--limit'] });
    expect(() => positiveInt(parsed, '--limit', 5)).toThrow('必须是正整数');
  });

  it('未传返回 fallback', () => {
    expect(positiveInt(parseArgs([], {}), '--limit', 5)).toBe(5);
  });
});
