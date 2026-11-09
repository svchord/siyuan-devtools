/**
 * 参数分发：把 argv 映射到各命令族。
 *
 * 全局选项 `--json` / `--url` 可以出现在任何位置（README 里就是
 * `read tokens --json` 这种写法），但 **`--` 之后一律按字面量处理**。
 *
 * 这是唯一能同时满足两种需求的规则：
 *   `do fill '#inp' --json`        → --json 是全局开关，fill 没有文本 ⇒ 报错
 *   `do fill '#inp' -- --json`     → --json 是要输入到页面的文本
 *
 * 旧实现扫全 argv 且不支持 `--`，于是 `do fill '#inp' --json` 会把输入框
 * 清空并返回成功——静默改错数据。
 */
import { wantsHelp } from './args.ts';
import { audit } from './commands/audit.ts';
import { doAction } from './commands/do.ts';
import { install } from './commands/install.ts';
import { read } from './commands/read.ts';
import { close, open, reload, status } from './commands/session.ts';
import { shot } from './commands/shot.ts';
import { UserError } from './errors.ts';
import { HELP } from './help.ts';

/** 全局选项。 */
export interface Globals {
  json: boolean;
  url: string | null;
  rest: string[];
}

/** 从 argv 里摘出全局选项；`--` 及其后内容原样保留。 */
export function takeGlobals(argv: string[]): Globals {
  let json = false;
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
  return { json, url, rest };
}

/** 各命令返回给进程的退出码；失败统一由 bin 入口的 catch 映射成 2。 */
export async function main(argv: string[]): Promise<void> {
  if (!argv.length || wantsHelp(argv)) {
    console.log(HELP);
    return;
  }
  const { json, url, rest } = takeGlobals(argv);
  const [command, ...args] = rest;
  if (command === undefined) {
    // 只给了全局选项（如 `siyuan-devtools --json`）：没有命令可跑。
    throw new UserError('缺少命令；用 --help 查看用法');
  }

  switch (command) {
    case 'open':
      await open(args, url);
      return;
    case 'reload':
      await reload(args, url);
      return;
    case 'status':
      status(json);
      return;
    case 'close':
      close();
      return;
    case 'read':
      read(args, json);
      return;
    case 'do':
      await doAction(args, json);
      return;
    case 'audit':
      await audit(args, json, url);
      return;
    case 'shot':
      await shot(args, url, json);
      return;
    case 'install':
      install(args);
      return;
    default:
      throw new UserError(`未知命令：${String(command)}；用 --help 查看用法`);
  }
}
