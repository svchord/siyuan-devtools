/**
 * 会话状态持久化。
 *
 * `open --url http://host:8899/` 之后不带 `--url` 再跑 reload/audit/shot，
 * 旧实现会按 SIYUAN_PORT || 6806 重新拼 URL，把页面静默导航到另一个实例。
 *
 * 明暗与密度也要记：导航会把它们重置回思源配置（实测 dark → reload → light），
 * 「设暗色 → 改 CSS → reload → 测量」若不重放就会静默测成亮色。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { clearState, readState, statePath, writeState } from '../src/cli/session-state.ts';

const dirs: string[] = [];

/** 建一个临时目录当 workspace。 */
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sydt-state-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('会话状态', () => {
  it('写入后能读回（含明暗与密度）', () => {
    const dir = tempDir();
    writeState(
      {
        url: 'http://127.0.0.1:8899/stage/build/desktop/',
        frontend: 'desktop',
        device: null,
        viewport: null,
        theme: 'dark',
        density: 'compact',
      },
      dir
    );
    expect(readState(dir)).toEqual({
      url: 'http://127.0.0.1:8899/stage/build/desktop/',
      frontend: 'desktop',
      device: null,
      viewport: null,
      theme: 'dark',
      density: 'compact',
    });
  });

  it('写在 .playwright/siyuan-devtools.json（已被 .gitignore 覆盖）', () => {
    const dir = tempDir();
    writeState({ url: 'http://x/', frontend: 'mobile', device: 'iPhone 13', viewport: null }, dir);
    expect(statePath(dir)).toBe(join(dir, '.playwright', 'siyuan-devtools.json'));
    expect(readState(dir)?.device).toBe('iPhone 13');
  });

  it('没有状态文件时返回 null', () => {
    expect(readState(tempDir())).toBeNull();
  });

  it('坏 JSON / 形状不对时返回 null，而不是抛错', () => {
    const dir = tempDir();
    writeState({ url: 'http://x/', frontend: 'desktop', device: null, viewport: null }, dir);
    writeFileSync(statePath(dir), '{ not json', 'utf8');
    expect(readState(dir)).toBeNull();
    for (const bad of [
      { url: '', frontend: 'desktop', device: null, viewport: null },
      { url: 'http://x/', frontend: 'tablet', device: null },
      { url: 'http://x/', frontend: 'desktop', device: 7 },
      [],
    ]) {
      writeFileSync(statePath(dir), JSON.stringify(bad), 'utf8');
      expect(readState(dir), JSON.stringify(bad)).toBeNull();
    }
  });

  it('旧文件缺 theme/density 时按「不指定」读，不判整体损坏', () => {
    const dir = tempDir();
    // 先借 writeState 建出 `.playwright`，再覆盖成旧版本的形状。
    writeState({ url: 'http://x/', frontend: 'desktop', device: null, viewport: null }, dir);
    // 升级前落盘的文件：没有这两个字段。若判成损坏，reload 会退回按端口拼
    // URL，反而把页面导航到别的实例——正是这个模块要防的问题。
    writeFileSync(
      statePath(dir),
      JSON.stringify({ url: 'http://x/', frontend: 'desktop', device: null, viewport: null }),
      'utf8'
    );
    expect(readState(dir)).toEqual({
      url: 'http://x/',
      frontend: 'desktop',
      device: null,
      viewport: null,
      theme: null,
      density: null,
    });
  });

  it('theme/density 非法值折成 null，其它字段仍然可用', () => {
    const dir = tempDir();
    writeState({ url: 'http://x/', frontend: 'mobile', device: null, viewport: null }, dir);
    for (const bad of [
      // 两个都不合法
      { theme: 'comfortable', density: 'comfortable', expectedTheme: null, expectedDensity: null },
      // 只有密度不合法，明暗要照常读出
      { theme: 'dark', density: 'loose', expectedTheme: 'dark', expectedDensity: null },
      // 类型都不对
      { theme: 7, density: [], expectedTheme: null, expectedDensity: null },
    ]) {
      writeFileSync(
        statePath(dir),
        JSON.stringify({
          url: 'http://x/',
          frontend: 'mobile',
          device: null,
          viewport: null,
          theme: bad.theme,
          density: bad.density,
        }),
        'utf8'
      );
      const state = readState(dir);
      expect(state?.url, JSON.stringify(bad)).toBe('http://x/');
      expect(state?.frontend, JSON.stringify(bad)).toBe('mobile');
      expect(state?.theme, JSON.stringify(bad)).toBe(bad.expectedTheme);
      expect(state?.density, JSON.stringify(bad)).toBe(bad.expectedDensity);
    }
  });

  it('clear 之后读不到', () => {
    const dir = tempDir();
    writeState({ url: 'http://x/', frontend: 'desktop', device: null, viewport: null }, dir);
    clearState(dir);
    expect(readState(dir)).toBeNull();
  });
});
