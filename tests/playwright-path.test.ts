/**
 * playwright-core cli 定位。
 *
 * 曾经的实现用 `require.resolve('playwright-core/cli.js')`，在开发仓库里恰好能
 * 解析到（包根就是 node_modules/playwright-core），但 playwright-core 的
 * `exports` 并未导出 `./cli.js`，装成依赖后必然失败。这里锁住「能解析到真实
 * 存在的 cli.js」这一契约。
 */
import { existsSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cliPath } from '../src/cli/playwright.ts';

describe('cliPath', () => {
  it('返回真实存在的 playwright-core cli.js', () => {
    const path = cliPath();
    expect(existsSync(path)).toBe(true);
    expect(basename(path)).toBe('cli.js');
  });

  it('解析到 playwright-core 包内，而不是本包目录', () => {
    // 装成依赖时包根是 node_modules/playwright-core；开发仓库里则是 .pnpm 链接。
    expect(dirname(cliPath())).toContain('playwright-core');
  });
});
