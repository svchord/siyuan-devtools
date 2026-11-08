/** 批量命令：读计划文件，整个计划编成一次 run-code 执行。 */
import { readPlan, runPlan } from '../script/plan.ts';
import { output } from '../format.ts';
import { runCli, sessionExists } from '../playwright.ts';
import { UserError } from '../support.ts';
import { frontendUrl } from '../url.ts';

/** audit 是唯一自动创建会话的命令（计划里已声明 frontend）。 */
export function audit(args: string[], json: boolean, url: string | null): void {
  const planPath = args[0];
  if (!planPath) throw new UserError('audit 需要计划文件路径');
  const plan = readPlan(planPath);
  if (!sessionExists()) {
    runCli(['open', '--browser=chrome', frontendUrl(plan.frontend, url)]);
  }
  output(runPlan(plan), json);
}
