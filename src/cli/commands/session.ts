/**
 * 会话命令：open / reload / status / close。
 *
 * `open` 只调一次；会话已存在时加载新产物用 `reload`（内部 goto），
 * 因为 playwright-core cli 的 open 会杀掉旧 Chrome 起一个新的。
 *
 * 状态提示走 stderr（clig.dev：日志走 stderr，数据走 stdout），
 * 这样 `... --json | jq` 不会被「已打开」这类话打断。
 */
import { lastValue, parseArgs } from '../args.ts';
import { runCli, sessionExists } from '../playwright.ts';
import { UserError } from '../support.ts';
import { frontendUrl, parseFrontend } from '../url.ts';
import type { Frontend } from '../url.ts';

/** 除 open / audit 外的命令都要求会话已存在。 */
export function requireSession(): void {
  if (!sessionExists()) throw new UserError('未启动浏览器会话；先运行 siyuan-devtools open [--frontend …]');
}

/** 状态提示：走 stderr，不污染 stdout 的数据。 */
function note(message: string): void {
  console.error(message);
}

export async function open(argv: string[], url: string | null): Promise<void> {
  const parsed = parseArgs(argv, {
    valueFlags: ['--frontend', '--device', '--viewport'],
    booleanFlags: ['--headed'],
  });
  const frontend = parseFrontend(lastValue(parsed, '--frontend'));
  const args = ['open', '--browser=chrome'];
  const device = lastValue(parsed, '--device');
  if (device) args.push(`--device=${device}`);
  const viewport = lastValue(parsed, '--viewport');
  if (viewport && !/^(\d+)x(\d+)$/.exec(viewport)) {
    throw new UserError(`--viewport 格式应为 宽x高，如 390x844：${viewport}`);
  }
  if (parsed.flags.has('--headed')) args.push('--headed');
  args.push(frontendUrl(frontend, url));
  runCli(args);
  if (viewport) {
    const match = /^(\d+)x(\d+)$/.exec(viewport)!;
    runCli(['resize', match[1]!, match[2]!]);
  }
  note(`已打开 ${frontend}：${frontendUrl(frontend, url)}`);
}

export function reload(argv: string[], url: string | null): void {
  requireSession();
  const frontend: Frontend = parseFrontend(lastValue(parseArgs(argv, { valueFlags: ['--frontend'] }), '--frontend'));
  runCli(['goto', frontendUrl(frontend, url)]);
  note(`已重新加载：${frontendUrl(frontend, url)}`);
}

/** status 的输出是数据，留在 stdout。 */
export function status(): void {
  if (!sessionExists()) {
    console.log('未启动');
    return;
  }
  console.log(runCli(['list']).out);
}

export function close(): void {
  if (!sessionExists()) {
    note('未启动');
    return;
  }
  runCli(['close']);
  note('已关闭');
}
