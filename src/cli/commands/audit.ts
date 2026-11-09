/**
 * 批量命令：读计划文件，按 `axes` 遍历测量格，每格一次 run-code 完成
 * 「切设备 + 导航 + 设维度 + 跑 steps + 截图」。
 *
 * ## 为什么遍历放在这里而不是再加一个命令
 *
 * 「改 CSS → 重载 → 全模式验证」是个固定循环：同一组 steps 要在 6 个格上
 * 各跑一遍。让它成为一个计划文件里的 `axes` 字段，agent 就只需要写一次
 * steps，而不是 6 份几乎相同的计划，也不是 30 条 `do attr` + `read`。
 *
 * ## 为什么每格只有一次 run-code
 *
 * 一次 node 子进程约 0.8–1.5s。若「跑计划」与「截图」分两次，6 格就是 12 次
 * 子进程；把 steps 编进 `captureScript` 的 `extra` 之后只要 6 次。代价是
 * 失败粒度停在「哪一格」，不再细分「哪一步」——`error` 里会带上原始消息，
 * 足够定位。
 *
 * ## 每格独立失败
 *
 * 一个格失败不该让其余格无结果：失败格的列值换成 `error` 字段，其它格照常
 * 返回。否则一个选择器在某格不存在，整份矩阵就白跑了。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cellLabel, expandAxes, renderMatrix } from '../cell.ts';
import type { MatrixColumn } from '../cell.ts';
import type { Cell } from '../cell.ts';
import { captureScript, deviceNameFor, deviceProfile } from '../device.ts';
import { EnvironmentError, UserError } from '../errors.ts';
import { note, output } from '../format.ts';
import { runCode, sessionExists } from '../playwright.ts';
import { compilePlanStatements, fillContrastRatios, readPlan } from '../script/plan.ts';
import type { Plan } from '../script/plan.ts';
import { readState, writeState } from '../session-state.ts';
import { THEME_SWITCH_MS } from '../timing.ts';
import { resolveFrontendUrl } from '../url.ts';
import { parseViewport, viewportFor } from '../viewport.ts';
import { launch } from './session.ts';

/** 一格的结果：steps 的读数数组，或这一格失败的原因。 */
interface CellResult {
  at: string;
  steps: unknown;
  error?: string;
  shot?: { path: string; bytes: number };
}

/**
 * audit 是唯一自动创建会话的命令（计划里已声明 frontend 或 axes）。
 *
 * 每格一次 `runCode` 会重新导航，所以不需要复用会话里的设备状态；
 * 这也让 audit 在「会话还没开」时能自己起浏览器（`captureScript` 内部的
 * `goto` 会失败，因此这里先 `launch` 一次建立会话）。
 */
