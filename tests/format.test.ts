/** 输出排版：数据走 stdout、状态走 stderr、--json 只有 JSON。 */
import { describe, expect, it, vi } from 'vitest';
import { note, output } from '../src/cli/format.ts';

/** 收集 console.log 的参数。 */
function capture(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  });
  return { lines, restore: () => spy.mockRestore() };
}

describe('output', () => {
  it('--json 输出格式化 JSON，可直接被 jq 消费', () => {
    const { lines, restore } = capture();
    output({ a: 1 }, true);
    restore();
    expect(lines.join('\n')).toBe(JSON.stringify({ a: 1 }, null, 2));
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
