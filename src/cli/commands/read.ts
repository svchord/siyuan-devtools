/**
 * 读数命令：env / tokens / element / contrast。
 *
 * 全部走 `cli --json eval`，片段来自 recipe.ts。
 *
 * 共同原则：
 *  1. **读不到就说读不到**，不要返回空字符串——空串与「属性值为空」无法区分，
 *     agent 会把拼错的名字当成「没有值」继续往下走。
 *  2. **先校验参数、再要求会话**：参数写错时不该先被「未启动」挡住，
 *     否则 agent 会先去 open，再撞上同一个错。
 */
import { lastValue, parseArgs, positiveInt } from '../args.ts';
import { parseProps } from '../css.ts';
import { contrastRatio } from '../contrast.ts';
import { UserError } from '../errors.ts';
import { output } from '../format.ts';
import { evalScript } from '../playwright.ts';
import { contrastFn, DEFAULT_ELEMENT_PROPS, elementFn, ENV_FN, evalExpr, TOKENS_FN } from '../script/recipe.ts';
import { requireSession } from './session.ts';

/** 令牌读数：区分「未定义」与「定义了但值为空」。 */
function readTokens(names: string[]): Record<string, string> {
  const result = evalScript(evalExpr(TOKENS_FN, names)) as { values: Record<string, string>; missing: string[] };
  if (result.missing.length) throw new UserError(`未定义的 CSS 变量：${result.missing.join('、')}`);
  return result.values;
}

/** 对比度读数：令牌名或字面量颜色都可以。 */
function readContrast(fg: string, bg: string, json: boolean): void {
  // 两个都是字面量颜色时不需要浏览器，直接算。
  if (!fg.startsWith('--') && !bg.startsWith('--')) {
    output({ foreground: fg, background: bg, ratio: contrastRatio(fg, bg) }, json);
    return;
  }
  requireSession();
  const values = evalScript(evalExpr(contrastFn(fg, bg))) as {
    foreground: string;
    background: string;
    missing: string[];
  };
  // 与 read tokens 同一套严格语义：拼错的令牌名必须报错。
  if (values.missing.length) throw new UserError(`未定义的 CSS 变量：${values.missing.join('、')}`);
  output(
    { foreground: values.foreground, background: values.background, ratio: contrastRatio(values.foreground, values.background) },
    json
  );
}

/** 元素读数：参数先校验，再要求会话。 */
function readElement(rest: string[], json: boolean): void {
  const parsed = parseArgs(rest, {
    valueFlags: ['--props', '--limit'],
    booleanFlags: ['--box'],
    allowUnknown: false,
  });
  const selector = parsed.positional[0];
  if (!selector) throw new UserError('read element 需要选择器');
  const box = parsed.flags.has('--box');
  // --limit 只影响 --box 的输出；单独给等于静默无效。
  if (lastValue(parsed, '--limit') !== undefined && !box) throw new UserError('--limit 只能与 --box 一起使用');
  const props = parseProps(lastValue(parsed, '--props'), DEFAULT_ELEMENT_PROPS);
  const limit = positiveInt(parsed, '--limit', 5);
  requireSession();
  output(evalScript(evalExpr(elementFn(selector, props, box, limit))), json);
}

/** 令牌读数：参数先校验，再要求会话。 */
function readTokenList(rest: string[], json: boolean): void {
  // `--` 是字面量分隔符，本身不是令牌名；其余非 `--` 开头的参数也不接受。
  const tokens = rest.filter((token) => token !== '--');
  const names = tokens.filter((token) => token.startsWith('--'));
  const ignored = tokens.filter((token) => !token.startsWith('--'));
  if (ignored.length) throw new UserError(`令牌名必须以 -- 开头：${ignored.join('、')}`);
  if (!names.length) throw new UserError('read tokens 需要至少一个令牌名，如 --brand-8');
  requireSession();
  output(readTokens(names), json);
}

/** env 读数。多余的位置参数按历史行为忽略（与 read tokens 的多参数风格一致）。 */
function readEnv(rest: string[], json: boolean): void {
  void rest;
  requireSession();
  output(evalScript(evalExpr(ENV_FN)), json);
}

export function read(argv: string[], json: boolean): void {
  const [sub, ...rest] = argv;
  if (!sub) throw new UserError('read 需要子命令：env / tokens / element / contrast');

  if (sub === 'contrast') {
    const [fg, bg] = rest;
    if (!fg || !bg) throw new UserError('read contrast 需要前景与背景令牌名（或颜色值）');
    readContrast(fg, bg, json);
    return;
  }
  if (sub === 'element') {
    readElement(rest, json);
    return;
  }
  if (sub === 'tokens') {
    readTokenList(rest, json);
    return;
  }
  if (sub === 'env') {
    readEnv(rest, json);
    return;
  }

  throw new UserError(`未知 read 子命令：${sub}`);
}
