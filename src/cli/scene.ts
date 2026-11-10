/**
 * 场景（Scene）：`frontend / theme / density` 三元组，加任意 `<html>` 属性。
 *
 * 这是工具里**唯一**的“测什么模式”定义。`--at`、计划文件的 `at`/`axes`、
 * 截图文件名、矩阵行标签全部从这里来，不再有第二套格模型。
 *
 * ## 为什么是一条三层路径 + 属性袋
 *
 * 前三个维度是思源自带的：前端决定 URL 与设备参数，明暗与密度各对应一个
 * `<html>` 属性。主题自己的变体（`data-rc-style`、`data-rc-palette`、功能开关）
 * 也是 `<html>` 属性，所以统一收进 `attrs`——加一条轴只改配置，不改代码。
 *
 * ## 合法域只有一份
 *
 * 上游 `isCompactModeAvailable` 只允许桌面系，移动端永远没有紧凑模式。
 * 这个判断只写在 `sceneExists` 一处，`parseAt` / `expandAxes` / 截图展开
 * 全部复用它。
 */
import { UserError } from './errors.ts';
import type { Frontend } from './url.ts';

/** 明暗主题的合法值（对应 `data-theme-mode`）。 */
export type ThemeMode = 'light' | 'dark';

/** 密度的合法值；`default` 表示「没有 data-ui-density 属性」。 */
export type Density = 'default' | 'compact';

/** 一个完整的测量场景。 */
export interface Scene {
  frontend: Frontend;
  theme: ThemeMode;
  density: Density;
  /** 附加的 `<html>` 属性（主题自己的变体轴）。 */
  attrs: Record<string, string>;
}

/** 维度选项名。 */
export type DimensionFlag = '--theme' | '--density';

/** 每个维度对应的 `<html>` 属性与合法取值。 */
export const DIMENSIONS = {
  '--theme': { attribute: 'data-theme-mode', values: ['dark', 'light'] },
  '--density': { attribute: 'data-ui-density', values: ['default', 'compact'] },
} as const;

const FRONTENDS: readonly Frontend[] = ['desktop', 'mobile'];
const THEMES: readonly ThemeMode[] = ['light', 'dark'];
const DENSITIES: readonly Density[] = ['default', 'compact'];

/** 是否是合法的明暗值。 */
export function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark';
}

/** 是否是合法的密度值。 */
export function isDensity(value: unknown): value is Density {
  return value === 'default' || value === 'compact';
}

/** 校验单个维度；未传返回 null（表示「不改变当前状态」）。 */
export function parseDimension<F extends DimensionFlag>(
  flag: F,
  raw: string | undefined
): F extends '--theme' ? ThemeMode | null : Density | null {
  if (raw === undefined) return null as never;
  if (flag === '--density' && raw === 'comfortable') {
    throw new UserError('--density 不接受 comfortable：上游的普通态是「没有 data-ui-density 属性」，请用 default');
  }
  const { values } = DIMENSIONS[flag];
  if (!(values as readonly string[]).includes(raw)) {
    throw new UserError(`${flag} 取值不合法：${raw}（可用：${values.join(' / ')}）`);
  }
  return raw as never;
}

/** 移动端没有紧凑模式，这是上游限制，不是本工具的取舍。 */
export function sceneExists(frontend: Frontend, density: Density): boolean {
  return !(frontend === 'mobile' && density === 'compact');
}

/** 全部合法场景：frontend 外层，theme × density 内层（与执行顺序一致）。 */
export const SCENES: readonly Scene[] = FRONTENDS.flatMap((frontend) =>
  THEMES.flatMap((theme) =>
    DENSITIES.filter((density) => sceneExists(frontend, density)).map((density) => ({ frontend, theme, density, attrs: {} }))
  )
);

/** 被排除的组合及原因。 */
export function skippedScenes(): string[] {
  return ['mobile/*/compact：上游移动端没有紧凑模式'];
}

/** 场景的标准写法；矩阵的 `at` 与截图文件名都用它。 */
export function sceneLabel(scene: Scene): string {
  const base = `${scene.frontend}/${scene.theme}/${scene.density}`;
  const attrs = Object.entries(scene.attrs)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${name}=${value}`)
    .join(';');
  return attrs ? `${base};${attrs}` : base;
}

/** 截图文件名（不含目录）。属性里的非法字符替换成 `-`。 */
export function sceneFile(scene: Scene): string {
  const base = `${scene.frontend}-${scene.theme}-${scene.density}`;
  const attrs = Object.entries(scene.attrs)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${name.replace(/^data-/, '')}=${value}`)
    .join(';')
    .replace(/[^a-zA-Z0-9=;._-]/g, '-');
  return attrs ? `${base}-${attrs}.png` : `${base}.png`;
}

/** 解析结果：展开出的场景，以及解释用的跳过原因。 */
export interface SceneSpec {
  scenes: Scene[];
  skipped: string[];
}

