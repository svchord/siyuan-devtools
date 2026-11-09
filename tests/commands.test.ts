/**
 * do / read 的参数分派与校验。
 *
 * 这两层是 CLI 最危险的地方：参数写错时要**在动浏览器之前**报错，
 * 而且不能静默忽略（旧实现 `do menu theme --count 9` 会返回 ok:true）。
 *
 * 这里只测「不需要浏览器就能失败」的路径：校验顺序是参数在前、会话在后。
 */
import { describe, expect, it } from 'vitest';
import { doAction } from '../src/cli/commands/do.ts';
import { read } from '../src/cli/commands/read.ts';

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
    expect(() => read(['contrast', '#000', '#fff'], true)).not.toThrow();
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
