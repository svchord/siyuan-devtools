/**
 * 会话状态持久化。
 *
 * `open --url http://host:8899/` 之后不带 `--url` 再跑 reload/audit/shot，
 * 旧实现会按 SIYUAN_PORT || 6806 重新拼 URL，把页面静默导航到另一个实例。
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
  it('写入后能读回', () => {
    const dir = tempDir();
    writeState({ url: 'http://127.0.0.1:8899/stage/build/desktop/', frontend: 'desktop', device: null, viewport: null }, dir);
    expect(readState(dir)).toEqual({
      url: 'http://127.0.0.1:8899/stage/build/desktop/',
      frontend: 'desktop',
      device: null,
      viewport: null,
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

  it('clear 之后读不到', () => {
    const dir = tempDir();
    writeState({ url: 'http://x/', frontend: 'desktop', device: null, viewport: null }, dir);
    clearState(dir);
    expect(readState(dir)).toBeNull();
  });
});
