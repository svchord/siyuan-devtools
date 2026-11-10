/**
 * 截图命令。
 *
 * - 不带 `--at`：截**当前页**当前状态，不导航、不改属性。文件名由页面上
 *   实际的前端/明暗/密度决定。
 * - 带 `--at`：在场景列表上批量截图，交给 batch 执行器（测量页 / 交互页
 *   按 `live-first` 选择），不碰无关页面。
 */
import { lastValue, parseArgs } from '../args.ts';
import { captureCurrent, runBatch } from '../batch.ts';
import { EnvironmentError } from '../errors.ts';
import { note, output } from '../format.ts';
import { evalScript } from '../playwright.ts';
import { parseAt, sceneFile } from '../scene.ts';
import { ENV_FN, evalExpr } from '../script/recipe.ts';
import { requireSession } from './session.ts';

interface EnvReading {
  frontend?: unknown;
  themeMode?: unknown;
  uiDensity?: unknown;
}

/** 当前页的实际场景，用于单张截图命名。 */
function currentScene(): { frontend: 'desktop' | 'mobile'; theme: 'light' | 'dark'; density: 'default' | 'compact' } {
  const env = evalScript(evalExpr(ENV_FN)) as EnvReading | null;
  const frontend = env?.frontend === 'browser-mobile' ? 'mobile' : 'desktop';
  const theme = env?.themeMode === 'dark' ? 'dark' : 'light';
  const density = env?.uiDensity === 'compact' ? 'compact' : 'default';
  return { frontend, theme, density };
}

export function shot(argv: string[], url: string | null, json: boolean, at: string | null = null): void {
  const parsed = parseArgs(argv, {
    valueFlags: ['--out'],
    booleanFlags: [],
    allowUnknown: false,
  });
  const outDir = lastValue(parsed, '--out') ?? 'shots';

  if (at === null) {
    requireSession();
    const scene = currentScene();
    const file = sceneFile({ ...scene, attrs: {} });
    const result = captureCurrent(outDir, file);
    output(json ? result : result.path, json);
    return;
  }

  const spec = parseAt(at);
  for (const reason of spec.skipped) note(reason);
  requireSession();
  const result = runBatch({ scenes: spec.scenes, steps: [], policy: 'live-first', shotsDir: outDir, url });
  const failures = result.readings.filter((reading) => reading.error !== undefined);
  if (failures.length) {
    for (const failure of failures) note(`${failure.at} 失败：${failure.error}`);
    if (failures.length === result.readings.length) {
      throw new EnvironmentError(`所有场景都失败：${failures[0]?.error ?? '未知错误'}`);
    }
  }
  if (json) {
    output({ cells: result.readings.map((reading) => reading.at), files: result.shots }, true);
    return;
  }
  output(result.shots.map((item) => item.path).join('\n'), false);
}
