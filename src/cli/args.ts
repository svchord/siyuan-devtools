/**
 * 参数解析与取值校验。
 *
 * 用 `commander` 做 argv 分词：`--flag=value`、重复选项收集、`--` 分隔符
 * 都由它负责，这里只声明「哪些是带值选项、哪些是布尔选项」，并补两件
 * commander 不做的语义：
 *
 *  1. **令牌名本身以 `--` 开头**（`--rc-brand-8`）。commander 会把它当未知选项，
 *     用 `allowUnknownOption(true)` + `allowExcessArguments(true)` 让它落到位置参数。
 *     需要这种用法的命令（`read tokens`）才传 `allowUnknown: true`；其余命令传
 *     false，拼错的 `--boxx` 立即报错而不是静默变成位置参数。
 *  2. **带值选项的下一个 token 若是「已知选项」应报缺参**。commander 默认会把
 *     `--json` 当成 `--frontend` 的值静默吞掉。用自定义 `collect` 拦住。
 *
 * 只判「已知选项」而不是笼统的 `/^--/`：`--props --rc-brand-8` 是合法用法
 * （CSS 自定义属性名本身以 `--` 开头），笼统判断会把这种输入误杀。
 *
 * `--` 之后的 token 一律是位置参数，永远不当选项解析。这样 `do fill x -- --json`
 * 能把字面量 `--json` 输入到页面里，而不是被当成全局开关。
 */
import { Command } from 'commander';
import { UserError } from './errors.ts';

/** 解析结果。 */
export interface ParsedArgs {
  /** 带值的选项，可重复。 */
  values: Record<string, string[]>;
  /** 布尔选项。 */
  flags: Set<string>;
  /** 其余位置参数（含 `--` 之后的字面量）。 */
  positional: string[];
}

/** 解析选项。 */
export interface ParseSpec {
  valueFlags?: readonly string[];
  booleanFlags?: readonly string[];
/**
 * 是否允许未声明的 `--xxx` 落到位置参数。
 *
 * `read tokens` 这类命令需要把 CSS 令牌名（`--brand-8`）当位置参数；
 * 其它命令必须传 false，让拼错的 `--boxx` 立即报错，而不是静默忽略。
 */
  allowUnknown: boolean;
}

/** `--out-dir` → `outDir`（commander 的属性名规则）。 */
const attributeName = (flag: string): string =>
  flag.replace(/^--?/, '').replace(/-([a-z])/g, (_match, char: string) => char.toUpperCase());

/** `--name=value` 拆成 `--name` 与 `value`；不匹配返回 null。 */
const EQUALS_FORM = /^(--[\w-]+)=([\s\S]*)$/;

/**
 * 规范化 `--flag=value`：带值选项拆成两个 token，布尔选项只接受 `=true` / `=false`。
 *
 * 返回的 `argv` 已去掉 `--` 及其后内容；`tail` 是 `--` 之后的位置参数。
 */
function normalize(
  argv: string[],
  valueFlags: readonly string[],
  booleanFlags: readonly string[]
): { argv: string[]; tail: string[] } {
  const separator = argv.indexOf('--');
  const head = separator === -1 ? argv : argv.slice(0, separator);
  const tail = separator === -1 ? [] : argv.slice(separator + 1);

  const normalized: string[] = [];
  for (const token of head) {
    const matched = EQUALS_FORM.exec(token);
    if (!matched) {
      normalized.push(token);
      continue;
    }
    const [, name, value] = matched as unknown as [string, string, string];
    if (valueFlags.includes(name)) {
      normalized.push(name, value);
      continue;
    }
    if (booleanFlags.includes(name)) {
      if (value === 'true') normalized.push(name);
      else if (value !== 'false') throw new UserError(`${name} 只接受 true / false：${value}`);
      continue;
    }
    // 未知的 `--name=value`：丢掉值只留名字，交给下面的未知选项检查统一报错，
    // 这样报错里出现的是 `--name` 而不是一长串 `--name=value`。
    normalized.push(name);
  }
  return { argv: normalized, tail };
}

