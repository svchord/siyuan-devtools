/**
 * 参数分发：把 argv 映射到各命令族。
 *
 * 全局选项 `--json` / `--url` 在这里取出，其余交给各命令自己解析。
 */
import { wantsHelp } from './args.ts';
import { audit } from './commands/audit.ts';
import { doAction } from './commands/do.ts';
import { install } from './commands/install.ts';
import { read } from './commands/read.ts';
import { close, open, reload, status } from './commands/session.ts';
import { shot } from './commands/shot.ts';
import { HELP } from './help.ts';
import { UserError } from './support.ts';

/** 解析全局选项，返回剩余 argv。 */
function takeGlobals(argv: string[]): { json: boolean; url: string | null; rest: string[] } {
  let json = false;
  let url: string | null = null;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]!;
    if (token === '--json') {
      json = true;
      continue;
    }
    if (token === '--url') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new UserError('--url 需要一个参数');
      }
      url = value;
      i += 1;
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

export async function main(argv: string[]): Promise<number> {
  if (!argv.length || wantsHelp(argv)) {
    console.log(HELP);
    return 0;
  }
  const { json, url, rest } = takeGlobals(argv);
  const [command, ...args] = rest;

  switch (command) {
    case 'open':
      await open(args, url);
      return 0;
    case 'reload':
      await reload(args, url);
      return 0;
    case 'status':
      status(json);
      return 0;
    case 'close':
      close();
      return 0;
    case 'read':
      read(args, json);
      return 0;
    case 'do':
      await doAction(args, json);
      return 0;
    case 'audit':
      await audit(args, json, url);
      return 0;
    case 'shot':
      await shot(args, url, json);
      return 0;
    case 'install':
      install(args);
      return 0;
    default:
      throw new UserError(`未知命令：${String(command)}；用 --help 查看用法`);
  }
}
