/**
 * 读数命令：env / tokens / element / contrast。
 *
 * 全部走 `cli --json eval`，片段来自 recipe.ts。
 *
 * 共同原则：
 *  1. **读不到就说读不到**，不要返回空字符串——空串与「属性值为空」无法区分，
 *     agent 会把拼错的名字当成「没有值」继续往下走。
 *  2. **先校验参数、再要求会话**：参数写错时不该先被「未启动」挡住，
 *     否则 agent 会先去 open，再撞上同一个错。
 *
 * ## `--at` 的两种输出形状
 *
 * 不带 `--at`：就是当前页面上的一个值，输出保持原样（向后兼容）。
 * 带 `--at`：同一份读数在多个格上各取一次，输出是 `renderMatrix` 的表——
 * 列只写一次、行是纯值数组，6 格 × 3 列约 400 B，而不是 6 份带键的对象。
 *
 * 为什么不把单值也包成表：单值时表只是多一层壳，agent 反而要多解析一次。
 *
 * ## 为什么返回值是 `void | Promise<void>`
 *
 * 参数校验必须**同步**抛错（测试与调用方都按 `expect(() => read(...)).toThrow()`
 * 使用），只有需要逐格切换的 `--at` 路径才是异步的。整个函数写成 `async`
 * 会把参数错误变成 unhandled rejection——对 agent 来说就是「没输出也没报错」。
 */
import { lastValue, parseArgs, positiveInt } from '../args.ts';
import { cellReadingSource, parseAt, renderMatrix, withCells } from '../cell.ts';
import type { CellReading, MatrixColumn } from '../cell.ts';
import { contrastRatio } from '../contrast.ts';
import { parseProps } from '../css.ts';
import { UserError } from '../errors.ts';
import { note, output } from '../format.ts';
import { evalScript } from '../playwright.ts';
import { contrastFn, DEFAULT_ELEMENT_PROPS, elementFn, ENV_FN, evalExpr, TOKENS_FN } from '../script/recipe.ts';
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
  // 与 read tokens 同一套严格语义：拼错的令牌名必须报错。
  if (missing.length) throw new UserError(`未定义的 CSS 变量：${missing.join('、')}`);
  return { foreground, background, ratio: contrastRatio(foreground, background) };
}

/**
 * 元素读数里「定位信息」的投影。
 *
 * 页面片段统一返回 `tag` / `className`，但 agent 多数时候只想要一个颜色值：
 * 这两项（className 还截到 120 字符）在每次读数里都是纯开销。默认丢掉，
 * `--meta` 才带回来——投影放在 Node 侧而不是改 recipe，是因为 recipe 的
 * 片段被 audit 计划共用，签名不该为 CLI 的显示偏好而变。
 */
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
  // 只有 --box 时片段才会给 boxes；原样透传，不在这里重排。
  if (box) projected.boxes = raw.boxes;
  return projected;
}

/** 元素读数的参数（先校验、不碰浏览器）。 */
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
  // --limit 只影响 --box 的输出；单独给等于静默无效。
  if (lastValue(parsed, '--limit') !== undefined && !box) throw new UserError('--limit 只能与 --box 一起使用');
  return {
    selector,
    props: parseProps(lastValue(parsed, '--props'), DEFAULT_ELEMENT_PROPS),
    box,
    meta: parsed.flags.has('--meta'),
    limit: positiveInt(parsed, '--limit', 5),
  };
}

/** 令牌名列表（先校验、不碰浏览器）。 */
function tokenNames(rest: string[]): string[] {
  // `--` 是字面量分隔符，本身不是令牌名；其余非 `--` 开头的参数也不接受。
  const tokens = rest.filter((token) => token !== '--');
  const names = tokens.filter((token) => token.startsWith('--'));
  const ignored = tokens.filter((token) => !token.startsWith('--'));
  if (ignored.length) throw new UserError(`令牌名必须以 -- 开头：${ignored.join('、')}`);
  if (!names.length) throw new UserError('read tokens 需要至少一个令牌名，如 --brand-8');
  return names;
}