/**
 * 找出第一个未声明的选项。
 *
 * 需要按「带值选项 → 它的下一个 token 是值」逐对跳过，否则
 * `--props --rc-brand-8` 里的令牌名会被误判成未知选项。
 */
function findUnknownOption(argv: string[], known: ReadonlySet<string>, valueFlags: ReadonlySet<string>): string | null {
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (valueFlags.has(token)) {
      i += 1;
      continue;
    }
    if (known.has(token)) continue;
    if (token === '-' || !token.startsWith('-')) continue;
    // 负数（`do mousemove -5 10`）是位置参数，不是选项。
    if (/^-\d/.test(token)) continue;
    return token;
  }
  return null;
}

/**
 * 解析 argv。
 *
 * `allowUnknown` 必须由调用方显式指定：只有 `read tokens` 这类需要把 CSS
 * 令牌名（`--brand-8`）当位置参数的命令才传 true；其余命令传 false，让拼错的
 * `--boxx` 立即报错，而不是静默变成位置参数。
 */
export function parseArgs(argv: string[], spec: ParseSpec): ParsedArgs {
  const valueFlags = spec.valueFlags ?? [];
  const booleanFlags = spec.booleanFlags ?? [];
  const allowUnknown = spec.allowUnknown;
  const known = new Set<string>([...valueFlags, ...booleanFlags]);
  const valueSet = new Set<string>(valueFlags);

  const { argv: normalized, tail } = normalize(argv, valueFlags, booleanFlags);

  let missingFlag: string | null = null;

  const program = new Command();
  program.exitOverride();
  program.helpOption(false);
  program.allowUnknownOption(true);
  program.allowExcessArguments(true);
  // commander 出错时默认往 stderr 写一行；本函数只抛错，由上层统一渲染。
  program.configureOutput({ writeErr: () => {}, writeOut: () => {} });

  for (const flag of valueFlags) {
    const collect = (value: string, previous: string[]): string[] => {
      if (known.has(value)) {
        missingFlag = flag;
        throw new Error('missing value');
      }
      return [...previous, value];
    };
    program.option(`${flag} <value>`, '', collect, []);
  }
  for (const flag of booleanFlags) program.option(flag);

  try {
    program.parse(['node', 'siyuan-devtools', ...normalized], { from: 'node' });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const matched = /option '(--[\w-]+) <value>' argument missing/.exec(message);
    const name = matched?.[1] ?? missingFlag;
    throw new UserError(name ? `${name} 需要一个参数` : '选项需要一个参数');
  }

  const opts = program.opts() as Record<string, unknown>;
  const values: Record<string, string[]> = {};
  for (const flag of valueFlags) {
    const collected = opts[attributeName(flag)];
    if (Array.isArray(collected) && collected.length) values[flag] = collected as string[];
  }

  const flags = new Set<string>();
  for (const flag of booleanFlags) {
    if (opts[attributeName(flag)] === true) flags.add(flag);
  }

  if (!allowUnknown) {
    const unknown = findUnknownOption(normalized, known, valueSet);
    if (unknown) throw new UserError(`未知选项：${unknown}（用 --help 查看用法）`);
  }

  return { values, flags, positional: [...program.args, ...tail] };
}

/** 取某个选项的最后一个值。 */
export function lastValue(parsed: ParsedArgs, name: string): string | undefined {
  return parsed.values[name]?.at(-1);
}

/** 正整数选项；非法值报错，不能静默变成 [] 让 agent 读成「元素不存在」。 */
export function positiveInt(parsed: ParsedArgs, name: string, fallback: number): number {
  const raw = lastValue(parsed, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new UserError(`${name} 必须是正整数：${raw}`);
  return value;
}

/**
 * 是否要打印帮助。
 *
 * `--help` / `-h` 出现在 `--` 之前都算帮助请求。需要把 `--help` 当字面量
 * （例如 `do fill x -- --help`）时用 `--` 分隔。
 */
export function wantsHelp(argv: string[]): boolean {
  if (!argv.length) return true;
  if (argv[0] === 'help') return true;
  const separator = argv.indexOf('--');
  const head = separator === -1 ? argv : argv.slice(0, separator);
  return head.some((token) => token === '--help' || token === '-h');
}
