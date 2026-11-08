/** 前端 URL：`SIYUAN_PORT` → `--url` → 默认 6806。 */

export type Frontend = 'desktop' | 'mobile';

/** 拼前端入口；不做 port.json / PID / 多实例探活（那是插件包的职责）。 */
export function frontendUrl(frontend: Frontend, explicitUrl: string | null = null): string {
  if (explicitUrl) return explicitUrl;
  const port = process.env.SIYUAN_PORT?.trim() || '6806';
  return `http://127.0.0.1:${port}/stage/build/${frontend}/`;
}

/** 校验前端名；拼错会在浏览器里 404，排查成本高于这里报错。 */
export function parseFrontend(value: string | undefined, fallback: Frontend = 'desktop'): Frontend {
  if (value === undefined) return fallback;
  if (value !== 'desktop' && value !== 'mobile') {
    throw new Error(`未知前端：${String(value)}（可用：desktop / mobile）`);
  }
  return value;
}
