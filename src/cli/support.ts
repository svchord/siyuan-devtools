/** CLI 侧通用小工具。 */
import { readFileSync } from 'node:fs';

/** 用户/agent 可见的错误：只打 message，不甩堆栈。 */
export class UserError extends Error {
  override readonly name = 'UserError';
}

/** 错误消息。 */
export function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/** 异步等待；用于动作后等 DOM/CSS 过渡落定。 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** 读 JSON；不存在、坏 JSON 都返回 null。 */
export function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** 是否为普通对象。 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
