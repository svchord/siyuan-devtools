/**
 * 读数命令：env / tokens / element / contrast。
 *
 * 两条路径，语义完全不同但输出规则一致：
 *  - 不带 `--at`：读**当前页**当前状态，返回单值。
 *  - 带 `--at`：在场景列表上跑一遍，返回矩阵；当前前端那一页就是你的交互页，
 *    其它前端懒创建测量页。跑完把属性设回去，交互态不丢。
 *
 * 校验顺序固定为：**参数 → 会话**。参数写错时不该先被「未启动」挡住。
 */
import { lastValue, parseArgs, positiveInt } from '../args.ts';
import { runBatch } from '../batch.ts';
import { contrastRatio } from '../contrast.ts';
import { parseProps } from '../css.ts';
import { UserError } from '../errors.ts';
import { note, output } from '../format.ts';
import { renderMatrix } from '../matrix.ts';
import type { MatrixColumn } from '../matrix.ts';
import { evalScript } from '../playwright.ts';
import { parseAt } from '../scene.ts';
import { contrastFn, DEFAULT_ELEMENT_PROPS, elementFn, ENV_FN, evalExpr, TOKENS_FN } from '../script/recipe.ts';
import type { Plan, PlanStep } from '../script/plan-schema.ts';
import { isRecord } from '../util.ts';
import { requireSession } from './session.ts';

/** 令牌读数：区分「未定义」与「定义了但值为空」。 */
function readTokens(names: string[]): Record<string, string> {
  return decodeTokens(evalScript(evalExpr(TOKENS_FN, names)));
}

/** 把页面返回的 `{values, missing}` 收窄成值表；未定义令牌一律报错。 */
function decodeTokens(raw: unknown): Record<string, string> {
  if (!isRecord(raw)) throw new UserError('令牌读数返回了意外的形状');
  const values = isRecord(raw.values) ? (raw.values as Record<string, string>) : {};
  const missing = Array.isArray(raw.missing) ? raw.missing.map(String) : [];
  if (missing.length) throw new UserError(`未定义的 CSS 变量：${missing.join('、')}`);
  return values;
}

/** 对比度读数：令牌名或字面量颜色都可以。 */
function contrastReading(fg: string, bg: string): { foreground: string; background: string; ratio: number | null } {
  return decodeContrast(evalScript(evalExpr(contrastFn(fg, bg))));
}

/** 把页面返回的 `{foreground, background, missing}` 收窄并补算 ratio。 */
function decodeContrast(raw: unknown): { foreground: string; background: string; ratio: number | null } {
  if (!isRecord(raw)) throw new UserError('对比度读数返回了意外的形状');
  const foreground = typeof raw.foreground === 'string' ? raw.foreground : '';
  const background = typeof raw.background === 'string' ? raw.background : '';
  const missing = Array.isArray(raw.missing) ? raw.missing.map(String) : [];
  if (missing.length) throw new UserError(`未定义的 CSS 变量：${missing.join('、')}`);
  return { foreground, background, ratio: contrastRatio(foreground, background) };
}

/** 元素读数里「定位信息」的投影；默认丢掉 tag/className，`--meta` 才带。 */
function projectElement(raw: unknown, meta: boolean, box: boolean): Record<string, unknown> {
  if (!isRecord(raw)) return { found: false, count: 0, visible: 0, styles: {} };
  const projected: Record<string, unknown> = {
    found: raw.found,
    count: raw.count,
    visible: raw.visible,
    styles: raw.styles,
  };
  if (meta) {
    projected.tag = raw.tag;
    projected.className = raw.className;
  }
  if (box) projected.boxes = raw.boxes;
  return projected;
}

interface ElementOptions {
  selector: string;
  props: string[];
  box: boolean;
  meta: boolean;
  limit: number;
}

function elementOptions(rest: string[]): ElementOptions {
  const parsed = parseArgs(rest, {
    valueFlags: ['--props', '--limit'],
    booleanFlags: ['--box', '--meta'],
    allowUnknown: false,
  });
  const selector = parsed.positional[0];
  if (!selector) throw new UserError('read element 需要选择器');
  const box = parsed.flags.has('--box');
  if (lastValue(parsed, '--limit') !== undefined && !box) throw new UserError('--limit 只能与 --box 一起使用');
  return {
    selector,
    props: parseProps(lastValue(parsed, '--props'), DEFAULT_ELEMENT_PROPS),
    box,
    meta: parsed.flags.has('--meta'),
    limit: positiveInt(parsed, '--limit', 5),
  };
}

function tokenNames(rest: string[]): string[] {
  const tokens = rest.filter((token) => token !== '--');
  const names = tokens.filter((token) => token.startsWith('--'));
  const ignored = tokens.filter((token) => !token.startsWith('--'));
  if (ignored.length) throw new UserError(`令牌名必须以 -- 开头：${ignored.join('、')}`);
  if (!names.length) throw new UserError('read tokens 需要至少一个令牌名，如 --brand-8');
  return names;
}

