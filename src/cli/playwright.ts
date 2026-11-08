/**
 * `playwright-core cli` 会话封装。
 *
 * 它本身是 daemon：所有命令发给同一个常驻浏览器进程，页面状态自然延续。
 * 本模块只负责找到 cli 入口、执行命令、把结果交回调用方。
 *
 * ## 为什么用 `--json` 而不是自己解析 stdout
 *
 * cli 自带 `--json`，输出是 `{ "result": "<字符串化的值>" }`（出错时
 * `{ "isError": true, "error": "..." }`）。直接读这个信封，比「从 stdout 里
 * 从后往前猜哪一行是 JSON」可靠得多——多行 JSON、格式调整都不会破坏它。
 *
 * 注意 `result` 是**字符串**，值本身还要再 `JSON.parse` 一次。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UserError } from './support.ts';

/** 找到 playwright-core 自带的 cli.js。 */
function cliPath(): string {
  const require = createRequire(import.meta.url);
  const candidates = [
    // 从本包位置解析
    () => require.resolve('playwright-core/cli.js'),
    // 从运行 CLI 的项目位置解析
    () => createRequire(join(process.cwd(), 'package.json')).resolve('playwright-core/cli.js'),
    // 直接从本包目录下找
    () => join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'node_modules', 'playwright-core', 'cli.js'),
  ];
  for (const resolve of candidates) {
    try {
      const path = resolve();
      if (existsSync(path)) return path;
    } catch {
      // 换下一个
    }
  }
  throw new UserError('找不到 playwright-core；请安装：pnpm add -D siyuan-devtools');
}

/** 一条命令的结果。 */
interface CliResult {
  /** 完整 stdout（已 trim）。 */
  out: string;
  err: string;
}

/** 执行一条 playwright-core cli 命令（不加额外输出开关）。 */
export function runCli(args: string[]): CliResult {
  const result = spawnSync(process.execPath, [cliPath(), 'cli', ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  const out = (result.stdout ?? '').trim();
  const err = (result.stderr ?? '').trim();
  if (result.error) throw new UserError(`执行 playwright-cli 失败：${result.error.message}`);
  if (result.status !== 0) throw new UserError(err || out || `playwright-cli 退出码 ${String(result.status)}`);
  return { out, err };
}

/** `--json` 信封。 */
interface JsonEnvelope {
  result?: string;
  isError?: boolean;
  error?: string;
}

/**
 * 执行一条需要结构化结果的命令。
 *
 * 用 `--json` 拿信封，再把 `result` 字符串解析成值。
 * 值为空（页面返回 undefined）时 `result` 缺失，这里返回 null。
 */
function runJson(args: string[]): unknown {
  const { out } = runCli(['--json', ...args]);
  let envelope: JsonEnvelope;
  try {
    envelope = JSON.parse(out) as JsonEnvelope;
  } catch {
    throw new UserError(`playwright-cli 返回了非 JSON 输出：${out.slice(0, 200)}`);
  }
  if (envelope.isError) throw new UserError(envelope.error ?? '页面执行出错');
  if (envelope.result === undefined) return null;
  try {
    return JSON.parse(envelope.result);
  } catch {
    // result 不是 JSON 时按原文字符串返回（例如 `eval "1 + 2"`）。
    return envelope.result;
  }
}

/** 执行一段页面 JS（eval 片段），返回解析后的值。 */
export function evalScript(source: string): unknown {
  return runJson(['eval', source]);
}

/** 执行一个需要 `page` 对象的脚本（run-code），返回解析后的值。 */
export function runCode(source: string): unknown {
  const dir = mkdtempSync(join(tmpdir(), 'siyuan-devtools-'));
  const file = join(dir, 'script.js');
  try {
    writeFileSync(file, source, 'utf8');
    return runJson(['run-code', `--filename=${file}`]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** 会话是否存在（不创建、无副作用）。 */
export function sessionExists(): boolean {
  const result = runCli(['list']);
  return /status:\s*open/.test(result.out);
}
