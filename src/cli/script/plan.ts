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
import { contrastFn, elementFn, ENV_FN, MENU_FN, TOKENS_FN } from './recipe.ts';
import { parsePlan } from './plan-schema.ts';
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

/** 把一步编译成 run-code 里的一行异步调用。 */
function compileStep(step: PlanStep, index: number): string {
  const push = `results.push({ step: ${index}, value: `;
  if (step.do !== undefined) {
    const [action, ...rest] = step.do.split(':');
    const arg = rest.join(':');
    if (action === 'hover') {
      return `await page.locator(${JSON.stringify(arg)}).hover(); ${push}null });`;
    }
    if (action === 'click') {
      return `await page.locator(${JSON.stringify(arg)}).click(); ${push}null });`;
    }
    if (action === 'menu') {
      return `await page.evaluate(${MENU_FN}, ${JSON.stringify(arg)}); ${push}null });`;
    }
    throw new UserError(`计划里不支持的动作：${String(action)}`);
  }
  if (step.read === 'env') {
    return `${push}await page.evaluate(${ENV_FN}) });`;
  }
  if (step.read === 'tokens') {
    return `${push}await page.evaluate(${TOKENS_FN}, ${JSON.stringify(step.names ?? [])}) });`;
  }
  if (step.read === 'element') {
    const fn = elementFn(step.selector ?? '', step.props ?? [], step.box ?? false, step.limit ?? 5);
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
