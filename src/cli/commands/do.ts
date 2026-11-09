/**
 * 动作命令：原生动作直接转发，思源专用动作走 eval。
 *
 * `--diff` 会分别读动作前后的样式；它只是省一轮往返，不是原子性保护。
 * 页面动作后等待一小段时间，避免读到的还是 CSS 过渡的中间态。
 *
 * 校验顺序固定为：**参数 → 会话**。参数写错时不该先被「未启动」挡住，
 * 否则 agent 会先去 open，再撞上同一个错。
 */
import { lastValue, parseArgs, positiveInt } from '../args.ts';
import { UserError } from '../errors.ts';
import { output } from '../format.ts';
import { evalScript, runCli } from '../playwright.ts';

/** 第 3 步临时包装；下个提交换成 playwright.ts 里的 runCliAction。 */
const runCliAction = (command: string, positional: readonly string[]): string => {
  const needsSeparator = positional.some((token) => token.startsWith('-'));
  return runCli(needsSeparator ? [command, '--', ...positional] : [command, ...positional]);
};
import { ATTR_FN, dockFn, evalExpr, MENU_FN, RESET_FN, styleOfFn } from '../script/recipe.ts';
import { ACTION_SETTLE_MS, POINTER_PARK_MS } from '../timing.ts';
import { isRecord, sleep } from '../util.ts';
import { requireSession } from './session.ts';

/** 直接转发给 playwright-core cli 的原生动作。 */
const NATIVE_ACTIONS = new Set([
  'click',
  'hover',
  'dblclick',
  'fill',
  'press',
  'keydown',
  'keyup',
  'mousemove',
  'drag',
  'select',
]);

/** 支持 --diff 的动作（其余动作给 --diff 直接报错，而不是静默忽略）。 */
const DIFF_ACTIONS = new Set(['click', 'hover', 'dblclick', 'fill', 'drag', 'select']);

/** 支持 --button 的动作。 */
const BUTTON_ACTIONS = new Set(['click', 'dblclick']);

/** --button 的合法取值（与 help 一致）。 */
const BUTTON_VALUES = new Set(['left', 'right', 'middle']);

/** 执行一个会返回 `{ok:true}` 的页面动作，并把它当成真正的成功/失败处理。 */
async function runPageAction(fn: string, arg?: unknown): Promise<Record<string, unknown>> {
  const result = evalScript(evalExpr(fn, arg));
  if (!isRecord(result) || result.ok !== true) {
    const reason = isRecord(result) && typeof result.reason === 'string' ? result.reason : '页面动作失败';
    throw new UserError(reason);
  }
  await sleep(ACTION_SETTLE_MS);
  return result;
}

/** 某个选项只允许用于特定动作。 */
function rejectOption(flag: string, used: boolean, allowed: ReadonlySet<string>, action: string): void {
  if (used && !allowed.has(action)) {
    throw new UserError(`${flag} 不支持 ${action}（可用：${[...allowed].join(' / ')}）`);
  }
}

