/**
 * 分发 skill：装到 `.agents/skills/siyuan-devtools/`。
 *
 * 与 playwright-core cli 的 `install --skills` 同一约定。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../args.ts';
import { EnvironmentError, UserError } from '../errors.ts';
import { note } from '../format.ts';

export function install(argv: string[]): void {
  const parsed = parseArgs(argv, { valueFlags: [], booleanFlags: ['--skills', '--global'], allowUnknown: false });
  if (!parsed.flags.has('--skills')) throw new UserError('目前只支持 install --skills');
  // 产物布局：dist/cli/commands/install.js → 包根 → skills/siyuan-devtools/SKILL.md
  const here = dirname(fileURLToPath(import.meta.url));
  const source = join(here, '..', '..', '..', 'skills', 'siyuan-devtools', 'SKILL.md');
  let text: string;
  try {
    text = readFileSync(source, 'utf8');
  } catch {
    throw new UserError(`读不到内置 skill：${source}`);
  }
  const target = parsed.flags.has('--global')
    ? join(homedir(), '.agents', 'skills', 'siyuan-devtools', 'SKILL.md')
    : join(process.cwd(), '.agents', 'skills', 'siyuan-devtools', 'SKILL.md');
  try {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, text, 'utf8');
  } catch (cause) {
    // 权限/磁盘问题不是用法错误，也不是本工具的 bug。
    throw new EnvironmentError(`写不了 skill 文件：${target}（${cause instanceof Error ? cause.message : String(cause)}）`);
  }
  // 状态提示走 stderr，stdout 留给数据。
  note(`已安装 skill：${target}`);
}
