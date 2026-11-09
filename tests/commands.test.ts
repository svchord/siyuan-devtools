/**
 * do / read 的参数分派与校验。
 *
 * 这两层是 CLI 最危险的地方：参数写错时要**在动浏览器之前**报错，
 * 而且不能静默忽略（旧实现 `do menu theme --count 9` 会返回 ok:true）。
 *
 * 这里只测「不需要浏览器就能失败」的路径：校验顺序是参数在前、会话在后。
 * 会话存在性用假实现替换：真实的 `sessionExists()` 取决于 cwd 下有没有
 * `.playwright`，同一台机器开过浏览器之后，原本期望「未启动」的用例会走进
 * 真会话分支（实测报 `### Error` 而不是「未启动浏览器会话」）——测试结论
 * 不该取决于运行环境。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { doAction } from '../src/cli/commands/do.ts';
import { read } from '../src/cli/commands/read.ts';

/** 由用例控制的会话状态与页面求值结果。 */
const fake = vi.hoisted(() => ({
  session: false,
  evaluate: vi.fn(),
}));

vi.mock('../src/cli/playwright.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/cli/playwright.ts')>();
  // 只替换两个与环境耦合的入口，其余（cliPath / workspace 等）保持真实。
  return { ...actual, sessionExists: () => fake.session, evalScript: fake.evaluate };
});

/** 收集 stdout。 */
function capture(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  });
  return { lines, restore: () => spy.mockRestore() };
}

beforeEach(() => {
  fake.session = false;
  fake.evaluate.mockReset();
});

/** 断言某个调用抛出的错误信息包含某段文字。 */
async function expectReject(run: () => Promise<unknown> | unknown, text: string): Promise<void> {
  await expect(async () => {
    await run();
  }).rejects.toThrow(text);
}

describe('do 的参数校验', () => {
  it('没有动作名时报错', async () => {
    await expectReject(() => doAction([], false), 'do 需要动作名');
  });

  it('未知动作报错', async () => {
    await expectReject(() => doAction(['teleport', '.x'], false), '未知动作');
  });

  it('参数错误优先于「未启动会话」报出', async () => {
    // 参数写错时不该先被「未启动」挡住，否则 agent 会先去 open 再撞同一个错。
    await expectReject(() => doAction(['click'], false), 'do click 需要选择器');
    await expectReject(() => doAction(['mousemove', '1'], false), 'do mousemove 需要 x y');
    await expectReject(() => doAction(['drag', '.a'], false), 'do drag 需要起点与终点选择器');
    await expectReject(() => doAction(['fill', '.a'], false), 'do fill 需要文本');
    await expectReject(() => doAction(['attr'], false), 'do attr 需要 name=value');
  });

  it('--button 只用于 click / dblclick', async () => {
    await expectReject(() => doAction(['hover', '.a', '--button', 'right'], false), '--button 不支持 hover');
    await expectReject(() => doAction(['press', 'Enter', '--button', 'right'], false), '--button 不支持 press');
  });

  it('--count 只用于 click', async () => {
    await expectReject(() => doAction(['hover', '.a', '--count', '2'], false), '--count 不支持 hover');
    await expectReject(() => doAction(['menu', 'theme', '--count', '9'], false), '--count 不支持 menu');
  });

  it('--count 超过 2 报错', async () => {
    await expectReject(() => doAction(['click', '.a', '--count', '3'], false), '只支持 1 或 2');
  });

  it('--button 取值非法时报错', async () => {
    await expectReject(() => doAction(['click', '.a', '--button', 'foo'], false), '--button 取值不合法');
    await expectReject(() => doAction(['click', '.a', '--button', 'side'], false), '--button 取值不合法');
  });

  it('空字符串是合法的 fill 值（清空输入框）', async () => {
    // 只要给了文本参数就不算缺参；空串会走到会话检查。
    // 会话由假实现固定为「不存在」，结论与本机是否开着浏览器无关。
    await expectReject(() => doAction(['fill', '#inp', ''], false), '未启动浏览器会话');
  });

  it('--diff 只用于支持读样的动作', async () => {
    await expectReject(() => doAction(['menu', 'theme', '--diff', 'color'], false), '--diff 不支持 menu');
    await expectReject(() => doAction(['press', 'Enter', '--diff', 'color'], false), '--diff 不支持 press');
    await expectReject(() => doAction(['reset', '--diff', 'color'], false), '--diff 不支持 reset');
  });

  it('未知选项报错，不静默忽略', async () => {
    await expectReject(() => doAction(['click', '.a', '--boxx'], false), '未知选项');
  });
});

