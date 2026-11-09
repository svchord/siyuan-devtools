/**
 * 计划文件：有序步骤，整个计划编成 `run-code` 一次执行。
 *
 * 这是唯一需要 `page` 对象的场景：一个计划里既有真指针动作
 * （`page.locator().hover()`）又有页面读数，编成一条命令省往返。
 * 读数片段全部复用 `recipe.ts`，不在这里另写一份。
 *
 * 片段必须**内联成 JS 源码**传给 `page.evaluate`，不能用 `JSON.stringify`
 * 包成字符串：Playwright 对字符串参数是当表达式求值，返回的是函数定义本身，
 * 序列化后是 undefined；传真正的函数才会执行并返回值。
 *
 * 形状校验在 `plan-schema.ts`：在开浏览器**之前**跑完，写错字段能立刻报出来。
 * 因此 `compileStep` 假定输入已合法——遇到不认识的动作直接抛错，绝不猜成菜单。
 */
import { parseProps } from '../css.ts';
import { contrastRatio } from '../contrast.ts';
import { UserError } from '../errors.ts';
import { runCode } from '../playwright.ts';
import { ACTION_SETTLE_MS } from '../timing.ts';
import { isRecord, readJsonFile } from '../util.ts';
import { contrastFn, DEFAULT_ELEMENT_PROPS, elementFn, ENV_FN, MENU_FN, styleOfFn, TOKENS_FN } from './recipe.ts';
import { parsePlan, PLAN_ACTIONS } from './plan-schema.ts';
import type { Plan, PlanStep } from './plan-schema.ts';

export type { Plan, PlanStep } from './plan-schema.ts';

/** 读计划文件并校验；失败时把所有问题一次说清。 */
export function readPlan(path: string): Plan {
  const data: unknown = readJsonFile(path);
  if (data === null) throw new UserError(`计划文件读不到或不是合法 JSON：${path}`);
  const result = parsePlan(data);
  if (!result.ok) {
    throw new UserError(`计划文件有问题：${path}\n${result.errors.map((error) => `  - ${error}`).join('\n')}`);
  }
  return result.plan;
}

/**
 * `do` 字段拆成动作名与参数。
 *
 * 只在第一个冒号处切分，选择器里的冒号（`.a:hover`、`a[href="http://x"]`）
 * 全部保留。schema 已保证至少有一个冒号且动作名在白名单里。
 */
function splitAction(step: PlanStep): { action: string; arg: string } {
  const raw = step.do ?? '';
  const separator = raw.indexOf(':');
  const action = separator === -1 ? '' : raw.slice(0, separator);
  const arg = separator === -1 ? '' : raw.slice(separator + 1);
  if (!(PLAN_ACTIONS as readonly string[]).includes(action)) {
    throw new UserError(`计划里不支持的动作：${raw}`);
  }
  return { action, arg };
}

/** 把一步编译成 run-code 里的一行异步调用。 */
function compileStep(step: PlanStep, index: number): string {
  const push = `results.push({ step: ${index}, value: `;
  const settle = `await new Promise((resolve) => setTimeout(resolve, ${ACTION_SETTLE_MS}));`;

  if (step.do !== undefined) {
    const { action, arg } = splitAction(step);
    let actionCode: string;
    if (action === 'hover') {
      actionCode = `await page.locator(${JSON.stringify(arg)}).hover();`;
    } else if (action === 'click') {
      actionCode = `await page.locator(${JSON.stringify(arg)}).click();`;
    } else {
      actionCode =
        `const menuResult${index} = await page.evaluate(${MENU_FN}, ${JSON.stringify(arg)}); ` +
        `if (!menuResult${index} || menuResult${index}.ok !== true) throw new Error(menuResult${index}?.reason ?? '菜单动作失败');`;
    }
    if (step.diff === undefined) {
      return `${actionCode} ${settle} ${push}null });`;
    }
    const snapshot = styleOfFn(step.diff.selector, step.diff.props);
    return (
      `const before${index} = await page.evaluate(${snapshot}); ` +
      `${actionCode} ${settle} ` +
      `const after${index} = await page.evaluate(${snapshot}); ` +
      `${push}{ before: before${index}, after: after${index} } });`
    );
  }

  if (step.read === 'env') {
    return `${push}await page.evaluate(${ENV_FN}) });`;
  }
  if (step.read === 'tokens') {
    // 与 read tokens 同一套严格语义：拼错的令牌名在计划里也要直接失败，
    // 不能把 missing 静默带进结果。
    const tokensVar = `tokens${index}`;
    return (
      `const ${tokensVar} = await page.evaluate(${TOKENS_FN}, ${JSON.stringify(step.names ?? [])}); ` +
      `if (${tokensVar}.missing.length) throw new Error('未定义的 CSS 变量：' + ${tokensVar}.missing.join('、')); ` +
      `${push}${tokensVar}.values });`
    );
  }
  if (step.read === 'element') {
    const props = parseProps(step.props?.join(','), DEFAULT_ELEMENT_PROPS);
    const fn = elementFn(step.selector ?? '', props, step.box ?? false, step.limit ?? 5);
    return `${push}await page.evaluate(${fn}) });`;
  }
  // 只剩 contrast（schema 保证）。
  //
  // 对比度必须在 Node 侧算：页面里没有这个函数。这里只把解析出来的颜色带回
  // Node，由 `runPlan` 补上 ratio，保证与 `read contrast` 输出同样的
  // `{foreground, background, ratio}` 三个字段——旧实现只回前两个，
  // agent 跑完 audit 根本拿不到数值。
  const contrastVar = `contrast${index}`;
  const fn = contrastFn(step.foreground ?? '', step.background ?? '');
  return (
    `const ${contrastVar} = await page.evaluate(${fn}); ` +
    `if (${contrastVar}.missing.length) throw new Error('未定义的 CSS 变量：' + ${contrastVar}.missing.join('、')); ` +
    `${push}{ foreground: ${contrastVar}.foreground, background: ${contrastVar}.background } });`
  );
}

/**
 * 给 contrast 步骤补上 ratio。
 *
 * run-code 只把 `page` 传进脚本，Node 侧函数（对比度计算）进不去，
 * 所以只能把颜色带回来、在 Node 里补算。
 */
function fillContrastRatios(plan: Plan, results: unknown): unknown {
  if (!Array.isArray(results)) return results;
  return results.map((item, index) => {
    if (plan.steps[index]?.read !== 'contrast') return item;
    if (!isRecord(item) || !isRecord(item.value)) return item;
    const { foreground, background } = item.value;
    if (typeof foreground !== 'string' || typeof background !== 'string') return item;
    return { ...item, value: { foreground, background, ratio: contrastRatio(foreground, background) } };
  });
}

/** 编译并执行计划。 */
export function runPlan(plan: Plan): unknown {
  return fillContrastRatios(plan, runCode(compilePlan(plan)));
}

/** 编译后的完整脚本（供测试读回）。 */
export function compilePlan(plan: Plan): string {
  const body = plan.steps.map((step, index) => `  ${compileStep(step, index)}`).join('\n');
  return `async (page) => {\n  const results = [];\n${body}\n  return results;\n}`;
}
