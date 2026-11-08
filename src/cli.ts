#!/usr/bin/env node
/**
 * siyuan-devtools：agent 面向的思源渲染测量 CLI。
 *
 * 引擎是 `playwright-core` 自带的 cli（daemon + 会话）。本文件只是入口：
 * shebang 必须留在产物首行，其余逻辑在 cli/main.ts 与各命令族里。
 */
import { main } from './cli/main.ts';
import { describeError } from './cli/support.ts';
import { UserError } from './cli/support.ts';

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((cause: unknown) => {
    console.error(cause instanceof UserError ? cause.message : describeError(cause));
    process.exitCode = 2;
  });
