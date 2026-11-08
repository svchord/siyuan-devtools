/**
 * 动作命令：原生动作直接转发，思源专用动作走 eval。
 *
 * `--diff` 会分别读动作前后的样式；它只是省一轮往返，不是原子性保护。
 * 页面动作后等待一小段时间，避免读到的还是 CSS 过渡的中间态。
 */
import { lastValue, parseArgs, positiveInt, splitList } from '../args.ts';
import { output } from '../format.ts';
import { ATTR_FN, DOCK_FN, evalExpr, MENU_FN, RESET_FN, styleOfFn } from '../script/recipe.ts';
import { evalScript, runCli } from '../playwright.ts';
import { isRecord, sleep, UserError } from '../support.ts';
import { requireSession } from './session.ts';

/** 直接转发给 playwright-core cli 的原生动作。 */
const NATIVE_ACTIONS = new Set(['click', 'hover', 'dblclick', 'fill', 'press', 'keydown', 'keyup', 'mousemove', 'drag', 'select']);

/** 动作后等待页面过渡/异步渲染落定。 */
const ACTION_SETTLE_MS = 500;

/** 执行一个会返回 `{ok:true}` 的页面动作，并把它当成真正的成功/失败处理。 */
async function runPageAction(fn: string, arg?: unknown): Promise<Record<string, unknown>> {
  const result = await Promise.resolve(evalScript(evalExpr(fn, arg)));
  if (!isRecord(result) || result.ok !== true) {
    const reason = isRecord(result) && typeof result.reason === 'string' ? result.reason : '页面动作失败';
    throw new UserError(reason);
  }
  await sleep(ACTION_SETTLE_MS);
  return result;
}

export async function doAction(argv: string[], json: boolean): Promise<void> {
  const [action, ...rest] = argv;
  if (!action) throw new UserError('do 需要动作名');

  const parsed = parseArgs(rest, {
    valueFlags: ['--button', '--count', '--diff'],
    booleanFlags: [],
    allowUnknown: false,
  });
  const positional = parsed.positional;
  const diff = splitList(lastValue(parsed, '--diff'));
  const button = lastValue(parsed, '--button');
  const countValue = lastValue(parsed, '--count');

  requireSession();

  /** 动作前读一次、动作后读一次。 */
  const withDiff = async (selector: string, run: () => unknown): Promise<void> => {
    if (!diff?.length) {
      await run();
      await sleep(ACTION_SETTLE_MS);
      output({ ok: true }, json);
      return;
    }
    // 先把指针停到角落：上一条命令可能已经把指针留在元素上，
    // 不移开的话 before 读到的就是 hover 后的值，diff 永远为空。
    runCli(['mousemove', '1', '1']);
    await sleep(120);
    const snapshot = evalExpr(styleOfFn(selector, diff));
    const before = evalScript(snapshot);
    await run();
    await sleep(ACTION_SETTLE_MS);
    const after = evalScript(snapshot);
    output({ before, after }, json);
  };

  if (NATIVE_ACTIONS.has(action)) {
    const selector = positional[0];
    if (action === 'mousemove') {
      const [x, y] = positional;
      if (x === undefined || y === undefined) throw new UserError('do mousemove 需要 x y');
      if (diff?.length) throw new UserError('mousemove 不支持 --diff（没有可读样的目标元素）');
      if (button) throw new UserError('mousemove 不支持 --button');
      if (countValue !== undefined) throw new UserError('mousemove 不支持 --count');
      runCli(['mousemove', x, y]);
      output({ ok: true }, json);
      return;
    }
    if (!selector) throw new UserError(`do ${action} 需要选择器`);
    if (button && action !== 'click' && action !== 'dblclick') {
      throw new UserError(`--button 只支持 click / dblclick：${action}`);
    }
    if (action === 'drag') {
      const to = positional[1];
      if (!to) throw new UserError('do drag 需要起点与终点选择器');
      await withDiff(selector, () => runCli(['drag', selector, to]));
      return;
    }
    if (action === 'select') {
      const value = positional[1];
      if (value === undefined) throw new UserError('do select 需要选择器与值');
      await withDiff(selector, () => runCli(['select', selector, value]));
      return;
    }
    if (action === 'fill') {
      const text = positional.slice(1).join(' ');
      await withDiff(selector, () => runCli(['fill', selector, text]));
      return;
    }
    if (action === 'press' || action === 'keydown' || action === 'keyup') {
      if (diff?.length) throw new UserError(`${action} 不支持 --diff（没有可读样的目标元素）`);
      runCli([action, selector]);
      output({ ok: true }, json);
      return;
    }
    if (action === 'click') {
      const count = countValue === undefined ? 1 : positiveInt(parsed, '--count', 1);
      if (count > 2) throw new UserError(`--count 只支持 1 或 2：${String(countValue)}`);
      const args = ['click', selector];
      if (button) args.push(button);
      await withDiff(selector, () => {
        for (let i = 0; i < count; i += 1) runCli(args);
      });
      return;
    }
    if (action === 'dblclick') {
      if (countValue !== undefined) throw new UserError(`--count 只支持 click：${String(countValue)}`);
      const args = ['dblclick', selector];
      if (button) args.push(button);
      await withDiff(selector, () => runCli(args));
      return;
    }
    if (countValue !== undefined) throw new UserError(`--count 只支持 click：${String(countValue)}`);
    await withDiff(selector, () => runCli([action, selector]));
    return;
  }

  if (diff?.length) throw new UserError(`${action} 不支持 --diff（请对 click/hover/dblclick/fill/drag/select 使用）`);

  if (action === 'menu') {
    const id = positional[0];
    if (!id) throw new UserError('do menu 需要菜单 id');
    output(await runPageAction(MENU_FN, id), json);
    return;
  }
  if (action === 'dock') {
    const type = positional[0];
    if (!type) throw new UserError('do dock 需要停靠项类型');
    output(await runPageAction(DOCK_FN, type), json);
    return;
  }
  if (action === 'attr') {
    const pair = positional[0];
    if (!pair) throw new UserError('do attr 需要 name=value');
    const index = pair.indexOf('=');
    const name = index === -1 ? pair : pair.slice(0, index);
    const value = index === -1 ? null : pair.slice(index + 1);
    output(await runPageAction(ATTR_FN, [name, value]), json);
    return;
  }
  if (action === 'reset') {
    output(await runPageAction(RESET_FN), json);
    return;
  }

  throw new UserError(`未知动作：${action}`);
}
