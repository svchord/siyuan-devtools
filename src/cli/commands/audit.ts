/**
 * 批量命令：读计划文件，在场景矩阵上跑 steps，返回一张表。
 *
 * 执行模型：**measure-only**（全部用测量页，从不碰你的交互页），因为计划
 * 里的 `do` 动作会改动页面，每格开始前需要 reload。纯读数的计划同样走
 * 这条路径，保证 audit 的结果与你在哪一页无关、可复现。
 */
import { planScenes, runBatch } from '../batch.ts';
import { renderMatrix } from '../matrix.ts';
import type { MatrixColumn } from '../matrix.ts';
import { UserError } from '../errors.ts';
import { note, output } from '../format.ts';
import { sessionExists } from '../playwright.ts';
import { fillContrastRatios, readPlan } from '../script/plan.ts';
import type { Plan } from '../script/plan-schema.ts';
import { parseViewport } from '../viewport.ts';
import { open } from './session.ts';

/** 一格的结果：steps 的读数数组，或这一格失败的原因。 */
interface CellResult {
  at: string;
  steps: unknown;
  error?: string;
}

export async function audit(args: string[], json: boolean, url: string | null): Promise<void> {
  const planPath = args[0];
  if (!planPath) throw new UserError('audit 需要计划文件路径');
  const plan = readPlan(planPath);

  // audit 是唯一会自动创建会话的命令：CI 里没有先 open 也能跑。
  if (!sessionExists()) await open([], url);

  const viewport = plan.viewport === undefined ? null : parseViewport(plan.viewport);
  const spec = planScenes(plan);
  for (const reason of spec.skipped) note(reason);

  const shotsDir = plan.shots === undefined ? null : (plan.shots.out ?? 'shots');
  const hasActions = plan.steps.some((step) => step.do !== undefined);
  const result = runBatch({
    scenes: spec.scenes,
    steps: plan.steps,
    shotsDir,
    policy: 'measure-only',
    reloadWhenDirty: hasActions,
    url,
    viewport,
  });

  const results: CellResult[] = result.readings.map((reading) => {
    if (reading.error !== undefined) return { at: reading.at, steps: null, error: reading.error };
    return { at: reading.at, steps: fillContrastRatios(plan, reading.value) };
  });

  const failures = results.filter((item) => item.error !== undefined);
  if (failures.length === results.length) {
    throw new UserError(`所有格都失败：${failures[0]?.error ?? '未知错误'}`);
  }

  const table = renderMatrix(
    columnsFor(plan),
    results.map((item) => ({
      at: item.at,
      value: item.error === undefined ? flattenSteps(item.steps) : { error: item.error },
    })),
    true
  );
  if (failures.length) table.errors = failures.map((item) => ({ at: item.at, error: item.error }));
  if (result.shots.length) table.shots = result.shots;
  output(table, json);
  for (const item of failures) note(`${item.at} 失败：${item.error}`);
}

/** `[{step, value}]` → `{ "0": value0, "1": value1 }`。 */
function flattenSteps(steps: unknown): Record<string, unknown> {
  if (!Array.isArray(steps)) return {};
  const flat: Record<string, unknown> = {};
  for (const item of steps) {
    if (typeof item !== 'object' || item === null) continue;
    const index = (item as { step?: unknown }).step;
    if (typeof index !== 'number') continue;
    flat[String(index)] = (item as { value?: unknown }).value;
  }
  return flat;
}

/** 矩阵的列：按 step 类型展开成标量列。 */
function columnsFor(plan: Plan): MatrixColumn[] {
  const columns: MatrixColumn[] = [];
  plan.steps.forEach((step, index) => {
    const prefix = `s${String(index)}`;
    if (step.read === 'tokens') {
      for (const name of step.names ?? []) columns.push({ label: `${prefix}.${name}`, path: `${String(index)}.${name}` });
      return;
    }
    if (step.read === 'element') {
      for (const prop of step.props ?? ['color', 'background-color']) {
        columns.push({ label: `${prefix}.${prop}`, path: `${String(index)}.styles.${prop}` });
      }
      if (step.box === true) columns.push({ label: `${prefix}.height`, path: `${String(index)}.boxes.0.height` });
      return;
    }
    if (step.read === 'contrast') {
      columns.push({ label: `${prefix}.ratio`, path: `${String(index)}.ratio` });
      return;
    }
    if (step.read === 'env') {
      columns.push(
        { label: `${prefix}.themeMode`, path: `${String(index)}.themeMode` },
        { label: `${prefix}.density`, path: `${String(index)}.uiDensity` }
      );
      return;
    }
    if (step.diff) {
      for (const prop of step.diff.props) {
        columns.push(
          { label: `${prefix}.before.${prop}`, path: `${String(index)}.before.${prop}` },
          { label: `${prefix}.after.${prop}`, path: `${String(index)}.after.${prop}` }
        );
      }
      return;
    }
    // 没有 diff 的 do 步骤不产生读数，不占列。
    if (step.do !== undefined) return;
    columns.push({ label: prefix, path: String(index) });
  });
  return columns;
}
