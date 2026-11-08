/**
 * 读数命令：env / tokens / element / contrast。
 *
 * 全部走 `cli --json eval`，片段来自 recipe.ts。
 */
import { lastValue, parseArgs, positiveInt, splitList } from '../args.ts';
import { contrastRatio } from '../contrast.ts';
import { output } from '../format.ts';
import { contrastFn, elementFn, ENV_FN, evalExpr, TOKENS_FN } from '../script/recipe.ts';
import { evalScript } from '../playwright.ts';
import { UserError } from '../support.ts';
import { requireSession } from './session.ts';

export function read(argv: string[], json: boolean): void {
  const [sub, ...rest] = argv;
  if (!sub) throw new UserError('read 需要子命令：env / tokens / element / contrast');

  if (sub === 'contrast') {
    const [fg, bg] = rest;
    if (!fg || !bg) throw new UserError('read contrast 需要前景与背景令牌名（或颜色值）');
    // 两个都是字面量颜色时不需要浏览器，直接算。
    if (!fg.startsWith('--') && !bg.startsWith('--')) {
      output({ foreground: fg, background: bg, ratio: contrastRatio(fg, bg) }, json);
      return;
    }
    requireSession();
    const values = evalScript(evalExpr(contrastFn(fg, bg))) as { foreground: string; background: string };
    output({ ...values, ratio: contrastRatio(values.foreground, values.background) }, json);
    return;
  }

  requireSession();

  if (sub === 'env') {
    output(evalScript(evalExpr(ENV_FN)), json);
    return;
  }

  if (sub === 'tokens') {
    const names = rest.filter((token) => token.startsWith('--'));
    if (!names.length) throw new UserError('read tokens 需要至少一个令牌名，如 --brand-8');
    const result = evalScript(evalExpr(TOKENS_FN, names)) as { values: Record<string, string>; missing: string[] };
    // 拼错的令牌名必须报错，不能静默返回空字符串——否则 agent 会当成
    // 「这个令牌没有值」继续往下走，把错误带进最终结论。
    if (result.missing.length) {
      throw new UserError(`未定义的 CSS 变量：${result.missing.join('、')}`);
    }
    output(result.values, json);
    return;
  }

  if (sub === 'element') {
    const parsed = parseArgs(rest, {
      valueFlags: ['--props', '--limit'],
      booleanFlags: ['--box'],
      allowUnknown: false,
    });
    const selector = parsed.positional[0];
    if (!selector) throw new UserError('read element 需要选择器');
    const props = splitList(lastValue(parsed, '--props')) ?? ['color', 'background-color'];
    const limit = positiveInt(parsed, '--limit', 5);
    output(evalScript(evalExpr(elementFn(selector, props, parsed.flags.has('--box'), limit))), json);
    return;
  }

  throw new UserError(`未知 read 子命令：${sub}`);
}
