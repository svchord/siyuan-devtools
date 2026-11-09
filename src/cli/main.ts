/**
 * 参数分发：把 argv 映射到各命令族。
 *
 * 全局选项 `--json` / `--pretty` / `--raw` / `--at` / `--url` 可以出现在任何
 * 位置（README 里就是 `read tokens --json` 这种写法），但 **`--` 之后一律按
 * 字面量处理**。
 *
 * 这是唯一能同时满足两种需求的规则：
 *   `do fill '#inp' --json`        → --json 是全局开关，fill 没有文本 ⇒ 报错
 *   `do fill '#inp' -- --json`     → --json 是要输入到页面的文本
 *
 * 旧实现扫全 argv 且不支持 `--`，于是 `do fill '#inp' --json` 会把输入框
 * 清空并返回成功——静默改错数据。
 *
 * `--pretty` 单独出现时隐含 `--json`：它的唯一作用是给结构化输出换行缩进，
 * 没有 JSON 时无从生效；静默忽略等于让用户以为输出变了。
 *
 * `--at` 放在全局而不是逐命令：它表达的是「这次测量在哪个格上进行」，
 * 与 `read`/`do`/`shot`/`audit` 都无关，逐命令各写一份必然漂移。
 */
import { wantsHelp } from './args.ts';
import { audit } from './commands/audit.ts';
import { doAction } from './commands/do.ts';
import { install } from './commands/install.ts';
import { read } from './commands/read.ts';
import { close, open, reload, status } from './commands/session.ts';
import { shot } from './commands/shot.ts';
import { UserError } from './errors.ts';
import { setPretty } from './format.ts';
import { HELP } from './help.ts';

/** 全局选项。 */
export interface Globals {
  json: boolean;
  /** 缩进 JSON；为真时 `json` 必然也为真。 */
  pretty: boolean;
  /** 只对 status 有意义：给 playwright 会话列表而不是测量状态。 */
  raw: boolean;
  /** `--at` 的原始值；null 表示「就在当前格上测」。 */
  at: string | null;
  url: string | null;
  rest: string[];
}

/** 从 argv 里摘出全局选项；`--` 及其后内容原样保留。 */
export function takeGlobals(argv: string[]): Globals {
  let json = false;
  let pretty = false;
  let raw = false;
  let at: string | null = null;
  let url: string | null = null;
  const rest: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    // `--` 之后全部是字面量，连 `--json` 也不当开关。
    if (token === '--') {
      rest.push(...argv.slice(index));
      break;
    }
    if (token === '--json') {
      json = true;
      continue;
    }
    if (token === '--pretty') {
      pretty = true;
      continue;
    }
    if (token === '--raw') {
      raw = true;
      continue;
    }
    if (token === '--at') {
      const value = argv[index + 1];
      // 与 `--url` 同样的规则：下一个 token 是选项时说明缺参。
      // 空串单独判，否则 `--at=` 会变成一个「空格」而不是报错。
      if (value === undefined || value === '--' || value.startsWith('-')) {
        throw new UserError('--at 需要一个参数，如 all 或 desktop/dark/default');
      }
      at = value;
      index += 1;
      continue;
    }
    if (token.startsWith('--at=')) {
      const value = token.slice('--at='.length);
      if (!value) throw new UserError('--at 需要一个参数，如 all 或 desktop/dark/default');
      at = value;
      continue;
    }
    if (token === '--url') {
      const value = argv[index + 1];
      // 下一个 token 是另一个选项时说明缺参；否则 `--url --json` 会把
      // `--json` 吞成 URL，命令变成 `status` 之外的怪东西。
      if (value === undefined || value === '--' || value.startsWith('-')) {
        throw new UserError('--url 需要一个参数');
      }
      url = value;
      index += 1;
      continue;
    }
    if (token.startsWith('--url=')) {
      const value = token.slice('--url='.length);
      if (!value) throw new UserError('--url 需要一个参数');
      url = value;
      continue;
    }
    rest.push(token);
  }
  // `--pretty` 隐含 `--json`：只给前者时也走结构化输出，否则它毫无效果。
  return { json: json || pretty, pretty, raw, at, url, rest };
}

/** 各命令返回给进程的退出码；失败统一由 bin 入口的 catch 映射成 2。 */
export async function main(argv: string[]): Promise<void> {
  if (!argv.length || wantsHelp(argv)) {
    console.log(HELP);
    return;
  }
  const { json, pretty, raw, at, url, rest } = takeGlobals(argv);
  const [command, ...args] = rest;
  if (command === undefined) {
    // 只给了全局选项（如 `siyuan-devtools --json`）：没有命令可跑。
    throw new UserError('缺少命令；用 --help 查看用法');
  }
  // --raw 只改变 status 的输出形状。其它命令上静默忽略会让人以为拿到了原始数据，
  // 所以直接报错，并指出唯一合法的用法。
  if (raw && command !== 'status') {
    throw new UserError(`--raw 只用于 status（当前命令：${command}）`);
  }
  // --at 需要会话才能切换页面状态；`read contrast <字面量>` 与 install 不碰页面。
  // 这里只拦「不可能有意义」的组合，具体校验交给 read/do 自己（它们更清楚
  // 自己有没有页面可切）。
  if (at !== null && (command === 'install' || command === 'open' || command === 'close' || command === 'reload')) {
    throw new UserError(`--at 不能用于 ${command}（它改变的是页面状态，不是会话）`);
  }
  setPretty(pretty);

  switch (command) {
    case 'open':
      await open(args, url);
      return;
    case 'reload':
      await reload(args, url);
      return;
    case 'status':
      status(json, raw);
      return;
    case 'close':
      close();
      return;
    case 'read':
      await read(args, json, at, url);
      return;
    case 'do':
      await doAction(args, json, at, url);
      return;
    case 'audit':
      await audit(args, json, url);
      return;
    case 'shot':
      await shot(args, url, json, at);
      return;
    case 'install':
      install(args);
      return;
    default:
      throw new UserError(`未知命令：${String(command)}；用 --help 查看用法`);
  }
}
