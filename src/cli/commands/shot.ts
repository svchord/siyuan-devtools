/**
 * 截图命令：原生 `cli screenshot`。输出的是文件路径（数据，走 stdout）。
 *
 * ## 为什么是 `--theme` + `--density` 而不是一个 `--state`
 *
 * 明暗与密度是**两个独立维度**，各对应一个 `<html>` 属性：
 *   data-theme-mode  → dark | light
 *   data-ui-density  → comfortable | compact
 * 用一个互斥的 `--state` 表达不了「暗色 + 紧凑」这种组合。
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { lastValue, parseArgs } from '../args.ts';
import { output } from '../format.ts';
import { runCli } from '../playwright.ts';
import { sleep, UserError } from '../support.ts';
import { frontendUrl, parseFrontend } from '../url.ts';
import type { Frontend } from '../url.ts';
import { viewportFor } from '../viewport.ts';
import { applyViewport, captureRootSnapshot, requireSession, waitForReady } from './session.ts';

/** 两个维度各自的属性名与合法取值。 */
export const DIMENSIONS = {
  '--theme': { attribute: 'data-theme-mode', values: ['dark', 'light'] },
  '--density': { attribute: 'data-ui-density', values: ['comfortable', 'compact'] },
} as const;

type DimensionFlag = keyof typeof DIMENSIONS;

/** 校验某个维度的取值；拼错时列出可用值。 */
export function parseDimension(flag: DimensionFlag, raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const { values } = DIMENSIONS[flag];
  if (!(values as readonly string[]).includes(raw)) {
    throw new UserError(`${flag} 取值不合法：${raw}（可用：${values.join(' / ')}）`);
  }
  return raw;
}

export async function shot(argv: string[], url: string | null, json: boolean): Promise<void> {
  const parsed = parseArgs(argv, {
    valueFlags: ['--frontend', '--theme', '--density', '--out'],
    booleanFlags: [],
    allowUnknown: false,
  });
  const outDir = lastValue(parsed, '--out') ?? 'shots';
  const theme = parseDimension('--theme', lastValue(parsed, '--theme'));
  const density = parseDimension('--density', lastValue(parsed, '--density'));
  const which = lastValue(parsed, '--frontend') ?? 'both';
  const frontends: Frontend[] = which === 'both' ? ['desktop', 'mobile'] : [parseFrontend(which)];
  requireSession();

  // 文件名带上生效的维度，两种组合不会互相覆盖。
  const suffix = [theme, density].filter(Boolean).join('-');

  mkdirSync(outDir, { recursive: true });
  const files: string[] = [];
  for (const frontend of frontends) {
    applyViewport(viewportFor(frontend));
    runCli(['goto', frontendUrl(frontend, url)]);
    await waitForReady();
    await captureRootSnapshot();
    const assignments: Array<[string, string]> = [];
    if (theme) assignments.push([DIMENSIONS['--theme'].attribute, theme]);
    if (density) assignments.push([DIMENSIONS['--density'].attribute, density]);
    if (assignments.length) {
      const body = assignments
        .map(([attribute, value]) => `document.documentElement.setAttribute(${JSON.stringify(attribute)}, ${JSON.stringify(value)});`)
        .join(' ');
      runCli(['eval', `(() => { ${body} return true; })()`]);
      // 给主题 CSS/过渡一帧以上时间；否则可能截到切换中的状态。
      await sleep(200);
    }
    const file = join(outDir, `${frontend}${suffix ? `-${suffix}` : ''}.png`);
    runCli(['screenshot', `--filename=${file}`]);
    files.push(file);
  }
  output(json ? files : files.join('\n'), json);
}
