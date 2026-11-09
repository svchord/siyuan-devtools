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
 * 注意 `result` 是**字符串**，值本身还要再 `JSON.parse` 一次；
 * 页面返回 `undefined` 时它会是字面量 `"undefined"`，这里统一折成 null。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { firstLine, UserError } from './errors.ts';
import { isRecord } from './util.ts';

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
 * 当前目录是否处在一个 Playwright workspace 里。
 *
 * Playwright CLI 从 cwd 向上找 `.playwright` 目录作为 workspace；找不到时
 * 退回 playwright-core 包根目录，导致不同项目共用同一个 `default` 会话
 * （在 A 项目 open 会杀掉 B 项目的浏览器）。
 *
 * 这个查找必须与 Playwright 的实现保持一致（同样最多向上 10 层）。
 * 会话状态文件也用它的结果定位，否则在子目录里写状态会凭空造出一个新的
 * workspace，下一条命令就会报「未启动」。
 */
export function findWorkspace(cwd: string = process.cwd()): string | null {
  let dir = cwd;
  for (let depth = 0; depth < 10; depth += 1) {
    if (existsSync(join(dir, '.playwright'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * 会话状态的存放目录。
 *
 * 必须与 Playwright 认定的 workspace 一致：在子目录里跑命令时，状态文件要
 * 落在父目录那个 `.playwright` 里，而不是在子目录新建一个。没有 workspace
 * 时用 cwd（随后 `ensureWorkspace()` 会把它变成 workspace）。
 */
export function workspaceRoot(): string {
  return findWorkspace() ?? process.cwd();
}

/** 建立 workspace 标记；只有真正要开会话的命令才调用。 */
export function ensureWorkspace(): void {
  if (findWorkspace()) return;
  mkdirSync(join(process.cwd(), '.playwright'), { recursive: true });
}

/** 一条命令的原始结果。 */
interface RawCliResult {
  out: string;
  err: string;
  status: number | null;
}

/** 单条 cli 命令的超时；daemon 卡死时不能把整个 CLI 永久挂住。 */
const CLI_TIMEOUT_MS = 120_000;

/** 执行一条 playwright-core cli 命令，保留退出码供 JSON 错误信封解析。 */
function runCliRaw(args: string[]): RawCliResult {
  const result = spawnSync(process.execPath, [cliPath(), 'cli', ...args], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: CLI_TIMEOUT_MS,
  });
  if (result.error) {
    // ETIMEDOUT 的 error 是 Error 子类，消息里已经带上了 timeout。
    throw new UserError(`执行 playwright-cli 失败：${result.error.message}`);
  }
  return {
    out: (result.stdout ?? '').trim(),
    err: (result.stderr ?? '').trim(),
    status: result.status,
  };
}

/** 一条命令失败时的错误消息。 */
function failureMessage(result: RawCliResult): string {
  return firstLine(result.err || result.out || `playwright-cli 退出码 ${String(result.status)}`);
}

/** 执行一条 playwright-core cli 命令（不加额外输出开关）。 */
export function runCli(args: string[]): string {
  const result = runCliRaw(args);
  if (result.status !== 0) throw new UserError(failureMessage(result));
  return result.out;
}

/**
 * 执行一条带位置参数的命令，必要时插入 `--` 分隔符。
 *
 * playwright-cli 自己支持 `--`（`cli fill '#inp' -- --json` 会把 `--json`
 * 当字面量）。但它在 `--` 之前会把任何 `-` 开头的 token 当选项，所以
 * `fill '#inp' --json` 里的 `--json` 会被吞成全局开关、`text` 变成 undefined。
 * 本 CLI 接受字面量（`do fill '#inp' -- --json`），必须在转发时补回 `--`。
 */
export function runCliAction(command: string, positional: readonly string[]): string {
  const needsSeparator = positional.some((token) => token.startsWith('-'));
  const args = needsSeparator ? [command, '--', ...positional] : [command, ...positional];
  return runCli(args);
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
 * 页面返回 `undefined` 时 cli 发出的是字符串 `"undefined"`，这里折成 null。
 */
function runJson(args: string[]): unknown {
  const result = runCliRaw(['--json', ...args]);
  let envelope: JsonEnvelope;
  try {
    envelope = JSON.parse(result.out) as JsonEnvelope;
  } catch {
    if (result.status !== 0) throw new UserError(failureMessage(result));
    throw new UserError(`playwright-cli 返回了非 JSON 输出：${firstLine(result.out).slice(0, 200)}`);
  }
  if (envelope.isError) throw new UserError(firstLine(envelope.error ?? '页面执行出错'));
  if (result.status !== 0) throw new UserError(failureMessage(result));
  if (envelope.result === undefined || envelope.result === 'undefined') return null;
  try {
    return JSON.parse(envelope.result);
  } catch {
    // result 不是 JSON 时按原文字符串返回（例如 `eval "1 + 2"`）。
    return envelope.result;
  }
}

/** 一个会话条目（`cli --json list` 的 `browsers[]`）。 */
export interface SessionEntry {
  name: string;
  status: string;
  browserType?: string;
  headed?: boolean;
  [key: string]: unknown;
}

/** 结构化读取当前 workspace 的浏览器会话列表。 */
export function listSessions(): SessionEntry[] {
  const out = runCli(['--json', 'list']);
  let parsed: unknown;
  try {
    parsed = JSON.parse(out);
  } catch {
    throw new UserError(`playwright-cli 返回了非 JSON 输出：${firstLine(out).slice(0, 200)}`);
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.browsers)) return [];
  return parsed.browsers.filter(
    (item): item is SessionEntry => isRecord(item) && typeof item.name === 'string' && typeof item.status === 'string'
  );
}

/** 本 CLI 只操作默认会话；`-s=other` 开出来的会话不算。 */
const DEFAULT_SESSION = 'default';

/** 默认会话是否已打开（不创建会话、不产生文件系统副作用）。 */
export function sessionExists(): boolean {
  if (!findWorkspace()) return false;
  return listSessions().some((entry) => entry.name === DEFAULT_SESSION && entry.status === 'open');
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
