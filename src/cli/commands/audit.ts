/** 批量命令：读计划文件，整个计划编成一次 run-code 执行。 */
import { readPlan, runPlan } from '../script/plan.ts';
import { output } from '../format.ts';
import { runCli, sessionExists } from '../playwright.ts';
import { UserError } from '../support.ts';
import { frontendUrl } from '../url.ts';
import { parseViewport, viewportFor } from '../viewport.ts';
import { applyViewport, captureRootSnapshot, deviceArgsFor, waitForReady } from './session.ts';

/** audit 是唯一自动创建会话的命令（计划里已声明 frontend）。 */
export async function audit(args: string[], json: boolean, url: string | null): Promise<void> {
  const planPath = args[0];
  if (!planPath) throw new UserError('audit 需要计划文件路径');
  const plan = readPlan(planPath);

  const targetUrl = frontendUrl(plan.frontend, url);
  if (!sessionExists()) {
    // 与 session.ts 的 open 走同一套设备参数：mobile 必须模拟真机，
    // 否则 dpr 停在 1，min-resolution / pointer 等媒体查询不会命中。
    runCli(['open', '--browser=chrome', ...deviceArgsFor(plan.frontend), targetUrl]);
  } else {
    // 计划声明了 frontend：已有会话也要导航到对应入口，不能沿用别的页面。
    runCli(['goto', targetUrl]);
  }

  // 计划里的 viewport 优先；没写则按前端使用标准视口，保证移动端截图/测量不是桌面宽度。
  applyViewport(plan.viewport === undefined ? viewportFor(plan.frontend) : parseViewport(plan.viewport));
  await waitForReady();
  await captureRootSnapshot();
  output(runPlan(plan), json);
}
