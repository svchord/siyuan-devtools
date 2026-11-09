/**
 * 会话状态：open 时记住入口 URL 与测量维度，后续命令沿用。
 *
 * 为什么需要它：`open --url http://host:8899/...` 之后如果不带 `--url` 再跑
 * `reload` / `audit` / `shot`，旧实现会按 `SIYUAN_PORT || 6806` 重新拼 URL，
 * 把页面静默导航到另一个实例（且退出码 0）。用户以为会话记得 URL，实际没有。
 *
 * 明暗与密度也记在这里，因为**导航会重置它们**：`reload` 之后
 * `data-theme-mode` 回到配置里的值（实测 dark → reload → light）。
 * 「设暗色 → 改 CSS → reload → 测量」如果不在 reload 后重放，就会静默测成
 * 亮色，且退出码 0。重放需要知道「打开时想要的是什么」，所以必须落盘。
 *
 * ## 位置跟随 Playwright workspace
 *
 * 状态文件写在 **Playwright 认定的 workspace 根**下的 `.playwright/` 里，
 * 而不是固定的 `process.cwd()`。否则在项目的子目录里跑一次 `open`，
 * 会在子目录新建 `.playwright/`、把 workspace 变成子目录，而下一条命令
 * 解析到的会话却注册在父目录——表现为「刚打开就说未启动」。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isDensity, isThemeMode } from './dimensions.ts';
import type { Density, ThemeMode } from './dimensions.ts';
import { workspaceRoot } from './playwright.ts';
import type { Frontend } from './url.ts';
import { isRecord } from './util.ts';

/** 磁盘上的会话状态。 */
export interface SessionState {
  /** 打开时的完整前端 URL（`--url` 原样，或按端口拼出的标准入口）。 */
  url: string;
  /** 当前打开的前端。 */
  frontend: Frontend;
  /** 打开时用的设备名；未指定则为 null。 */
  device: string | null;
  /** 打开时显式指定的视口；未指定则为 null（由设备或前端预设决定）。 */
  viewport: { width: number; height: number } | null;
  /**
   * 期望的明暗；null / 缺省表示不指定（跟随思源配置）。
   *
   * 写成可选而不是必填：`audit` 等命令不关心维度，它们写状态时没必要知道
   * 这两个字段；旧版本落盘的文件里也没有。缺省一律按「不指定」处理。
   */
  theme?: ThemeMode | null;
  /** 期望的密度；null / 缺省表示不指定（即普通态）。 */
  density?: Density | null;
}

/** 状态文件位置；与 Playwright 的 workspace 标记放在一起。 */
export function statePath(root: string = workspaceRoot()): string {
  return join(root, '.playwright', 'siyuan-devtools.json');
}

/**
 * 读维度字段，缺失或非法一律折成 null。
 *
 * 不能因为这两个字段不认识就判定整个文件损坏：旧版本写的状态文件里没有
 * 它们，升级后第一次 `reload` 若报「状态损坏」会退回到按端口拼 URL，
 * 反而把页面导航到别的实例——正是这个模块要防的问题。维度只是附加信息，
 * 读不出来就当「没指定」。
 */
function readDimension<T>(value: unknown, isValid: (item: unknown) => item is T): T | null {
  return isValid(value) ? value : null;
}

/** 读会话状态；不存在或损坏返回 null。 */
export function readState(root: string = workspaceRoot()): SessionState | null {
  try {
    const data: unknown = JSON.parse(readFileSync(statePath(root), 'utf8'));
    if (!isRecord(data)) return null;
    const { url, frontend, device, viewport, theme, density } = data;
    if (typeof url !== 'string' || !url) return null;
    if (frontend !== 'desktop' && frontend !== 'mobile') return null;
    if (device !== null && typeof device !== 'string') return null;
    if (viewport !== null && !isViewport(viewport)) return null;
    return {
      url,
      frontend,
      device,
      viewport,
      theme: readDimension(theme, isThemeMode),
      density: readDimension(density, isDensity),
    };
  } catch {
    return null;
  }
}

/** 是否是合法的视口对象。 */
function isViewport(value: unknown): value is { width: number; height: number } {
  return (
    isRecord(value) &&
    Number.isInteger(value.width) &&
    Number.isInteger(value.height) &&
    (value.width as number) > 0 &&
    (value.height as number) > 0
  );
}

/** 写会话状态；只读目录等场景静默失败（不让命令直接崩）。 */
export function writeState(state: SessionState, root: string = workspaceRoot()): void {
  try {
    mkdirSync(join(root, '.playwright'), { recursive: true });
    writeFileSync(statePath(root), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  } catch {
    // 落盘失败不影响本次命令；后续命令会退回到 --url / SIYUAN_PORT。
  }
}

/** 清会话状态。 */
export function clearState(root: string = workspaceRoot()): void {
  try {
    rmSync(statePath(root), { force: true });
  } catch {
    // 同上。
  }
}
