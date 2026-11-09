/**
 * 测量维度：明暗与密度，以及它们展开成的截图格子。
 *
 * ## 为什么单独一个文件
 *
 * 这两个维度原先只定义在 shot.ts 里。可 `open` / `reload` 也要用同一套取值
 * 校验（会话状态要记住明暗与密度，reload 之后重放），若从 shot.ts import 就会
 * 把截图、CDP、浏览器相关的一整串模块拉进会话命令。抽到这里以后：取值规则
 * 只有一份，`shot` 只管出图，`session` 只管会话。
 *
 * ## 为什么 density 没有 `comfortable`
 *
 * 上游（思源 3.8.8+）的 `data-ui-density` 只有一个合法值 `compact`，普通态是
 * **没有这个属性**（`removeAttribute`），不是 `comfortable`。旧实现把
 * `comfortable` 当合法值写进属性，实测与「删掉属性」逐项完全一致——它不命中
 * 任何规则，是空操作，但 `read env` 会把 `uiDensity` 原样回显成
 * `"comfortable"`，报告一个产品永远到不了的状态。所以这里显式拒绝它，并告诉
 * 调用方改用 `default`。
 *
 * ## 为什么移动端没有紧凑模式
 *
 * 上游的 `isCompactModeAvailable` 只允许 desktop / desktop-window /
 * browser-desktop。移动端即使写了属性也不生效，产出 mobile/compact 格子等于
 * 给 agent 一张「看起来合理、实际不存在」的图。所以 `planCells` 显式跳过并
 * 给出原因，而不是静默少出一张。
 */
import { UserError } from './errors.ts';
import type { Frontend } from './url.ts';

/** 明暗主题的合法值（对应 `data-theme-mode`）。 */
export type ThemeMode = 'light' | 'dark';

/** 密度的合法值；`default` 表示「没有 data-ui-density 属性」。 */
export type Density = 'default' | 'compact';

/** 维度选项名。 */
export type DimensionFlag = '--theme' | '--density';

/** 每个维度对应的 `<html>` 属性与合法取值。 */
export const DIMENSIONS = {
  '--theme': { attribute: 'data-theme-mode', values: ['dark', 'light'] },
  '--density': { attribute: 'data-ui-density', values: ['default', 'compact'] },
} as const;

/** 选项名 → 取值类型（让 parseDimension 的返回类型跟着 flag 走）。 */
interface DimensionValue {
  '--theme': ThemeMode;
  '--density': Density;
}

/** 是否是合法的明暗值。 */
export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark';
}

/** 是否是合法的密度值。 */
export function isDensity(value: unknown): value is Density {
  return value === 'default' || value === 'compact';
}

/**
 * 校验单个维度的取值；未传返回 null（表示「不改变当前状态」）。
 *
 * 返回 null 与返回 `'default'` 是两种语义，不能混：前者是「这次不动密度」，
 * 后者是「明确要求回到普通态（删掉属性）」。
 */
export function parseDimension<F extends DimensionFlag>(
  flag: F,
  raw: string | undefined
): DimensionValue[F] | null {
  if (raw === undefined) return null;
  if (flag === '--density' && raw === 'comfortable') {
    throw new UserError(
      '--density 不接受 comfortable：上游的普通态是「没有 data-ui-density 属性」，请用 default'
    );
  }
  const { values } = DIMENSIONS[flag];
  if (!(values as readonly string[]).includes(raw)) {
    throw new UserError(`${flag} 取值不合法：${raw}（可用：${values.join(' / ')}）`);
  }
  return raw as DimensionValue[F];
}

/**
 * 解析逗号分隔的多值（`--theme light,dark`），也接受单值。
 *
 * 每个值都过一遍 `parseDimension`，所以报错与单值完全一致；重复值去重，
 * 否则同一个文件名会被截两次、后一次覆盖前一次。
 */
export function parseDimensionList<F extends DimensionFlag>(
  flag: F,
  raw: string | undefined
): DimensionValue[F][] | null {
  if (raw === undefined) return null;
  const values: DimensionValue[F][] = [];
  for (const part of raw.split(',')) {
    const value = parseDimension(flag, part.trim());
    if (value === null) continue;
    if (!values.includes(value)) values.push(value);
  }
  return values;
}

/** 一个要截的格子。 */
export interface ShotCell {
  frontend: Frontend;
  /** 该格子用的明暗；null 表示不改当前值。 */
  theme: ThemeMode | null;
  /** 该格子用的密度；null 表示不改当前值。 */
  density: Density | null;
  /** 输出文件名（不含目录）。 */
  file: string;
}

/** 被跳过的格子：上游不存在这个组合。 */
export interface SkippedCell {
  frontend: Frontend;
  theme: ThemeMode | null;
  density: Density | null;
  /** 给用户看的一句话，直接走 stderr。 */
  message: string;
}

/** 文件名：维度为空就不出现在名字里（`desktop.png` / `desktop-dark-compact.png`）。 */
function cellFile(frontend: Frontend, theme: ThemeMode | null, density: Density | null): string {
  const suffix = [theme, density].filter(Boolean).join('-');
  return `${frontend}${suffix ? `-${suffix}` : ''}.png`;
}

/**
 * 把三个轴展开成格子：frontend 外层，theme × density 内层。
 *
 * 顺序不是随意的：每次 `captureScript` 都会导航一次（2–5s，且清掉 hover、
 * 菜单、滚动），而切 theme/density 只是改属性（各 ~100–200ms）。按前端分组，
 * 同一个前端的格子连续执行，调用方（以及将来可能的「一次导航跑多格」优化）
 * 才能复用同一页。
 *
 * mobile × compact 不存在，进 skipped 而不是 cells——宁可少一张图并说明原因，
 * 也不要给 agent 一张上游根本不存在的组合。
 */
export function planCells(axes: {
  frontends: readonly Frontend[];
  themes: readonly (ThemeMode | null)[];
  densities: readonly (Density | null)[];
}): { cells: ShotCell[]; skipped: SkippedCell[] } {
  const cells: ShotCell[] = [];
  const skipped: SkippedCell[] = [];
  for (const frontend of axes.frontends) {
    for (const theme of axes.themes) {
      for (const density of axes.densities) {
        if (frontend === 'mobile' && density === 'compact') {
          skipped.push({
            frontend,
            theme,
            density,
            message: '跳过 mobile/compact：上游移动端没有紧凑模式',
          });
          continue;
        }
        cells.push({ frontend, theme, density, file: cellFile(frontend, theme, density) });
      }
    }
  }
  return { cells, skipped };
}
