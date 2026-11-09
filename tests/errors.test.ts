/** 错误渲染：用户错误原样输出，内部错误加提示且不甩堆栈。 */
import { describe, expect, it } from 'vitest';
import { describeError, firstLine, renderError, UserError } from '../src/cli/errors.ts';
import { extractErrorText } from '../src/cli/playwright.ts';

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

/**
 * `do hover` 失败时 stderr 只有 10 字节的 `### Error`，真实原因在 stdout
 * 的几 KB 里。对 agent 来说这是最贵的失败模式：拿不到原因就只能重试。
 */
describe('extractErrorText', () => {
  /** playwright-cli 失败时的真实输出形状。 */
  const STDERR = '### Error';
  const STDOUT = [
    '### Ran Playwright code',
    '```js',
    "await page.locator('.dock__item').hover();",
    '```',
    '### Error',
    "Error: Error: strict mode violation: locator('.dock__item') resolved to 9 elements:",
    '    1) <div class="dock__item">…',
    '',
  ].join('\n');

  it('跳过横幅与围栏，取 stdout 里的真实错误', () => {
    expect(extractErrorText(STDOUT, STDERR, 2)).toBe(
      "strict mode violation: locator('.dock__item') resolved to 9 elements:"
    );
  });

  it('剥掉重复的 Error: 前缀', () => {
    expect(extractErrorText('Error: Error: Error: boom', '', 1)).toBe('boom');
    expect(extractErrorText('Error: boom', '', 1)).toBe('boom');
  });

  it('最多剥三层，更深的当消息内容保留', () => {
    const text = 'Error: Error: Error: Error: still prefixed';
    expect(extractErrorText(text, '', 1)).toBe('Error: still prefixed');
  });

  it('stderr 有正文时优先用 stderr', () => {
    expect(extractErrorText('Error: from stdout', 'Error: from stderr', 1)).toBe('from stderr');
  });

  it('跳过 ### 标题行与 ``` 围栏行', () => {
    const text = ['### Call log', '### Error logs', '```txt', '### Error', 'real message'].join('\n');
    expect(extractErrorText(text, '', 1)).toBe('real message');
  });

  it('两边都没有有效行时退回退出码', () => {
    expect(extractErrorText('', '### Error', 2)).toBe('playwright-cli 退出码 2');
    expect(extractErrorText('', '', null)).toBe('playwright-cli 退出码 null');
  });

  it('不把空行当成消息', () => {
    expect(extractErrorText('\n\n  real  \n\n', '', 0)).toBe('real');
  });
});