/** 多格输出的公共收尾：把 readings 渲染成表。 */
function emitMatrix(columns: MatrixColumn[], readings: CellReading<unknown>[], json: boolean): void {
  const table = renderMatrix(columns, readings);
  if (json) {
    output(table, true);
    return;
  }
  // 文本模式：一格一行，列名做表头。agent 用 --json，这里只是给人看。
  const header = ['at', ...(table.columns as string[])].join('  ');
  const lines = [header];
  for (const [index, cell] of (table.cells as string[]).entries()) {
    const row = (table.rows as unknown[][])[index] ?? [];
    lines.push([cell, ...row.map((value) => (value === null ? '(无)' : String(value)))].join('  '));
  }
  const same = table.same as Record<string, unknown> | undefined;
  if (same) {
    for (const [key, value] of Object.entries(same)) lines.push(`（所有格相同）${key}: ${String(value)}`);
  }
  output(lines.join('\n'), false);
}

/** `--at` 的公共前置：解析、要求会话、把跳过原因打到 stderr。 */
function atSpec(at: string): ReturnType<typeof parseAt> {
  const spec = parseAt(at);
  requireSession();
  for (const reason of spec.skipped) note(reason);
  return spec;
}

export function read(
  argv: string[],
  json: boolean,
  at: string | null = null,
  url: string | null = null
): void | Promise<void> {
  const [sub, ...rest] = argv;
  if (!sub) throw new UserError('read 需要子命令：env / tokens / element / contrast');

  if (sub === 'env') {
    // env 本身就是「这一页是什么状态」，指定格没有意义：切换完再读 env，
    // 读到的只是刚设下去的值。所以直接拒绝，而不是给一个恒等的表。
    if (at !== null) throw new UserError('read env 不接受 --at：它读的就是当前状态，用 status 看目标状态');
    requireSession();
    output(evalScript(evalExpr(ENV_FN)), json);
    return;
  }

  if (sub === 'tokens') {
    const names = tokenNames(rest);
    if (at === null) {
      requireSession();
      output(readTokens(names), json);
      return;
    }
    const spec = atSpec(at);
    // 列名用令牌名本身：6 格 × N 个令牌的表头只出现一次。
    return withCells(
      spec.cells,
      url,
      (cell) => cellReadingSource(cell.theme, cell.density, evalExpr(TOKENS_FN, names)),
      decodeTokens
    ).then((readings) => {
      emitMatrix(names.map((name) => ({ label: name, path: name })), readings, json);
    });
  }

  if (sub === 'element') {
    const options = elementOptions(rest);
    const readOne = (): Record<string, unknown> =>
      projectElement(
        evalScript(evalExpr(elementFn(options.selector, options.props, options.box, options.limit))),
        options.meta,
        options.box
      );
    if (at === null) {
      requireSession();
      output(readOne(), json);
      return;
    }
    const spec = atSpec(at);
    // 列用点路径：`styles.color`、`boxes.0.height` 都能对齐到同一张表。
    const columns: MatrixColumn[] = options.props.map((prop) => ({ label: prop, path: `styles.${prop}` }));
    if (options.box) {
      columns.push({ label: 'width', path: 'boxes.0.width' }, { label: 'height', path: 'boxes.0.height' });
    }
    const elementSource = evalExpr(elementFn(options.selector, options.props, options.box, options.limit));
    return withCells(
      spec.cells,
      url,
      (cell) => cellReadingSource(cell.theme, cell.density, elementSource),
      (raw) => projectElement(raw, options.meta, options.box)
    ).then((readings) => {
      emitMatrix(columns, readings, json);
    });
  }

  if (sub === 'contrast') {
    const [fg, bg] = rest;
    if (!fg || !bg) throw new UserError('read contrast 需要前景与背景令牌名（或颜色值）');
    // 两个都是字面量颜色时不需要浏览器，也就不存在「在哪个格上算」。
    if (!fg.startsWith('--') && !bg.startsWith('--')) {
      if (at !== null) throw new UserError('read contrast 两个字面量颜色不接受 --at：与页面状态无关');
      output({ foreground: fg, background: bg, ratio: contrastRatio(fg, bg) }, json);
      return;
    }
    if (at === null) {
      requireSession();
      output(contrastReading(fg, bg), json);
      return;
    }
    const spec = atSpec(at);
    return withCells(
      spec.cells,
      url,
      (cell) => cellReadingSource(cell.theme, cell.density, evalExpr(contrastFn(fg, bg))),
      decodeContrast
    ).then((readings) => {
      emitMatrix(
        [
          { label: 'foreground', path: 'foreground' },
          { label: 'background', path: 'background' },
          { label: 'ratio', path: 'ratio' },
        ],
        readings,
        json
      );
    });
  }

  throw new UserError(`未知 read 子命令：${sub}`);
}