/** 动作需要位置参数；缺失时给出针对该动作的提示。 */
function requireArg(value: string | undefined, action: string, hint: string): string {
  if (value === undefined || value === '') throw new UserError(`do ${action} ${hint}`);
  return value;
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
  const diff = lastValue(parsed, '--diff')
    ?.split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const button = lastValue(parsed, '--button');
  const countValue = lastValue(parsed, '--count');

  // ---- 参数校验（不碰浏览器）----
  rejectOption('--button', button !== undefined, BUTTON_ACTIONS, action);
  rejectOption('--count', countValue !== undefined, new Set(['click']), action);
  rejectOption('--diff', diff !== undefined, DIFF_ACTIONS, action);
  if (button !== undefined && !BUTTON_VALUES.has(button)) {
    throw new UserError(`--button 取值不合法：${button}（可用：${[...BUTTON_VALUES].join(' / ')}）`);
  }
  // --count 只解析一次，避免「0」和「3」给出两套文案。
  const count = countValue === undefined ? 1 : positiveInt(parsed, '--count', 1);
  if (countValue !== undefined && count > 2) throw new UserError(`--count 只支持 1 或 2：${countValue}`);

  if (NATIVE_ACTIONS.has(action)) {
    if (action === 'mousemove') {
      const [x, y] = positional;
      if (x === undefined || y === undefined) throw new UserError('do mousemove 需要 x y');
    } else if (action === 'press' || action === 'keydown' || action === 'keyup') {
      // 第一个参数是按键名（Enter、Shift…），不是选择器。
      requireArg(positional[0], action, '需要按键名，如 Enter（按键名以 - 开头时用 -- 分隔）');
    } else {
      requireArg(positional[0], action, '需要选择器');
      if (action === 'drag') requireArg(positional[1], action, '需要起点与终点选择器');
      if (action === 'select' && positional[1] === undefined) throw new UserError('do select 需要选择器与值');
      // 空字符串是合法的 fill 值（清空输入框）；只有「完全没给文本」才算缺参。
      if (action === 'fill' && positional.length < 2) {
        throw new UserError('do fill 需要文本（要输入以 -- 开头的字面量时用 -- 分隔）');
      }
    }
  } else if (action === 'menu' || action === 'dock' || action === 'attr') {
    const hints: Record<string, string> = {
      menu: '需要菜单 id',
      dock: '需要停靠项类型',
      attr: '需要 name=value',
    };
    requireArg(positional[0], action, hints[action]!);
  } else if (action !== 'reset') {
    throw new UserError(`未知动作：${action}`);
  }

  // ---- 到这里参数已合法，才要求会话 ----
  requireSession();

  /** 动作前读一次、动作后读一次。 */
  const withDiff = async (selector: string, run: () => void): Promise<void> => {
    if (!diff?.length) {
      run();
      await sleep(ACTION_SETTLE_MS);
      output({ ok: true }, json);
      return;
    }
    // 先把指针停到角落：上一条命令可能已经把指针留在元素上，
    // 不移开的话 before 读到的就是 hover 后的值，diff 永远为空。
    runCliAction('mousemove', ['1', '1']);
    await sleep(POINTER_PARK_MS);
    const snapshot = evalExpr(styleOfFn(selector, diff));
    const before = evalScript(snapshot);
    run();
    await sleep(ACTION_SETTLE_MS);
    const after = evalScript(snapshot);
    output({ before, after }, json);
  };

  if (NATIVE_ACTIONS.has(action)) {
    const selector = positional[0]!;
    if (action === 'mousemove') {
      runCliAction('mousemove', [positional[0]!, positional[1]!]);
      output({ ok: true }, json);
      return;
    }
    if (action === 'press' || action === 'keydown' || action === 'keyup') {
      runCliAction(action, [selector]);
      output({ ok: true }, json);
      return;
    }
    if (action === 'drag') {
      await withDiff(selector, () => runCliAction('drag', [selector, positional[1]!]));
      return;
    }
    if (action === 'select') {
      await withDiff(selector, () => runCliAction('select', [selector, positional[1]!]));
      return;
    }
    if (action === 'fill') {
      const text = positional.slice(1).join(' ');
      await withDiff(selector, () => runCliAction('fill', [selector, text]));
      return;
    }
    if (action === 'click') {
      const args = button ? [selector, button] : [selector];
      await withDiff(selector, () => {
        for (let i = 0; i < count; i += 1) runCliAction('click', args);
      });
      return;
    }
    // dblclick / hover
    await withDiff(selector, () => runCliAction(action, button ? [selector, button] : [selector]));
    return;
  }

  if (action === 'menu') {
    output(await runPageAction(MENU_FN, positional[0]), json);
    return;
  }
  if (action === 'dock') {
    output(await runPageAction(dockFn(positional[0]!)), json);
    return;
  }
  if (action === 'attr') {
    const pair = positional[0]!;
    const index = pair.indexOf('=');
    const name = index === -1 ? pair : pair.slice(0, index);
    if (!name) throw new UserError('do attr 需要属性名：name=value');
    const value = index === -1 ? null : pair.slice(index + 1);
    output(await runPageAction(ATTR_FN, [name, value]), json);
    return;
  }
  output(await runPageAction(RESET_FN), json);
}
