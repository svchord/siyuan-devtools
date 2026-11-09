/** 错误渲染：用户错误原样输出，内部错误加提示且不甩堆栈。 */
import { describe, expect, it } from 'vitest';
import { describeError, firstLine, renderError, UserError } from '../src/cli/errors.ts';

describe('describeError', () => {
  it('只取第一条非空行，剥掉 Playwright 的多行堆栈', () => {
    const cause = new Error('TypeError: x is not a function\n    at eval (<anonymous>:1:1)\n    at y');
    expect(describeError(cause)).toBe('TypeError: x is not a function');
  });

  it('非 Error 值转成字符串', () => {
    expect(describeError('boom')).toBe('boom');
    expect(describeError(42)).toBe('42');
  });
});

describe('firstLine', () => {
  it('跳过开头的空行', () => {
    expect(firstLine('\n\n  real message  \nsecond')).toBe('real message');
  });

  it('全是空行时返回原文', () => {
    expect(firstLine('   ')).toBe('   ');
  });
});

describe('renderError', () => {
  it('UserError 原样输出，不加前缀', () => {
    expect(renderError(new UserError('未启动浏览器会话'))).toBe('未启动浏览器会话');
  });

  it('其它异常标注为内部错误，提示反馈', () => {
    const text = renderError(new TypeError('undefined is not a function'));
    expect(text).toContain('内部错误');
    expect(text).toContain('undefined is not a function');
    expect(text).toContain('反馈');
    expect(text).not.toContain('at ');
  });
});
