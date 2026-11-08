/**
 * 参数解析与取值校验。
 *
 * 用 `commander` 而不是自己写循环：argv 分词、`--flag=value`、重复选项收集、
 * 未知选项处理都由它负责，这里只声明「哪些是带值选项、哪些是布尔选项」。
 *
 * 两个特殊语义靠配置补上：
 *
 *  1. **令牌名本身以 `--` 开头**（`--rc-brand-8`）。commander 会把它当未知选项，
 *     用 `allowUnknownOption(true)` + `allowExcessArguments(true)` 让它落到位置参数。
 *  2. **带值选项的下一个 token 若是「已知选项」应报缺参**。commander 默认会把
 *     `--json` 当成 `--frontend` 的值静默吞掉。用自定义 `collect` 拦住。
 *
 * 只判「已知选项」而不是笼统的 `/^--/`：`--props --rc-brand-8` 是合法用法
 * （CSS 自定义属性名本身以 `--` 开头），笼统判断会把这种输入误杀。
 */
import { Command } from 'commander';

/** 解析结果。 */
interface ParsedArgs {
  /** 带值的选项，可重复。 */
  values: Record<string, string[]>;
  /** 布尔选项。 */
  flags: Set<string>;
  /** 其余位置参数。 */
  positional: string[];
}

/** 解析选项。 */
interface ParseSpec {
  valueFlags?: readonly string[];
  booleanFlags?: readonly string[];
  /**
   * 是否允许未声明的 `--xxx` 落到位置参数。
   *
   * `read tokens` 这类命令需要把 CSS 令牌名（`--brand-8`）当位置参数；
   * 其它命令应传 false，让拼错的 `--boxx` / `--state` 立即报错，而不是静默忽略。
   */
  allowUnknown?: boolean;
}

/** `--out-dir` → `outDir`（commander 的属性名规则）。 */
const attributeName = (flag: string): string =>
  flag.replace(/^--?/, '').replace(/-([a-z])/g, (_match, char: string) => char.toUpperCase());

/**
 * 解析 argv。
 *
 * `allowUnknown` 默认 true 保留旧行为（令牌名可以以 `--` 开头）；
 * 命令层传 false 时，未声明的选项会报错，避免拼写错误静默变成位置参数。
 */
export function parseArgs(argv: string[], spec: ParseSpec = {}): ParsedArgs {
  const valueFlags = spec.valueFlags ?? [];
  const booleanFlags = spec.booleanFlags ?? [];
  const allowUnknown = spec.allowUnknown ?? true;
  const known = new Set<string>([...valueFlags, ...booleanFlags, '--help', '-h']);

  let missingFlag: string | null = null;

  const program = new Command();
  program.exitOverride();
  // 帮助信息由各子命令自己打印；`--help`/`-h` 保持「位置参数」语义。
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
    program.parse(['node', 'siyuan-devtools', ...argv], { from: 'node' });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    const matched = /option '(--[\w-]+) <value>' argument missing/.exec(message);
    const name = matched?.[1] ?? missingFlag;
    throw new Error(name ? `${name} 需要一个参数` : '选项需要一个参数');
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
    const consumed = new Set(Object.values(values).flat());
    const unknown = argv.find((token) => token.startsWith('--') && !known.has(token) && !consumed.has(token));
    if (unknown) throw new Error(`未知选项：${unknown}`);
  }

  return { values, flags, positional: program.args };
}

/** 取某个选项的最后一个值。 */
export function lastValue(parsed: ParsedArgs, name: string): string | undefined {
  return parsed.values[name]?.at(-1);
}

/** 逗号分隔的选项值拆成数组。没传返回 undefined（保持「未指定」语义）。 */
export function splitList(value: string | undefined): string[] | undefined {
  return value?.split(',').map((item) => item.trim()).filter(Boolean);
}

/** 正整数选项；非法值报错，不能静默变成 [] 让 agent 读成「元素不存在」。 */
export function positiveInt(parsed: ParsedArgs, name: string, fallback: number): number {
  const raw = lastValue(parsed, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} 必须是正整数：${raw}`);
  return value;
}

/** 是否要打印帮助。 */
export function wantsHelp(argv: string[]): boolean {
  return argv.includes('--help') || argv.includes('-h') || argv[0] === 'help';
}
