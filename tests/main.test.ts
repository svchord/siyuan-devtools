/**
 * 全局选项剥离。
 *
 * 这一层是最容易出错的地方：它扫 argv，一旦扫得太宽就会吃掉命令的
 * 位置参数（`do fill '#inp' --json` 里的 `--json` 是要输入的文本）。
 */
import { describe, expect, it } from 'vitest';
import { takeGlobals } from '../src/cli/main.ts';

describe('takeGlobals', () => {
  it('命令名之前没有全局选项时原样透传', () => {
    expect(takeGlobals(['read', 'env'])).toEqual({ json: false, url: null, rest: ['read', 'env'] });
  });

  it('命令名之前的 --json / --url 被取出', () => {
    expect(takeGlobals(['--json', '--url', 'http://x/', 'read', 'env'])).toEqual({
      json: true,
      url: 'http://x/',
      rest: ['read', 'env'],
    });
  });

  it('支持 --url=value', () => {
    expect(takeGlobals(['--url=http://x/', 'status'])).toEqual({ json: false, url: 'http://x/', rest: ['status'] });
  });

  it('命令名之后的 --json 也是全局选项', () => {
    // README 里的写法：read tokens --json
    expect(takeGlobals(['read', 'tokens', '--json'])).toEqual({ json: true, url: null, rest: ['read', 'tokens'] });
  });

  it('-- 之后的 --json 是要传给命令的字面量', () => {
    // do fill '#inp' -- --json：把字面量 --json 输入到页面。
    expect(takeGlobals(['do', 'fill', '#inp', '--', '--json'])).toEqual({
      json: false,
      url: null,
      rest: ['do', 'fill', '#inp', '--', '--json'],
    });
  });

  it('命令名之后的 --url 也是全局选项', () => {
    expect(takeGlobals(['do', 'fill', '#inp', '--url', 'http://x/']).url).toBe('http://x/');
  });

  it('--url 缺参时报错', () => {
    expect(() => takeGlobals(['--url'])).toThrow('--url 需要一个参数');
    expect(() => takeGlobals(['--url='])).toThrow('--url 需要一个参数');
    expect(() => takeGlobals(['--url', '--'])).toThrow('--url 需要一个参数');
  });

  it('--url 不会把下一个选项吞成值', () => {
    // 旧实现 `--url --json status` 会把 --json 当 URL，json 变 false。
    expect(() => takeGlobals(['--url', '--json', 'status'])).toThrow('--url 需要一个参数');
    expect(() => takeGlobals(['--url', '--frontend', 'mobile'])).toThrow('--url 需要一个参数');
  });
});
