/**
 * playwright-core cli 定位。
 *
 * 曾经的实现用 `require.resolve('playwright-core/cli.js')`，在开发仓库里恰好能
 * 解析到（包根就是 node_modules/playwright-core），但 playwright-core 的
 * `exports` 并未导出 `./cli.js`，装成依赖后必然失败。
 *
 * 现在的契约：解析 `playwright-core/package.json` 的 `bin` 字段，而不是写死
 * 文件名。这里锁住「解析出来的就是 package.json 声明的那个入口」。
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cliPath } from '../src/cli/playwright.ts';

const require = createRequire(import.meta.url);

/** 读 playwright-core 的 package.json，取其 bin 声明。 */
function declaredBin(): string {
  const packageJsonPath = require.resolve('playwright-core/package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
    bin?: string | Record<string, string>;
  };
  const bin = typeof packageJson.bin === 'string' ? packageJson.bin : packageJson.bin?.['playwright-core'];
  if (!bin) throw new Error('playwright-core 没有声明 bin');
  return join(dirname(packageJsonPath), bin);
}

describe('cliPath', () => {
  it('返回真实存在的入口文件', () => {
    const path = cliPath();
    expect(existsSync(path)).toBe(true);
  });

  it('解析到 playwright-core 包内，而不是本包目录', () => {
    // 装成依赖时包根是 node_modules/playwright-core；开发仓库里则是 .pnpm 链接。
    expect(dirname(cliPath())).toContain('playwright-core');
  });

  it('与 package.json 的 bin 声明一致（不写死文件名）', () => {
    expect(cliPath()).toBe(declaredBin());
  });
});
