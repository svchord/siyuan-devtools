/**
 * 动作命令：原生动作直接转发，思源专用动作走 eval。
 *
 * `--diff` 只是省一轮往返，不是原子性保护。
 */
import { lastValue, parseArgs, splitList } from '../args.ts';
import { output } from '../format.ts';
import { ATTR_FN, DOCK_FN, evalExpr, MENU_FN, RESET_FN, styleOfFn } from '../script/recipe.ts';
import { evalScript, runCli } from '../playwright.ts';
import { UserError } from '../support.ts';
import { requireSession } from './session.ts';

/** 直接转发给 playwright-core cli 的原生动作。 */
const NATIVE_ACTIONS = new Set(['click', 'hover', 'dblclick', 'fill', 'press', 'keydown', 'keyup', 'mousemove', 'drag', 'select']);

export function doAction(argv: string[], json: boolean): void {
  const [action, ...rest] = argv;
  if (!action) throw new UserError('do 需要动作名');
  requireSession();

  const parsed = parseArgs(rest, {
    valueFlags: ['--button', '--count', '--diff'],
    booleanFlags: [],
  });
  const positional = parsed.positional;
  const diff = splitList(lastValue(parsed, '--diff'));

  /** 动作前读一次、动作后读一次。 */
  const withDiff = (selector: string, run: () => void): void => {
    if (!diff?.length) {
      run();
      output({ ok: true }, json);
      return;
    }
    // 先把指针停到角落：上一条命令可能已经把指针留在元素上，
    // 不移开的话 before 读到的就是 hover 后的值，diff 永远为空。
    runCli(['mousemove', '1', '1']);
    const snapshot = evalExpr(styleOfFn(selector, diff));
    const before = evalScript(snapshot);
    run();
    const after = evalScript(snapshot);
    output({ before, after }, json);
  };

  if (NATIVE_ACTIONS.has(action)) {
    const selector = positional[0];
    if (action === 'mousemove') {
      const [x, y] = positional;
      if (x === undefined || y === undefined) throw new UserError('do mousemove 需要 x y');
      runCli(['mousemove', x, y]);
      output({ ok: true }, json);
      return;
    }
    if (!selector) throw new UserError(`do ${action} 需要选择器`);
    if (action === 'drag') {
      const to = positional[1];
      if (!to) throw new UserError('do drag 需要起点与终点选择器');
      runCli(['drag', selector, to]);
      output({ ok: true }, json);
      return;
    }
    if (action === 'select') {
      const value = positional[1];
      if (value === undefined) throw new UserError('do select 需要选择器与值');
      runCli(['select', selector, value]);
      output({ ok: true }, json);
      return;
    }
    if (action === 'fill') {
      runCli(['fill', selector, positional.slice(1).join(' ')]);
      output({ ok: true }, json);
      return;
    }
    if (action === 'press' || action === 'keydown' || action === 'keyup') {
      // press/keydown/keyup 的目标是键名，不是选择器。
      runCli([action, selector]);
      output({ ok: true }, json);
      return;
    }
    if (action === 'click') {
      const args = ['click', selector];
      const button = lastValue(parsed, '--button');
      if (button) args.push(button);
      withDiff(selector, () => runCli(args));
      return;
    }
    withDiff(selector, () => runCli([action, selector]));
    return;
  }

  if (action === 'menu') {
    const id = positional[0];
    if (!id) throw new UserError('do menu 需要菜单 id');
    output(evalScript(evalExpr(MENU_FN, id)), json);
    return;
  }
  if (action === 'dock') {
    const type = positional[0];
    if (!type) throw new UserError('do dock 需要停靠项类型');
    output(evalScript(evalExpr(DOCK_FN, type)), json);
    return;
  }
  if (action === 'attr') {
    const pair = positional[0];
    if (!pair) throw new UserError('do attr 需要 name=value');
    const index = pair.indexOf('=');
    const name = index === -1 ? pair : pair.slice(0, index);
    const value = index === -1 ? null : pair.slice(index + 1);
    output(evalScript(evalExpr(ATTR_FN, [name, value])), json);
    return;
  }
  if (action === 'reset') {
    output(evalScript(evalExpr(RESET_FN)), json);
    return;
  }

  throw new UserError(`未知动作：${action}`);
}
