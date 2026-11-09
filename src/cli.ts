#!/usr/bin/env node
/**
 * siyuan-devtools：agent 面向的思源渲染测量 CLI。
 *
 * 引擎是 `playwright-core` 自带的 cli（daemon + 会话）。本文件只是入口：
 * shebang 必须留在产物首行，其余逻辑在 cli/main.ts 与各命令族里。
 *
 * 只在这里做两件事：跑 main、把异常映射成退出码 2。退出码 0 是成功；
 * 不做「main 返回码」这一层——所有失败路径都走异常，返回值恒为 0。
 */
import { renderError } from './cli/errors.ts';
import { main } from './cli/main.ts';

main(process.argv.slice(2)).catch((cause: unknown) => {
  console.error(renderError(cause));
  process.exitCode = 2;
});
