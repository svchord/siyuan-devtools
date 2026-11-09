/** 输出排版：数据走 stdout、状态走 stderr、--json 只有 JSON、--pretty 才缩进。 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { note, output, setPretty } from '../src/cli/format.ts';

/** 收集 console.log 的参数。 */
function capture(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  });
  return { lines, restore: () => spy.mockRestore() };
}

// 缩进是模块级开关，用例之间必须复位，否则结果取决于执行顺序。
afterEach(() => setPretty(false));

describe('output', () => {
  it('--json 默认紧凑输出：缩进换行对 agent 是纯开销', () => {
    const { lines, restore } = capture();
    output({ a: 1, b: [2] }, true);
    restore();
    expect(lines.join('\n')).toBe(JSON.stringify({ a: 1, b: [2] }));
  });

  it('--pretty 时输出缩进 JSON，仍可被 jq 消费', () => {
    const { lines, restore } = capture();
    setPretty(true);
    output({ a: 1 }, true);
    restore();
    expect(lines.join('\n')).toBe(JSON.stringify({ a: 1 }, null, 2));
  });

  it('undefined 在 JSON 模式下折成 null，不会打出字面量 undefined', () => {
    const { lines, restore } = capture();
    output(undefined, true);
    restore();
    expect(lines).toEqual(['null']);
  });

  it('字符串按原样输出（调用方已排好版）', () => {
    const { lines, restore } = capture();
    output('shots/a.png\nshots/b.png', false);
    restore();
    expect(lines).toEqual(['shots/a.png\nshots/b.png']);
  });

  it('对象渲染成人读文本', () => {
    const { lines, restore } = capture();
    output({ color: 'red', nested: { size: 3 } }, false);
    restore();
    expect(lines.join('\n')).toContain('color: red');
    expect(lines.join('\n')).toContain('size: 3');
  });

  it('空数组 / null 有明确占位，不是空白', () => {
    const { lines, restore } = capture();
    output({ list: [], missing: null }, false);
    restore();
    expect(lines.join('\n')).toContain('(空)');
    expect(lines.join('\n')).toContain('(无)');
  });
});

describe('note', () => {
  it('走 stderr，不污染 stdout', () => {
    const err: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      err.push(args.map(String).join(' '));
    });
    note('已打开');
    spy.mockRestore();
    expect(err).toEqual(['已打开']);
  });
});
