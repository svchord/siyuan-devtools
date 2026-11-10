/**
 * 全局选项剥离。
 *
 * 这一层是最容易出错的地方：它扫 argv，一旦扫得太宽就会吃掉命令的
 * 位置参数（`do fill '#inp' --json` 里的 `--json` 是要输入的文本）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setPretty } from '../src/cli/format.ts';
import { main, takeGlobals } from '../src/cli/main.ts';

/** 不带任何全局选项时的基线。 */
const NONE = { json: false, pretty: false, raw: false, at: null, url: null };

/** 收集 stdout。 */
function capture(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  });
  return { lines, restore: () => spy.mockRestore() };
}

// 缩进是模块级开关，用例之间必须复位。
afterEach(() => setPretty(false));

describe('takeGlobals', () => {
  it('命令名之前没有全局选项时原样透传', () => {
    expect(takeGlobals(['read', 'env'])).toEqual({ ...NONE, rest: ['read', 'env'] });
  });

  it('命令名之前的 --json / --url 被取出', () => {
    expect(takeGlobals(['--json', '--url', 'http://x/', 'read', 'env'])).toEqual({
      ...NONE,
      json: true,
      url: 'http://x/',
      rest: ['read', 'env'],
    });
  });

  it('支持 --url=value', () => {
    expect(takeGlobals(['--url=http://x/', 'status'])).toEqual({ ...NONE, url: 'http://x/', rest: ['status'] });
  });

  it('命令名之后的 --json 也是全局选项', () => {
    // README 里的写法：read tokens --json
    expect(takeGlobals(['read', 'tokens', '--json'])).toEqual({ ...NONE, json: true, rest: ['read', 'tokens'] });
  });

  it('-- 之后的 --json 是要传给命令的字面量', () => {
    // do fill '#inp' -- --json：把字面量 --json 输入到页面。
    expect(takeGlobals(['do', 'fill', '#inp', '--', '--json'])).toEqual({
      ...NONE,
      rest: ['do', 'fill', '#inp', '--', '--json'],
    });
  });

  it('-- 之后的 --pretty / --raw 同样是字面量', () => {
    expect(takeGlobals(['do', 'fill', '#inp', '--', '--pretty', '--raw'])).toEqual({
      ...NONE,
      rest: ['do', 'fill', '#inp', '--', '--pretty', '--raw'],
    });
  });

  it('命令名之后的 --url 也是全局选项', () => {
    expect(takeGlobals(['do', 'fill', '#inp', '--url', 'http://x/']).url).toBe('http://x/');
  });

  it('--pretty 隐含 --json：否则缩进无处生效', () => {
    expect(takeGlobals(['--pretty', 'read', 'env'])).toEqual({
      ...NONE,
      json: true,
      pretty: true,
      rest: ['read', 'env'],
    });
  });

  it('--raw 只被摘出，不隐含其它开关', () => {
    expect(takeGlobals(['--raw', 'status'])).toEqual({ ...NONE, raw: true, rest: ['status'] });
  });

  it('--at 取出取值，不影响其它开关', () => {
    expect(takeGlobals(['--at', 'all', 'read', 'tokens', '--brand-8'])).toEqual({
      ...NONE,
      at: 'all',
      rest: ['read', 'tokens', '--brand-8'],
    });
    expect(takeGlobals(['read', 'tokens', '--at=desktop/dark/default'])).toEqual({
      ...NONE,
      at: 'desktop/dark/default',
      rest: ['read', 'tokens'],
    });
  });

  it('--at 缺参时报错，不会把下一个选项吞成值', () => {
    expect(() => takeGlobals(['--at'])).toThrow('--at 需要一个参数');
    expect(() => takeGlobals(['--at='])).toThrow('--at 需要一个参数');
    expect(() => takeGlobals(['--at', '--json', 'read', 'env'])).toThrow('--at 需要一个参数');
  });

  it('--at 之后的令牌名不会被当成 --at 的值', () => {
    // read tokens 的位置参数本身以 -- 开头，不能被全局选项剥离吃掉。
    const globals = takeGlobals(['read', 'tokens', '--brand-8', '--at', 'desktop']);
    expect(globals.at).toBe('desktop');
    expect(globals.rest).toEqual(['read', 'tokens', '--brand-8']);
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

describe('--raw 的适用范围', () => {
  it('给 status 之外的命令时报错，而不是静默忽略', async () => {
    // 这条路径在要求会话之前就失败，不碰浏览器。
    await expect(main(['--raw', 'read', 'env'])).rejects.toThrow('--raw 只用于 status');
  });
});

describe('--at 的适用范围', () => {
  it('给会话命令时报错（它只用于纯测量）', async () => {
    await expect(main(['--at', 'all', 'reload'])).rejects.toThrow('--at 只用于 read / shot');
    await expect(main(['--at', 'all', 'open'])).rejects.toThrow('--at 只用于 read / shot');
    await expect(main(['--at', 'all', 'do', 'hover', '.x'])).rejects.toThrow('--at 只用于 read / shot');
  });

  it('字面量颜色的 contrast 拒绝 --at：与页面状态无关', async () => {
    await expect(main(['--at', 'all', 'read', 'contrast', '#000', '#fff'])).rejects.toThrow(
      '两个字面量颜色不接受 --at'
    );
  });
});

describe('--pretty 的分发', () => {
  // 字面量颜色的 contrast 不碰浏览器，适合验证「输出长什么样」。
  it('--json 默认紧凑', async () => {
    const { lines, restore } = capture();
    await main(['--json', 'read', 'contrast', '#000', '#fff']);
    restore();
    expect(lines.join('\n')).toBe(JSON.stringify({ foreground: '#000', background: '#fff', ratio: 21 }));
  });

  it('--pretty 单独出现也生效：缩进 JSON，无需再给 --json', async () => {
    const { lines, restore } = capture();
    await main(['--pretty', 'read', 'contrast', '#000', '#fff']);
    restore();
    expect(lines.join('\n')).toBe(
      JSON.stringify({ foreground: '#000', background: '#fff', ratio: 21 }, null, 2)
    );
  });
});