/**
 * 解析 `--at` 的取值。
 *
 *   `desktop/dark/default`  一格
 *   `desktop/dark`          该前端的两个密度
 *   `desktop`               该前端全部 4 格
 *   `all`                   全部 6 格
 *   `desktop/dark/default/data-rc-style=fluent`  带附加属性的一格
 *
 * 也接受逗号列表，各段分别展开后去重（顺序保持输入顺序）。
 */
export function parseAt(raw: string): SceneSpec {
  const text = raw.trim();
  if (!text) throw new UserError('--at 不能为空；用 all 或 前端/明暗/密度，如 desktop/dark/default');

  const scenes: Scene[] = [];
  const skipped: string[] = [];
  const seen = new Set<string>();

  const push = (scene: Scene): void => {
    const label = sceneLabel(scene);
    if (seen.has(label)) return;
    seen.add(label);
    scenes.push(scene);
  };

  for (const part of text.split(',')) {
    const segment = part.trim();
    if (!segment) throw new UserError('--at 里有空的段；用逗号分隔的场景，如 desktop/dark,desktop/light');
    const pieces = segment.split('/');
    const isAll = pieces[0] === 'all';
    const core = isAll ? ['all'] : pieces.slice(0, 3);
    const attrParts = isAll ? pieces.slice(1) : pieces.slice(3);
    if (!isAll && pieces.length > 3 && attrParts.some((piece) => !piece.includes('='))) {
      throw new UserError(`--at 段数太多：${segment}（最多 前端/明暗/密度，之后是 键=值）`);
    }

    // 附加属性：`key=value` 段，可多个。
    const attrs: Record<string, string> = {};
    for (const piece of attrParts) {
      const index = piece.indexOf('=');
      if (index <= 0) throw new UserError(`--at 里的附加属性必须写成 名字=值：${piece}`);
      attrs[piece.slice(0, index)] = piece.slice(index + 1);
    }

    if (isAll) {
      for (const scene of SCENES) push({ ...scene, attrs: { ...attrs } });
      skipped.push(...skippedScenes());
      continue;
    }

    const [frontendRaw, themeRaw, densityRaw] = core as [string, string | undefined, string | undefined];
    const frontend = parseFrontendPart(frontendRaw, segment);
    const themes: ThemeMode[] = themeRaw === undefined ? [...THEMES] : [parseThemePart(themeRaw, segment)];
    const densities: Density[] = densityRaw === undefined ? [...DENSITIES] : [parseDensityPart(densityRaw, segment)];
    for (const theme of themes) {
      for (const density of densities) {
        if (!sceneExists(frontend, density)) {
          skipped.push(`${frontend}/${theme}/${density}：上游移动端没有紧凑模式`);
          continue;
        }
        push({ frontend, theme, density, attrs: { ...attrs } });
      }
    }
  }

  if (!scenes.length) {
    throw new UserError(`--at 没有展开出任何场景：${skipped.join('；') || raw}`);
  }
  return { scenes, skipped };
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
    throw new UserError(`--at 不接受 comfortable：上游的普通态是「没有 data-ui-density 属性」，请用 default（${whole}）`);
  }
  throw new UserError(`--at 里的密度不合法：${whole}（可用：default / compact）`);
}

/** 结构化轴（计划文件用），与 `--at` 共用同一套合法域。 */
export interface SceneAxes {
  frontend?: readonly Frontend[] | undefined;
  theme?: readonly ThemeMode[] | undefined;
  density?: readonly Density[] | undefined;
  attrs?: Readonly<Record<string, readonly string[]>> | undefined;
}

/** 把 `axes` 展开成场景；某轴缺省即「取全部」。 */
export function expandAxes(axes: SceneAxes): SceneSpec {
  const frontends = axes.frontend?.length ? axes.frontend : FRONTENDS;
  const themes = axes.theme?.length ? axes.theme : THEMES;
  const densities = axes.density?.length ? axes.density : DENSITIES;
  const attrEntries = Object.entries(axes.attrs ?? {});

  const scenes: Scene[] = [];
  const skipped: string[] = [];

  /** 递归展开附加属性（笛卡尔积）。 */
  const withAttrs = (base: Omit<Scene, 'attrs'>, index: number, attrs: Record<string, string>): void => {
    if (index >= attrEntries.length) {
      scenes.push({ ...base, attrs: { ...attrs } });
      return;
    }
    const [name, values] = attrEntries[index]!;
    for (const value of values) withAttrs(base, index + 1, { ...attrs, [name]: value });
  };

  for (const frontend of frontends) {
    for (const theme of themes) {
      for (const density of densities) {
        if (!sceneExists(frontend, density)) {
          skipped.push(`${frontend}/${theme}/${density}：上游移动端没有紧凑模式`);
          continue;
        }
        withAttrs({ frontend, theme, density }, 0, {});
      }
    }
  }
  if (!scenes.length) {
    throw new UserError(`axes 没有展开出任何场景：${skipped.join('；') || '轴向组合为空'}`);
  }
  return { scenes, skipped };
}
