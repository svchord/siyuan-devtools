/**
 * 计划文件：有序步骤，整个计划编成一个 `run-code` 一次执行。
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
 */
import { runCode } from '../playwright.ts';
import { readJsonFile, UserError } from '../support.ts';
import { contrastFn, elementFn, ENV_FN, MENU_FN, styleOfFn, TOKENS_FN } from './recipe.ts';
import { parsePlan } from './plan-schema.ts';
import type { Plan, PlanStep } from './plan-schema.ts';

export type { Plan, PlanStep } from './plan-schema.ts';

/** 计划动作执行后等待页面过渡/异步渲染。 */
const ACTION_SETTLE_MS = 500;

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

/** 把一步编译成 run-code 里的一行异步调用。 */
function compileStep(step: PlanStep, index: number): string {
  const push = `results.push({ step: ${index}, value: `;
  if (step.do !== undefined) {
    const separator = step.do.indexOf(':');
    const action = separator === -1 ? step.do : step.do.slice(0, separator);
    const arg = separator === -1 ? '' : step.do.slice(separator + 1);
    if (!arg) throw new UserError(`计划第 ${index + 1} 步的 do 缺少参数`);
    let actionCode: string;
    if (action === 'hover') {
      actionCode = `await page.locator(${JSON.stringify(arg)}).hover();`;
    } else if (action === 'click') {
      actionCode = `await page.locator(${JSON.stringify(arg)}).click();`;
    } else if (action === 'menu') {
      actionCode =
        `const menuResult${index} = await page.evaluate(${MENU_FN}, ${JSON.stringify(arg)}); ` +
        `if (!menuResult${index} || menuResult${index}.ok !== true) throw new Error(menuResult${index}?.reason ?? '菜单动作失败');`;
    } else {
      throw new UserError(`计划里不支持的动作：${String(action)}`);
    }
    const settle = `await new Promise((resolve) => setTimeout(resolve, ${ACTION_SETTLE_MS}));`;
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
    return `${push}await page.evaluate(${TOKENS_FN}, ${JSON.stringify(step.names ?? [])}) });`;
  }
  if (step.read === 'element') {
    const fn = elementFn(step.selector ?? '', step.props ?? ['color', 'background-color'], step.box ?? false, step.limit ?? 5);
    return `${push}await page.evaluate(${fn}) });`;
  }
  if (step.read === 'contrast') {
    const fn = contrastFn(step.foreground ?? '', step.background ?? '');
    return `${push}await page.evaluate(${fn}) });`;
  }
  throw new UserError(`计划第 ${index + 1} 步既没有 read 也没有 do`);
}

/** 编译并执行计划。 */
export function runPlan(plan: Plan): unknown {
  return runCode(compilePlan(plan));
}

/** 供测试读回编译后的脚本。 */
export function compilePlan(plan: Plan): string {
  const body = plan.steps.map((step, index) => `  ${compileStep(step, index)}`).join('\n');
  return `async (page) => {\n  const results = [];\n${body}\n  return results;\n}`;
}
