/**
 * 参数解析：令牌名以 `--` 开头、缺参要报错、`--flag=value` 要生效。
 *
 * 注意每个用例都按**生产调用方式**传 `allowUnknown: false`——旧版本这里
 * 用默认值测 `--flag=value`，结果功能全坏而测试全绿。
 */
import { describe, expect, it } from 'vitest';
import { lastValue, parseArgs, positiveInt, wantsHelp } from '../src/cli/args.ts';

describe('parseArgs', () => {
  it('带值选项收集为数组', () => {
    const parsed = parseArgs(['--props', 'color', '--props', 'background'], { valueFlags: ['--props'], allowUnknown: false });
    expect(parsed.values['--props']).toEqual(['color', 'background']);
  });

  it('支持 --flag=value（生产配置下也生效）', () => {
    const parsed = parseArgs(['--frontend=mobile'], { valueFlags: ['--frontend'], allowUnknown: false });
    expect(lastValue(parsed, '--frontend')).toBe('mobile');
  });

  it('布尔选项支持 --flag=true / --flag=false', () => {
    expect(parseArgs(['--box=true'], { booleanFlags: ['--box'], allowUnknown: false }).flags.has('--box')).toBe(true);
    expect(parseArgs(['--box=false'], { booleanFlags: ['--box'], allowUnknown: false }).flags.has('--box')).toBe(false);
  });

  it('布尔选项给非 true/false 的值时报错', () => {
    expect(() => parseArgs(['--box=yes'], { booleanFlags: ['--box'], allowUnknown: false })).toThrow('只接受 true / false');
  });

  it('未知的 --flag=value 报错时只报选项名', () => {
    expect(() => parseArgs(['--boxx=1'], { allowUnknown: false })).toThrow('未知选项：--boxx');
  });

  it('令牌名以 -- 开头时落到位置参数（allowUnknown=true）', () => {
    const parsed = parseArgs(['--brand-8', '--rc-text-primary'], { allowUnknown: true });
    expect(parsed.positional).toEqual(['--brand-8', '--rc-text-primary']);
  });

  it('带值选项后跟已知选项时报缺参', () => {
    expect(() =>
      parseArgs(['--frontend', '--json'], { valueFlags: ['--frontend'], booleanFlags: ['--json'], allowUnknown: false })
    ).toThrow('--frontend 需要一个参数');
  });

  it('布尔选项进 flags', () => {
    const parsed = parseArgs(['--box'], { booleanFlags: ['--box'], allowUnknown: false });
    expect(parsed.flags.has('--box')).toBe(true);
  });

  it('allowUnknown=false 时未知选项要报错', () => {
    expect(() => parseArgs(['--boxx'], { allowUnknown: false })).toThrow('未知选项：--boxx');
  });

  it('带值选项的值本身可以是以 -- 开头的令牌名', () => {
    const parsed = parseArgs(['--props', '--rc-brand-8', '--box'], {
      valueFlags: ['--props'],
      booleanFlags: ['--box'],
      allowUnknown: false,
    });
    expect(parsed.values['--props']).toEqual(['--rc-brand-8']);
    expect(parsed.flags.has('--box')).toBe(true);
  });

  it('负数坐标是位置参数，不是未知选项', () => {
    const parsed = parseArgs(['-5', '10'], { allowUnknown: false });
    expect(parsed.positional).toEqual(['-5', '10']);
  });
});

describe('parseArgs 的 -- 分隔符', () => {
  it('-- 之后的 token 原样进位置参数', () => {
    const parsed = parseArgs(['#inp', '--', '--json'], { allowUnknown: false });
    expect(parsed.positional).toEqual(['#inp', '--json']);
  });

  it('-- 之后的 --json 不会被当成布尔选项', () => {
    const parsed = parseArgs(['#inp', '--', '--json'], { booleanFlags: ['--json'], allowUnknown: false });
    expect(parsed.flags.has('--json')).toBe(false);
    expect(parsed.positional).toEqual(['#inp', '--json']);
  });

  it('-- 之后的内容不再做 --flag=value 拆分', () => {
    const parsed = parseArgs(['--', '--props=color'], { valueFlags: ['--props'], allowUnknown: false });
    expect(parsed.positional).toEqual(['--props=color']);
    expect(parsed.values['--props']).toBeUndefined();
  });
});

describe('positiveInt', () => {
  it('非法值报错而不是静默变 NaN', () => {
    const parsed = parseArgs(['--limit', 'abc'], { valueFlags: ['--limit'], allowUnknown: false });
    expect(() => positiveInt(parsed, '--limit', 5)).toThrow('必须是正整数');
  });

  it('未传返回 fallback', () => {
    expect(positiveInt(parseArgs([], { allowUnknown: false }), '--limit', 5)).toBe(5);
  });
});

describe('wantsHelp', () => {
  it('空 argv 与 help 子命令算帮助', () => {
    expect(wantsHelp([])).toBe(true);
    expect(wantsHelp(['help'])).toBe(true);
  });

  it('命令名之前的 --help / -h 算帮助', () => {
    expect(wantsHelp(['--help'])).toBe(true);
    expect(wantsHelp(['-h'])).toBe(true);
    expect(wantsHelp(['do', '--help'])).toBe(true);
  });

  it('命令参数里的 --help 算帮助（要传字面量用 -- 分隔）', () => {
    expect(wantsHelp(['do', 'press', '--help'])).toBe(true);
    expect(wantsHelp(['read', 'element', '.x', '-h'])).toBe(true);
    // do fill x -- --help：--help 是要输入的文本
    expect(wantsHelp(['do', 'fill', '.x', '--', '--help'])).toBe(false);
  });
});
