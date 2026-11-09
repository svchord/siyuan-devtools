/**
 * 测量格（cell）：`frontend/theme/density` 三元组，以及进入某一格的副作用。
 *
 * ## 为什么需要它
 *
 * 三个维度原先各走各的：`shot` 有 `--theme/--density`，`read` 一个都没有，
 * `audit` 只有单个 `frontend`。于是「6 格 × 3 个读数」只能靠 agent 自己
 * 拼 `do attr` + `read` + `reload`，一轮下来 30 条命令、30 个模型回合。
 *
 * 把「页面处在哪个格」变成一个可解析、可切换的值以后：
 *  - `read --at all` 一条命令返回 6 行；
 *  - `audit` 的 `axes` 直接展开成格；
 *  - 所有命令共用同一套切换与恢复逻辑，不会再出现「shot 会恢复、read 不会」。
 *
 * ## 为什么 frontend 在外层
 *
 * 三个轴的成本差一个数量级（实测）：切 frontend 要 CDP 换设备 + 导航 +
 * 等 `isReady`（2–5s，且清掉 hover/菜单/滚动），切 theme 要换两张样式表
 * （~200ms），切 density 只是加删一个属性（~100ms）。所以 6 格 = 2 次导航，
 * 不是 6 次——`withCells` 按 frontend 分组执行，同一前端的格连续跑。
 *
 * ## 为什么有「不存在的格」
 *
 * 上游 `isCompactModeAvailable` 只允许 desktop / desktop-window /
 * browser-desktop，移动端永远没有紧凑模式。所以合法域是
 * 4（desktop × 2 theme × 2 density）+ 2（mobile × 2 theme）= **6 格**，
 * 不是 8 格。`CELLS` 只列真实存在的，`skippedCells` 负责解释缺的那两格。
 *
 * ## 为什么同一格只发一次 eval
 *
 * 一条 eval 就是一次 node 子进程（~0.6s）。明暗要换 `<link>`、密度只改属性，
 * 但两者可以合进同一个页面函数顺序执行，所以切一格只花一次 spawn，
 * 而不是「theme 一次 + density 一次」。
 */
import { UserError } from './errors.ts';
import { isDensity, isThemeMode } from './dimensions.ts';
import type { Density, ThemeMode } from './dimensions.ts';
import { captureScript, deviceNameFor, deviceProfile } from './device.ts';
import { evalScript, runCode } from './playwright.ts';
import { ENV_FN, evalExpr, THEME_FN } from './script/recipe.ts';
import { THEME_SWITCH_MS } from './timing.ts';
import { resolveFrontendUrl } from './url.ts';
import type { Frontend } from './url.ts';
import { isRecord } from './util.ts';
import { viewportFor } from './viewport.ts';

/** 一个测量格。三个维度都必须有确定值——「不改」只在参数层存在，不是格。 */
export interface Cell {
  frontend: Frontend;
  theme: ThemeMode;
  density: Density;
}

const FRONTENDS: readonly Frontend[] = ['desktop', 'mobile'];
const THEMES: readonly ThemeMode[] = ['light', 'dark'];
const DENSITIES: readonly Density[] = ['default', 'compact'];

/** 移动端没有紧凑模式，这是上游限制，不是本工具的取舍。 */
export function cellExists(frontend: Frontend, density: Density): boolean {
  return !(frontend === 'mobile' && density === 'compact');
}

/** 全部合法格：frontend 外层，theme × density 内层（与执行顺序一致）。 */
export const CELLS: readonly Cell[] = FRONTENDS.flatMap((frontend) =>
  THEMES.flatMap((theme) =>
    DENSITIES.filter((density) => cellExists(frontend, density)).map((density) => ({ frontend, theme, density }))
  )
);

/** 被排除的组合及原因；`--at all` 时用来说明为什么只有 6 格。 */
export function skippedCells(): string[] {
  return ['mobile/*/compact：上游移动端没有紧凑模式'];
}

/** 格的标准写法，也是所有输出里的 `at` 字段。 */
export function cellLabel(cell: Cell): string {
  return `${cell.frontend}/${cell.theme}/${cell.density}`;
}

/** 解析结果：展开出的格，以及解释用的跳过原因。 */
export interface CellSpec {
  cells: Cell[];
  skipped: string[];
}