/** 单值结果 → 矩阵；只解出第一步的值，并按类型补 ratio。 */
function toReadings(
  readings: readonly { at: string; value: unknown; error?: string }[],
  step: PlanStep
): { at: string; value: unknown; error?: string }[] {
  return readings.map((reading) => {
    if (reading.error !== undefined) return reading;
    const steps = Array.isArray(reading.value) ? reading.value : [];
    const first = steps[0] as { value?: unknown } | undefined;
    let value = first?.value ?? null;
    if (step.read === 'contrast' && isRecord(value)) {
      const foreground = typeof value.foreground === 'string' ? value.foreground : '';
      const background = typeof value.background === 'string' ? value.background : '';
      value = { foreground, background, ratio: contrastRatio(foreground, background) };
    }
    return { at: reading.at, value };
  });
}

/** 按 step 定义生成列。 */
function readColumns(step: PlanStep, options?: ElementOptions): MatrixColumn[] {
  if (step.read === 'tokens') return (step.names ?? []).map((name) => ({ label: name, path: name }));
  if (step.read === 'element') {
    const props = options?.props ?? step.props ?? [...DEFAULT_ELEMENT_PROPS];
    const columns = props.map((prop) => ({ label: prop, path: `styles.${prop}` }));
    if (options?.box ?? step.box === true) {
      columns.push({ label: 'width', path: 'boxes.0.width' }, { label: 'height', path: 'boxes.0.height' });
    }
    return columns;
  }
  if (step.read === 'contrast') {
    return [
      { label: 'foreground', path: 'foreground' },
      { label: 'background', path: 'background' },
      { label: 'ratio', path: 'ratio' },
    ];
  }
  return [
    { label: 'themeMode', path: 'themeMode' },
    { label: 'uiDensity', path: 'uiDensity' },
    { label: 'themeStyle', path: 'themeStyle' },
  ];
}

function emitMatrix(columns: MatrixColumn[], readings: { at: string; value: unknown; error?: string }[], json: boolean): void {
  const failures = readings.filter((reading) => reading.error !== undefined);
  const table = renderMatrix(
    columns,
    readings.map((reading) => ({ at: reading.at, value: reading.value }))
  );
  if (failures.length) {
    table.errors = failures.map((reading) => ({ at: reading.at, error: reading.error }));
  }
  if (json) {
    output(table, true);
    return;
  }
  const header = ['at', ...(table.columns as string[])].join('  ');
  const lines = [header];
  for (const [index, cell] of (table.cells as string[]).entries()) {
    const row = (table.rows as unknown[][])[index] ?? [];
    lines.push([cell, ...row.map((value) => (value === null ? '(无)' : String(value)))].join('  '));
  }
  const same = table.same as Record<string, unknown> | undefined;
  if (same) for (const [key, value] of Object.entries(same)) lines.push(`（所有格相同）${key}: ${String(value)}`);
  output(lines.join('\n'), false);
}

/** `--at` 路径：把读数命令编译成一个单步计划，交给 batch 执行器。 */
function readMatrix(sub: string, step: PlanStep, rest: string[], at: string, json: boolean, url: string | null): void {
  const spec = parseAt(at);
  for (const reason of spec.skipped) note(reason);
  requireSession();
  const plan: Plan = { at, steps: [step] };
  const result = runBatch({ scenes: spec.scenes, steps: plan.steps, policy: 'live-first', url });
  const readings = toReadings(result.readings, step);
  const options = sub === 'element' ? elementOptions(rest) : undefined;
  emitMatrix(readColumns(step, options), readings, json);
}

export function read(
  argv: string[],
  json: boolean,
  at: string | null = null,
  url: string | null = null
): void {
  const [sub, ...rest] = argv;
  if (!sub) throw new UserError('read 需要子命令：env / tokens / element / contrast');

  if (sub === 'env') {
    const step: PlanStep = { read: 'env' };
    if (at !== null) {
      readMatrix(sub, step, rest, at, json, url);
      return;
    }
    requireSession();
    output(evalScript(evalExpr(ENV_FN)), json);
    return;
  }

  if (sub === 'tokens') {
    const names = tokenNames(rest);
    const step: PlanStep = { read: 'tokens', names };
    if (at !== null) {
      readMatrix(sub, step, rest, at, json, url);
      return;
    }
    requireSession();
    output(readTokens(names), json);
    return;
  }

  if (sub === 'element') {
    const options = elementOptions(rest);
    const step: PlanStep = {
      read: 'element',
      selector: options.selector,
      props: options.props,
      box: options.box,
      limit: options.limit,
    };
    if (at !== null) {
      readMatrix(sub, step, rest, at, json, url);
      return;
    }
    requireSession();
    const value = projectElement(
      evalScript(evalExpr(elementFn(options.selector, options.props, options.box, options.limit))),
      options.meta,
      options.box
    );
    output(value, json);
    return;
  }

  if (sub === 'contrast') {
    const [fg, bg] = rest;
    if (!fg || !bg) throw new UserError('read contrast 需要前景与背景令牌名（或颜色值）');
    const step: PlanStep = { read: 'contrast', foreground: fg, background: bg };
    if (!fg.startsWith('--') && !bg.startsWith('--')) {
      if (at !== null) throw new UserError('read contrast 两个字面量颜色不接受 --at：与页面状态无关');
      output({ foreground: fg, background: bg, ratio: contrastRatio(fg, bg) }, json);
      return;
    }
    if (at !== null) {
      readMatrix(sub, step, rest, at, json, url);
      return;
    }
    requireSession();
    output(contrastReading(fg, bg), json);
    return;
  }

  throw new UserError(`未知 read 子命令：${sub}`);
}
