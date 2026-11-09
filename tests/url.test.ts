/** 前端 URL 与端口校验。 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeState } from '../src/cli/session-state.ts';
import { frontendUrl, parseFrontend, parsePort, resolveFrontendUrl, rewriteFrontend } from '../src/cli/url.ts';

const ORIGINAL_PORT = process.env.SIYUAN_PORT;
const ORIGINAL_CWD = process.cwd();
const dirs: string[] = [];

/** 建临时 workspace 并切进去（会话状态按 cwd 隔离）。 */
function useTempWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sydt-url-'));
  dirs.push(dir);
  process.chdir(dir);
  return dir;
}

beforeEach(() => {
  useTempWorkspace();
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (ORIGINAL_PORT === undefined) delete process.env.SIYUAN_PORT;
  else process.env.SIYUAN_PORT = ORIGINAL_PORT;
});

describe('frontendUrl', () => {
  it('--url 优先于一切', () => {
    process.env.SIYUAN_PORT = '1234';
    expect(frontendUrl('desktop', 'http://example.test/')).toBe('http://example.test/');
  });

  it('缺省按 SIYUAN_PORT 拼', () => {
    process.env.SIYUAN_PORT = '8899';
    expect(frontendUrl('mobile')).toBe('http://127.0.0.1:8899/stage/build/mobile/');
  });

  it('没有 SIYUAN_PORT 时用 6806', () => {
    delete process.env.SIYUAN_PORT;
    expect(frontendUrl('desktop')).toBe('http://127.0.0.1:6806/stage/build/desktop/');
  });

  it('SIYUAN_PORT 非法时立刻报错，而不是拼出非法 URL', () => {
    for (const port of ['abc', '70000', '0', '-1']) {
      process.env.SIYUAN_PORT = port;
      expect(() => frontendUrl('desktop'), port).toThrow('SIYUAN_PORT');
    }
  });
});

describe('parsePort', () => {
  it('缺省 6806', () => {
    expect(parsePort(undefined)).toBe('6806');
    expect(parsePort('   ')).toBe('6806');
  });

  it('接受合法端口并去掉空白', () => {
    expect(parsePort(' 8899 ')).toBe('8899');
  });
});

describe('rewriteFrontend', () => {
  it('只替换前端段，保留实例与反代前缀', () => {
    expect(rewriteFrontend('http://127.0.0.1:8899/stage/build/desktop/', 'mobile')).toBe(
      'http://127.0.0.1:8899/stage/build/mobile/'
    );
    expect(rewriteFrontend('https://notes.test/siyuan/stage/build/desktop/', 'mobile')).toBe(
      'https://notes.test/siyuan/stage/build/mobile/'
    );
  });

  it('不带尾部斜杠也能替换', () => {
    expect(rewriteFrontend('http://127.0.0.1:8899/stage/build/desktop', 'mobile')).toBe(
      'http://127.0.0.1:8899/stage/build/mobile/'
    );
  });

  it('裸 origin 当基址，追加标准入口', () => {
    expect(rewriteFrontend('http://127.0.0.1:8899/', 'mobile')).toBe('http://127.0.0.1:8899/stage/build/mobile/');
    expect(rewriteFrontend('http://127.0.0.1:8899', 'desktop')).toBe('http://127.0.0.1:8899/stage/build/desktop/');
  });

  it('普通页面也当基址（不丢实例）', () => {
    expect(rewriteFrontend('http://127.0.0.1:8899/some/page.html', 'mobile')).toBe(
      'http://127.0.0.1:8899/some/page.html/stage/build/mobile/'
    );
  });
});

describe('resolveFrontendUrl', () => {
  it('显式 --url 优先', () => {
    writeState({ url: 'http://127.0.0.1:8899/stage/build/desktop/', frontend: 'desktop', device: null, viewport: null });
    expect(resolveFrontendUrl('desktop', 'http://explicit/')).toBe('http://explicit/');
  });

  it('没有会话状态时按端口拼', () => {
    process.env.SIYUAN_PORT = '7777';
    expect(resolveFrontendUrl('desktop')).toBe('http://127.0.0.1:7777/stage/build/desktop/');
  });

  it('沿用 open 时的 URL（这正是旧实现丢掉的）', () => {
    writeState({ url: 'http://127.0.0.1:8899/stage/build/desktop/', frontend: 'desktop', device: null, viewport: null });
    expect(resolveFrontendUrl('desktop')).toBe('http://127.0.0.1:8899/stage/build/desktop/');
  });

  it('前端变了只换路径段，不换实例', () => {
    writeState({ url: 'http://127.0.0.1:8899/stage/build/desktop/', frontend: 'desktop', device: null, viewport: null });
    expect(resolveFrontendUrl('mobile')).toBe('http://127.0.0.1:8899/stage/build/mobile/');
  });
});

describe('parseFrontend', () => {
  it('缺省 desktop', () => {
    expect(parseFrontend(undefined)).toBe('desktop');
  });

  it('只接受 desktop / mobile', () => {
    expect(parseFrontend('mobile')).toBe('mobile');
    expect(() => parseFrontend('tablet')).toThrow('未知前端');
  });
});
