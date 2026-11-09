/** 前端 URL：`--url` → 会话状态 → `SIYUAN_PORT` → 默认 6806。 */
import { UserError } from './errors.ts';
import { readState } from './session-state.ts';

export type Frontend = 'desktop' | 'mobile';

/** 端口必须是 1–65535 的整数；非法值在这里报错，不要拼出非法 URL 才在浏览器里失败。 */
export function parsePort(raw: string | undefined): string {
  const text = (raw ?? '').trim();
  if (!text) return '6806';
  const port = Number(text);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new UserError(`SIYUAN_PORT 必须是 1–65535 的整数：${text}`);
  }
  return String(port);
}

/** 标准入口 URL。 */
export function frontendUrl(frontend: Frontend, explicitUrl: string | null = null): string {
  if (explicitUrl) return explicitUrl;
  return `http://127.0.0.1:${parsePort(process.env.SIYUAN_PORT)}/stage/build/${frontend}/`;
}

/** 思源前端入口的固定路径段。 */
const FRONTEND_SEGMENT = /\/stage\/build\/(?:desktop|mobile)\/?$/;

/**
 * 把同一个实例的入口换到另一个前端。
 *
 * 两种情况：
 *  - URL 已是标准入口（`.../stage/build/desktop/`）⇒ 只替换这一段，
 *    端口与反代前缀原样保留。
 *  - URL 只是 origin 或普通页面（`http://host:8899/`）⇒ 当基址，
 *    在其后追加标准入口。否则 `open --url http://host:8899/` 之后
 *    `reload --frontend mobile` 会掉回 6806。
 */
export function rewriteFrontend(url: string, frontend: Frontend): string {
  if (FRONTEND_SEGMENT.test(url)) return url.replace(FRONTEND_SEGMENT, `/stage/build/${frontend}/`);
  const base = url.endsWith('/') ? url : `${url}/`;
  return `${base}stage/build/${frontend}/`;
}

/**
 * 本次命令应该打开哪个 URL。
 *
 * 优先级：显式 --url > 会话状态 > SIYUAN_PORT/6806。
 * 前端变了就只替换路径段，不换实例。
 */
export function resolveFrontendUrl(frontend: Frontend, explicitUrl: string | null = null): string {
  if (explicitUrl) return explicitUrl;
  const state = readState();
  if (!state) return frontendUrl(frontend);
  return state.frontend === frontend ? state.url : rewriteFrontend(state.url, frontend);
}

/** 校验前端名；拼错会在浏览器里 404，排查成本高于这里报错。 */
export function parseFrontend(value: string | undefined, fallback: Frontend = 'desktop'): Frontend {
  if (value === undefined) return fallback;
  if (value !== 'desktop' && value !== 'mobile') {
    throw new UserError(`未知前端：${value}（可用：desktop / mobile）`);
  }
  return value;
}
