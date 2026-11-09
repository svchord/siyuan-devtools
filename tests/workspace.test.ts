/**
 * workspace 归属：状态文件必须落在 Playwright 认定的 workspace 里。
 *
 * 旧实现固定写 `process.cwd()/.playwright/`，于是在项目子目录跑一次 `open`
 * 会在子目录新建 `.playwright/`、把 workspace 变成子目录，而下一条命令解析
 * 到的会话却注册在父目录——表现为「刚打开就说未启动」。
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findWorkspace, workspaceRoot } from '../src/cli/playwright.ts';
import { readState, statePath, writeState } from '../src/cli/session-state.ts';

const ORIGINAL_CWD = process.cwd();
const dirs: string[] = [];

/** 建一个临时根目录。 */
function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sydt-ws-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('findWorkspace', () => {
  it('没有 .playwright 时返回 null', () => {
    const root = tempRoot();
    expect(findWorkspace(root)).toBeNull();
  });

  it('在自身目录找到标记', () => {
    const root = tempRoot();
    mkdirSync(join(root, '.playwright'));
    expect(findWorkspace(root)).toBe(root);
  });

  it('向上查找父目录的标记（与 Playwright 一致）', () => {
    const root = tempRoot();
    mkdirSync(join(root, '.playwright'));
    const sub = join(root, 'a', 'b');
    mkdirSync(sub, { recursive: true });
    expect(findWorkspace(sub)).toBe(root);
  });
});

describe('workspaceRoot', () => {
  it('已有 workspace 时返回它，而不是 cwd', () => {
    const root = tempRoot();
    mkdirSync(join(root, '.playwright'));
    const sub = join(root, 'sub');
    mkdirSync(sub, { recursive: true });
    process.chdir(sub);
    expect(workspaceRoot()).toBe(root);
  });

  it('没有 workspace 时返回 cwd', () => {
    const root = tempRoot();
    process.chdir(root);
    expect(workspaceRoot()).toBe(root);
  });
});

describe('会话状态跟随 workspace', () => {
  beforeEach(() => {
    const root = tempRoot();
    mkdirSync(join(root, '.playwright'));
    const sub = join(root, 'sub');
    mkdirSync(sub, { recursive: true });
    process.chdir(sub);
  });

  it('在子目录写状态，落到父目录那个 workspace 里', () => {
    const root = workspaceRoot();
    writeState({ url: 'http://x/', frontend: 'desktop', device: null, viewport: null });
    // 关键：父目录有状态，子目录没有新建
    expect(readState()).not.toBeNull();
    expect(statePath()).toBe(join(root, '.playwright', 'siyuan-devtools.json'));
    expect(findWorkspace()).toBe(root);
  });
});
