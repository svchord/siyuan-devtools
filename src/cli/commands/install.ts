/**
 * 分发 skill：装到 `.agents/skills/siyuan-devtools/`。
 *
 * 与 playwright-core cli 的 `install --skills` 同一约定。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../args.ts';
import { UserError } from '../support.ts';

export function install(argv: string[]): void {
  const parsed = parseArgs(argv, { valueFlags: [], booleanFlags: ['--skills', '--global'] });
  if (!parsed.flags.has('--skills')) throw new UserError('目前只支持 install --skills');
  const here = dirname(fileURLToPath(import.meta.url));
  const source = join(here, '..', '..', '..', 'skills', 'siyuan-devtools', 'SKILL.md');
  let text: string;
  try {
    text = readFileSync(source, 'utf8');
  } catch {
    throw new UserError(`读不到内置 skill：${source}`);
  }
  const target = parsed.flags.has('--global')
    ? join(process.env.HOME ?? process.env.USERPROFILE ?? '.', '.agents', 'skills', 'siyuan-devtools', 'SKILL.md')
    : join(process.cwd(), '.agents', 'skills', 'siyuan-devtools', 'SKILL.md');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text, 'utf8');
  // 状态提示走 stderr，stdout 留给数据。
  console.error(`已安装 skill：${target}`);
}