/**
 * 解析 `--at` 的取值。
 *
 * 支持三种粒度，缺省的段按「全展开」补齐：
 *   `desktop/dark/default`  一格
 *   `desktop/dark`          该前端的两个密度
 *   `desktop`               该前端全部 4 格
 *   `all`                   全部 6 格
 * 也接受逗号列表，各段分别展开后去重（顺序保持输入顺序）。
 *
 * 不写星号通配：`desktop` 加星号再指定密度，与「省略段」语义重复，
 * 两种写法并存只会让 agent 猜哪个才是对的。
 */
export function parseAt(raw: string): CellSpec {
  const text = raw.trim();
  if (!text) throw new UserError('--at 不能为空；用 all 或 前端/明暗/密度，如 desktop/dark/default');

  const cells: Cell[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();

  const push = (cell: Cell): void => {
    const label = cellLabel(cell);
    if (seen.has(label)) return;
    seen.add(label);
    cells.push(cell);
  };

  for (const part of text.split(',')) {
    const segment = part.trim();
    if (!segment) throw new UserError('--at 里有空的段；用逗号分隔的格，如 desktop/dark,desktop/light');
    if (segment === 'all') {
      for (const cell of CELLS) push(cell);
      skipped.push(...skippedCells());
      continue;
    }
    const pieces = segment.split('/');
    if (pieces.length > 3) throw new UserError(`--at 段数太多：${segment}（最多 前端/明暗/密度）`);
    const [frontendRaw, themeRaw, densityRaw] = pieces as [string, string | undefined, string | undefined];
    const frontend = parseFrontendPart(frontendRaw, segment);
    const themes = themeRaw === undefined ? THEMES : [parseThemePart(themeRaw, segment)];
    const densities = densityRaw === undefined ? DENSITIES : [parseDensityPart(densityRaw, segment)];
    for (const theme of themes) {
      for (const density of densities) {
        if (!cellExists(frontend, density)) {
          skipped.push(`${frontend}/${theme}/${density}：上游移动端没有紧凑模式`);
          continue;
        }
        push({ frontend, theme, density });
      }
    }
  }

  if (!cells.length) {
    throw new UserError(`--at 没有展开出任何格：${skipped.join('；') || raw}`);
  }
  return { cells, skipped };
}

function parseFrontendPart(raw: string, whole: string): Frontend {
  if (raw === 'desktop' || raw === 'mobile') return raw;
  throw new UserError(`--at 里的前端不合法：${whole}（可用：desktop / mobile）`);
}

function parseThemePart(raw: string, whole: string): ThemeMode {
  if (isThemeMode(raw)) return raw;
  throw new UserError(`--at 里的明暗不合法：${whole}（可用：light / dark）`);
}

function parseDensityPart(raw: string, whole: string): Density {
  if (isDensity(raw)) return raw;
  if (raw === 'comfortable') {
    throw new UserError(
      `--at 不接受 comfortable：上游的普通态是「没有 data-ui-density 属性」，请用 default（${whole}）`
    );
  }
  throw new UserError(`--at 里的密度不合法：${whole}（可用：default / compact）`);
}

/** 页面上的 `data-frontend` → 命令里的前端名。 */
const FRONTEND_ATTR: Record<string, Frontend> = {
  'browser-desktop': 'desktop',
  'browser-mobile': 'mobile',
};

/** 从页面读数里取当前格；页面没就绪或字段缺失返回 null。 */
export function currentCell(): Cell | null {
  let env: unknown;
  try {
    env = evalScript(evalExpr(ENV_FN));
  } catch {
    return null;
  }
  if (!isRecord(env)) return null;
  const frontendRaw = typeof env.frontend === 'string' ? env.frontend : null;
  const frontend = frontendRaw ? FRONTEND_ATTR[frontendRaw] : undefined;
  const theme = isThemeMode(env.themeMode) ? env.themeMode : null;
  // 属性不存在**就是**普通态，不是「未知」。
  const density: Density = env.uiDensity === 'compact' ? 'compact' : 'default';
  if (!frontend || !theme) return null;
  return { frontend, theme, density };
}


/**
 * 把「切维度」和「一次读数」编进同一条 eval。
 *
 * 分开发是两次 node 子进程（各 ~0.6s），6 格就是 12 次；合起来只要 6 次。
 * 读数片段都是同步自执行表达式，直接放在 async 函数里 return 即可。
 * 传入的 `readSource` 必须是一条**表达式**（`(fn)(args)` 形状），不是语句。
 */
export function cellReadingSource(theme: ThemeMode, density: Density, readSource: string): string {
  const densityCode =
    density === 'compact'
      ? `document.documentElement.setAttribute('data-ui-density', 'compact');`
      : `document.documentElement.removeAttribute('data-ui-density');`;
  return `(async () => {
  await (${THEME_FN})(${JSON.stringify(theme)});
  ${densityCode}
  return (${readSource});
})()`;
}

/**
 * 把页面切到某一格。
 *
 * 同前端只改属性（一次 eval，~200ms）。跨前端要一步完成「换设备 + 导航 +
 * 等就绪 + 设维度」：`launch` 走的是 4–5 次子进程（goto / applyDevice /
 * reload / waitForReady / snapshot），这里复用 `captureScript` 的 `screenshot: false`
 * 把同一件事压成一次 run-code——6 格里有 2 次跨前端，省下的就是 6–8 次子进程。
 *
 * 注意：跨前端会**清掉** hover、打开的菜单与滚动位置——这是导航的固有代价，
 * 调用方应该在格内重建交互场景，而不是指望它保留。
 */
export async function applyCell(cell: Cell, url: string | null, frontendNow: Frontend | null): Promise<void> {
  if (frontendNow === cell.frontend) {
    evalScript(cellReadingOnlySource(cell.theme, cell.density));
    return;
  }
  const deviceName = deviceNameFor(cell.frontend, null);
  runCode(
    captureScript({
      profile: deviceName ? deviceProfile(deviceName) : null,
      viewport: viewportFor(cell.frontend),
      url: resolveFrontendUrl(cell.frontend, url),
      mode: cell.theme,
      density: cell.density,
      settleMs: THEME_SWITCH_MS,
      screenshot: false,
    })
  );
}

/** 只切维度、不读数的页面表达式。 */
function cellReadingOnlySource(theme: ThemeMode, density: Density): string {
  return cellReadingSource(theme, density, 'true');
}

/** 一次测量的结果，`at` 让调用方不必回头猜测的是哪一格。 */
export interface CellReading<T> {
  at: string;
  value: T;
}

/** 两个格是否完全相同。 */
export function sameCell(a: Cell | null, b: Cell | null): boolean {
  if (a === null || b === null) return a === b;
  return a.frontend === b.frontend && a.theme === b.theme && a.density === b.density;
}

/**
 * 依次进入每个格、取一次读数，结束后把页面还原到进入前的格。
 *
 * ## 为什么传入的是「页面表达式」而不是回调
 *
 * 切维度（改属性 / 换样式表）和读数都在页面里，把两者编进**同一条 eval**
 * 能把每格的 spawn 从 2 次降到 1 次。若让调用方传回调，回调里必然先
 * `applyCell` 再 `evalScript`，两次子进程就回来了。
 *
 * 因此这里**只在跨前端时**调 `applyCell`（那一步是导航，无法合并）；
 * 同前端的维度切换已经包含在 `source` 里，再调一次 `applyCell` 就是
 * 把同一件事做两遍，每格白花一个 ~0.8s 的子进程。
 *
 * `source` 必须是**表达式**（`(fn)(args)` 形状），因为它会被 `return (...)`。
 * `decode` 把页面返回值收窄成 T；形状不对就抛，不猜。
 *
 * ## 两次「不必做」的判断
 *
 * 1. 跨前端时若 `source` 之外还有别的维度需求，导航本身已带上目标维度
 *    （`launch` 的 options），所以不需要额外再切一次。
 * 2. 最后一格恰好等于起点就跳过恢复。
 *
 * ## 恢复
 *
 * `--at` 是**纯命令**：执行完不能把页面留在最后一格，否则下一条不带 `--at`
 * 的 `read` 读到的就不是用户以为的状态。进入前读不到格（页面没就绪）就不猜，
 * 交给 `requireSession` 报错。
 */
export async function withCells<T>(
  cells: readonly Cell[],
  url: string | null,
  source: (cell: Cell) => string,
  decode: (raw: unknown) => T
): Promise<CellReading<T>[]> {
  const before = currentCell();
  let frontendNow: Frontend | null = before?.frontend ?? null;
  let current: Cell | null = before;
  const readings: CellReading<T>[] = [];
  try {
    for (const cell of cells) {
      // 跨前端必须导航：设备模拟与 touch 在文档创建时固化，改属性切不过来。
      // 导航时把该格的维度一并带上，省掉随后的切换。
      if (frontendNow !== cell.frontend) {
        await applyCell(cell, url, frontendNow);
        frontendNow = cell.frontend;
      }
      // 同前端：`source` 自己会切维度再读数，一次 eval 完成。
      readings.push({ at: cellLabel(cell), value: decode(evalScript(source(cell))) });
      current = cell;
    }
  } finally {
    if (before && !sameCell(current, before)) {
      try {
        await applyCell(before, url, frontendNow);
      } catch {
        // 恢复失败不能掩盖原始错误；页面状态偏差由下一条命令的读数暴露。
      }
    }
  }
  return readings;
}

/** 一列：`label` 给人看，`path` 用来取值（点路径，数组下标用数字段）。 */
export interface MatrixColumn {
  label: string;
  path: string;
}

/**
 * 多格读数 → 表。
 *
 * 列只写一次、行是纯值数组：6 格 × 5 列约 400 B，而 6 份带键的对象要 2 KB
 * 以上。所有格都相同的列默认折叠进 `same`（`--full` 展开），因为「6 格都
 * 一样」本身就是要看的结论，重复 6 遍不增加信息。
 *
 * `label` 与 `path` 分开：`0.tokens` 这样的列名是人读的标签，但行数据里
 * 的键是 `0`，用标签当路径会永远取到 null（这正是第一版的 bug）。
 */
export function renderMatrix(
  columns: readonly MatrixColumn[],
  readings: readonly CellReading<unknown>[],
  full = false
): Record<string, unknown> {
  const rows = readings.map((reading) => columns.map((column) => readPath(reading.value, column.path)));
  const same: Record<string, unknown> = {};
  const keptLabels: string[] = [];
  const keptIndexes: number[] = [];
  columns.forEach((column, index) => {
    const values = rows.map((row) => row[index]);
    const first = values[0];
    const allEqual = values.every((value) => JSON.stringify(value) === JSON.stringify(first));
    if (!full && allEqual) same[column.label] = first ?? null;
    else {
      keptLabels.push(column.label);
      keptIndexes.push(index);
    }
  });
  const table: Record<string, unknown> = {
    cells: readings.map((reading) => reading.at),
    columns: keptLabels,
    rows: rows.map((row) => keptIndexes.map((index) => row[index] ?? null)),
  };
  if (!full && Object.keys(same).length) table.same = same;
  return table;
}

/** 按点路径取值；中间层缺失给 null（不猜、不抛）。数组下标用数字段。 */
function readPath(value: unknown, path: string): unknown {
  let current: unknown = value;
  for (const key of path.split('.')) {
    if (Array.isArray(current)) {
      const index = Number(key);
      if (!Number.isInteger(index) || index < 0) return null;
      current = current[index];
      continue;
    }
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return current ?? null;
}

/**
 * 把 `axes` 声明的各轴展开成格；某轴缺省即「取全部」。
 *
 * 与 `parseAt` 的区别是输入形状：`--at` 是人手写的紧凑字符串，`axes` 是
 * 计划文件里的结构化字段。两者共用 `CELLS` / `cellExists`，所以合法域只有
 * 一份定义，不会出现「命令行能测、计划文件测不了」的格子。
 */
export function expandAxes(axes: {
  frontend?: readonly Frontend[] | undefined;
  theme?: readonly ThemeMode[] | undefined;
  density?: readonly Density[] | undefined;
}): CellSpec {
  const frontends = axes.frontend?.length ? axes.frontend : FRONTENDS;
  const themes = axes.theme?.length ? axes.theme : THEMES;
  const densities = axes.density?.length ? axes.density : DENSITIES;
  const cells: Cell[] = [];
  const skipped: string[] = [];
  for (const frontend of frontends) {
    for (const theme of themes) {
      for (const density of densities) {
        if (!cellExists(frontend, density)) {
          skipped.push(`${frontend}/${theme}/${density}：上游移动端没有紧凑模式`);
          continue;
        }
        cells.push({ frontend, theme, density });
      }
    }
  }
  if (!cells.length) {
    throw new UserError(`axes 没有展开出任何格：${skipped.join('；') || '轴向组合为空'}`);
  }
  return { cells, skipped };
}
