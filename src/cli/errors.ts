/**
 * 错误类型与渲染。
 *
 * 三类错误必须能分开：
 *  - `UserError`：用户/agent 的输入问题，原样打印 message，不加任何前缀。
 *  - `EnvironmentError`：环境问题（权限、磁盘、找不到浏览器），提示检查环境，
 *    不要让用户以为是本工具的 bug。
 *  - 其它异常：内部 bug，加「内部错误」前缀并提示报告，避免 agent 把工具自身
 *    崩溃误读成「页面就是这么渲染的」。
 */

/** 用户/agent 可见的错误：只打 message，不甩堆栈。 */
export class UserError extends Error {
  override readonly name = 'UserError';
}

/** 环境/权限类错误：不是用法错误，也不是本工具的 bug。 */
export class EnvironmentError extends Error {
  override readonly name = 'EnvironmentError';
}

/** 取第一条非空行；用于剥掉 Playwright 塞进 message 的多行堆栈。 */
export function firstLine(text: string): string {
  const line = text.split('\n').find((item) => item.trim().length > 0);
  return line === undefined ? text : line.trim();
}

/** 把任意异常转成一行人读消息（堆栈在这里被丢掉）。 */
export function describeError(cause: unknown): string {
  return firstLine(cause instanceof Error ? cause.message : String(cause));
}

/** 把异常渲染成最终写到 stderr 的文本。 */
export function renderError(cause: unknown): string {
  if (cause instanceof UserError) return cause.message;
  if (cause instanceof EnvironmentError) return `环境错误：${describeError(cause)}`;
  return `内部错误：${describeError(cause)}（这是本工具的 bug，请带复现步骤反馈）`;
}