describe('read 的参数校验', () => {
  it('没有子命令时报错', () => {
    expect(() => read([], false)).toThrow('read 需要子命令');
  });

  it('未知子命令报错', () => {
    expect(() => read(['styles'], false)).toThrow('未知 read 子命令');
  });

  it('contrast 缺参数时报错', () => {
    expect(() => read(['contrast', '--a'], false)).toThrow('需要前景与背景');
  });

  it('字面量颜色的 contrast 不需要浏览器', () => {
    // 没有会话也应该能算：这条路径完全不碰浏览器。
    const { restore } = capture();
    expect(() => read(['contrast', '#000', '#fff'], true)).not.toThrow();
    restore();
  });

  it('tokens 的非 -- 参数报错，而不是被静默丢掉', () => {
    expect(() => read(['tokens', 'brand-8'], false)).toThrow('令牌名必须以 -- 开头');
  });

  it('tokens 一个令牌都没给时报错', () => {
    expect(() => read(['tokens'], false)).toThrow('至少一个令牌名');
  });

  it('element 缺选择器时报错', () => {
    expect(() => read(['element'], false)).toThrow('read element 需要选择器');
  });

  it('--limit 不给 --box 时报错（否则静默无效）', () => {
    expect(() => read(['element', '.x', '--limit', '3'], false)).toThrow('--limit 只能与 --box 一起使用');
  });

  it('--props 非法时报错', () => {
    expect(() => read(['element', '.x', '--props', ''], false)).toThrow('不能为空');
    expect(() => read(['element', '.x', '--props', 'col or'], false)).toThrow('不合法');
  });

  it('tokens 的 -- 分隔符不算令牌名', () => {
    // `--` 是字面量分隔符，不能当成令牌名发给页面。
    expect(() => read(['tokens', '--'], false)).toThrow('至少一个令牌名');
  });

  it('element 的未知选项报错', () => {
    expect(() => read(['element', '.x', '--boxx'], false)).toThrow('未知选项');
  });
});

describe('read element 的输出投影', () => {
  /** 页面片段的原始返回；tag / className 是其中默认要丢掉的部分。 */
  const RAW = {
    found: true,
    count: 2,
    visible: 1,
    tag: 'div',
    className: 'dock__item dock__item--active',
    styles: { color: 'rgb(0, 0, 0)' },
    boxes: [{ index: 0, x: 1, y: 2, width: 3, height: 4 }],
  };

  /** 跑一次 read element 并把 JSON 解析回来。 */
  function run(args: string[]): Record<string, unknown> {
    fake.session = true;
    fake.evaluate.mockReturnValue(RAW);
    const { lines, restore } = capture();
    try {
      read(args, true);
    } finally {
      restore();
    }
    return JSON.parse(lines.join('\n')) as Record<string, unknown>;
  }

  it('默认不带 tag / className / boxes，只留读数', () => {
    expect(run(['element', '.x'])).toEqual({
      found: true,
      count: 2,
      visible: 1,
      styles: { color: 'rgb(0, 0, 0)' },
    });
  });

  it('--meta 才附带 tag 与 className', () => {
    expect(run(['element', '.x', '--meta'])).toEqual({
      found: true,
      count: 2,
      visible: 1,
      styles: { color: 'rgb(0, 0, 0)' },
      tag: 'div',
      className: 'dock__item dock__item--active',
    });
  });

  it('--box 才附带 boxes，且与 --meta 互不影响', () => {
    expect(run(['element', '.x', '--box'])).toHaveProperty('boxes');
    expect(run(['element', '.x', '--box'])).not.toHaveProperty('tag');
    expect(run(['element', '.x', '--box', '--meta'])).toMatchObject({ tag: 'div', boxes: RAW.boxes });
  });
});
