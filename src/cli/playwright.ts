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
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { UserError } from './support.ts';

/**
 * 找到 playwright-core 自带的 cli.js。
 *
 * 不能直接 `resolve('playwright-core/cli.js')`：playwright-core 的 `exports`
 * 没有导出 `./cli.js`，会报 ERR_PACKAGE_PATH_NOT_EXPORTED。开发仓库里之所以
 * 看起来能用，是因为包根目录恰好就是 node_modules/playwright-core —— 装成
 * 依赖后那条路径根本不存在。
 *
 * 唯一稳定做法：解析被允许导出的 `playwright-core/package.json`，再从它旁边
 * 取 `cli.js`。这样不管装在 node_modules 还是 pnpm 的 .pnpm 链接里都对。
 */
export function cliPath(): string {
  const candidates = [
    // 从本包位置解析（正常情况：playwright-core 是直接依赖）
    () => createRequire(import.meta.url).resolve('playwright-core/package.json'),
    // 从运行 CLI 的项目位置解析（本包被 npm link 或提升安装时的兜底）
    () => createRequire(join(process.cwd(), 'package.json')).resolve('playwright-core/package.json'),
  ];
  for (const resolve of candidates) {
    try {
      const cli = join(dirname(resolve()), 'cli.js');
      if (existsSync(cli)) return cli;
    } catch {
      // 换下一个
    }
  }
  throw new UserError('找不到 playwright-core；请安装：pnpm add -D siyuan-devtools');
}

/**
 * 给 Playwright CLI 一个工作区标记。
 *
 * Playwright CLI 用 `.playwright` 目录识别 workspace；找不到时会退回到
 * playwright-core 包根目录作为 workspace。结果就是不同项目共用同一个
 * `default` 会话——在 A 项目 open 会杀掉 B 项目的浏览器。这里保证当前
 * 工作目录有标记，避免跨项目串会话。
 */
function ensureWorkspaceMarker(): void {
  try {
    mkdirSync(join(process.cwd(), '.playwright'), { recursive: true });
  } catch {
    // 只读目录等场景不能写标记；此时退回 Playwright 的默认行为，不让命令直接失败。
  }
}

/** 一条命令的原始结果。 */
interface RawCliResult {
  out: string;
  err: string;
  status: number | null;
}

/** 执行一条 playwright-core cli 命令，保留退出码供 JSON 错误信封解析。 */
function runCliRaw(args: string[]): RawCliResult {
  const result = spawnSync(process.execPath, [cliPath(), 'cli', ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  const out = (result.stdout ?? '').trim();
  const err = (result.stderr ?? '').trim();
  if (result.error) throw new UserError(`执行 playwright-cli 失败：${result.error.message}`);
  return { out, err, status: result.status };
}

/** 一条命令的结果。 */
export interface CliResult {
  /** 完整 stdout（已 trim）。 */
  out: string;
  err: string;
}

/** 执行一条 playwright-core cli 命令（不加额外输出开关）。 */
export function runCli(args: string[]): CliResult {
  ensureWorkspaceMarker();
  const result = runCliRaw(args);
  if (result.status !== 0) {
    throw new UserError(result.err || result.out || `playwright-cli 退出码 ${String(result.status)}`);
  }
  return { out: result.out, err: result.err };
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
  ensureWorkspaceMarker();
  const result = runCliRaw(['--json', ...args]);
  let envelope: JsonEnvelope;
  try {
    envelope = JSON.parse(result.out) as JsonEnvelope;
  } catch {
    if (result.status !== 0) {
      throw new UserError(result.err || result.out || `playwright-cli 退出码 ${String(result.status)}`);
    }
    throw new UserError(`playwright-cli 返回了非 JSON 输出：${result.out.slice(0, 200)}`);
  }
  if (envelope.isError) throw new UserError(envelope.error ?? '页面执行出错');
  if (result.status !== 0) {
    throw new UserError(result.err || `playwright-cli 退出码 ${String(result.status)}`);
  }
  if (envelope.result === undefined) return null;
  try {
    return JSON.parse(envelope.result);
  } catch {
    // result 不是 JSON 时按原文字符串返回（例如 `eval "1 + 2"`）。
    return envelope.result;
  }
}

/** 结构化读取当前 workspace 的浏览器会话列表。 */
export function listSessions(): unknown {
  const { out } = runCli(['--json', 'list']);
  try {
    return JSON.parse(out) as unknown;
  } catch {
    throw new UserError(`playwright-cli 返回了非 JSON 输出：${out.slice(0, 200)}`);
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