export async function audit(args: string[], json: boolean, url: string | null): Promise<void> {
  const planPath = args[0];
  if (!planPath) throw new UserError('audit 需要计划文件路径');
  const plan = readPlan(planPath);

  const viewport = plan.viewport === undefined ? null : parseViewport(plan.viewport);
  const state = readState();
  // 单前端（旧形状）与 axes（新形状）都归一成格列表；合法域只有 cell.ts 一份。
  const expanded = plan.axes === undefined ? null : expandAxes(plan.axes);
  const cells: Cell[] =
    expanded === null
      ? [
          {
            frontend: plan.frontend ?? 'desktop',
            // 单前端计划不遍历明暗/密度：沿用会话记住的值，不擅自切。
            theme: state?.theme ?? 'light',
            density: state?.density ?? 'default',
          },
        ]
      : expanded.cells;
  for (const reason of expanded?.skipped ?? []) note(reason);

  // 截图目录：计划声明了 shots 才截；建不出来属于环境问题，不是用法问题。
  const shotsDir = plan.shots === undefined ? null : (plan.shots.out ?? 'shots');
  if (shotsDir !== null) {
    try {
      mkdirSync(shotsDir, { recursive: true });
    } catch (cause) {
      throw new EnvironmentError(
        `建不了输出目录：${shotsDir}（${cause instanceof Error ? cause.message : String(cause)}）`
      );
    }
  }

  // 计划只编译一次：同一份 steps 在每个格上重复执行。
  const statements = compilePlanStatements(plan, 'planSteps');

  // audit 是唯一会自己开会话的命令：`run-code` 不创建浏览器，没有会话时
  // 每格都会报 "browser is not open"。先按第一格把会话建起来，
  // 后续格的设备与维度由各自的 `captureScript` 重新覆盖。
  if (!sessionExists()) {
    const first = cells[0]!;
    await launch(first.frontend, resolveFrontendUrl(first.frontend, url), {
      viewport: viewport ?? viewportFor(first.frontend),
      theme: first.theme,
      density: first.density,
    });
  }

  const results: CellResult[] = [];
  for (const cell of cells) {
    const cellViewport =
      viewport ?? (cell.frontend === state?.frontend && state?.viewport ? state.viewport : viewportFor(cell.frontend));
    const deviceName = deviceNameFor(cell.frontend, cell.frontend === 'mobile' ? state?.device ?? null : null);
    try {
      const captured = runCode(
        captureScript({
          profile: deviceName ? deviceProfile(deviceName) : null,
          viewport: cellViewport,
          url: resolveFrontendUrl(cell.frontend, url),
          mode: cell.theme,
          density: cell.density,
          settleMs: THEME_SWITCH_MS,
          extra: { statements, resultsVar: 'planSteps' },
        })
      ) as { data?: unknown; steps?: unknown } | null;
      // 对比度在 Node 侧补算：页面里没有 contrastRatio，不能把它编进 run-code。
      const result: CellResult = { at: cellLabel(cell), steps: fillContrastRatios(plan, captured?.steps ?? null) };
      if (shotsDir !== null) result.shot = writeShot(captured?.data, cell, shotsDir);
      results.push(result);
    } catch (cause) {
      // 单格失败不中断整份矩阵：其余格的结果同样有价值。
      results.push({
        at: cellLabel(cell),
        steps: null,
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }

  // 遍历结束后页面停在**最后一格**（每格都自己导航），状态文件要如实记录，
  // 否则下一条 `read` 按文件推断状态会与实际页面不一致。
  const last = cells.at(-1)!;
  writeState({
    url: resolveFrontendUrl(last.frontend, url),
    frontend: last.frontend,
    device: state?.device ?? null,
    viewport: viewport ?? state?.viewport ?? null,
    theme: last.theme,
    density: last.density,
  });

  if (expanded === null) {
    // 单前端：保持旧输出（steps 数组），不把单值包成表。
    const only = results[0];
    if (only?.error !== undefined) throw new UserError(only.error);
    output(only?.steps, json);
    return;
  }
  const failures = results.filter((result) => result.error !== undefined);
  // 全部失败说明这次测量整体不可用：直接抛错（exit 2），否则 agent 会把
  // 一张全 null 的表当成「这些格没有差异」。
  if (failures.length === results.length) {
    throw new UserError(`所有格都失败：${failures[0]?.error ?? '未知错误'}`);
  }
  const table = renderMatrix(columnsFor(plan), results.map(toReading), true);
  if (failures.length) table.errors = results.filter((r) => r.error !== undefined).map((r) => ({ at: r.at, error: r.error }));
  // 截图的路径与字节数一起回：agent 不需要读图时也知道产物在哪，
  // 需要时再按路径去读，不必重跑一遍。
  const shots = results.flatMap((result) => (result.shot ? [{ at: result.at, ...result.shot }] : []));
  if (shots.length) table.shots = shots;
  output(table, json);
  for (const result of failures) note(`${result.at} 失败：${result.error}`);
}

/** 把一格结果转成矩阵的一行；失败格整行给 error，其余列留 null。 */
function toReading(result: CellResult): { at: string; value: unknown } {
  if (result.error === undefined) return { at: result.at, value: flattenSteps(result.steps) };
  return { at: result.at, value: { error: result.error } };
}

/**
 * `[{step, value}]` → `{ "0": value0, "1": value1 }`。
 *
 * 矩阵的列是「step 序号 + 读什么」，行里按序号取值；保持数组形状会让每一行
 * 都要重复 `step` 字段，6 格 × 3 步多出约 90 B 的纯冗余。
 */
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

/**
 * 矩阵的列：按 step 类型展开成标量列。
 *
 * 不把整个 step 值塞进一格：`read element` 的原始值是带 `tag` / `className` /
 * `boxes` 的对象，6 格重复下来 2 KB 以上，而 agent 通常只关心「哪个属性的值
 * 变了」。列展开到具体字段后，`renderMatrix` 才能把「所有格都一样」的列折叠
 * 掉——这正是矩阵省 token 的地方。
 */
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
    columns.push({ label: prefix, path: String(index) });
  });
  return columns;
}

/** 把 base64 落盘，返回路径与字节数（不把图像内容带进结果）。 */
function writeShot(data: unknown, cell: Cell, outDir: string): { path: string; bytes: number } {
  if (typeof data !== 'string') throw new EnvironmentError('截图失败：CDP 没有返回图像数据');
  const buffer = Buffer.from(data, 'base64');
  const file = join(outDir, `${cell.frontend}-${cell.theme}-${cell.density}.png`);
  writeFileSync(file, buffer);
  return { path: file, bytes: buffer.length };
}
