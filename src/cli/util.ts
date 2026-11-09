/** 与领域无关的小工具。 */
import { readFileSync } from 'node:fs';

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
