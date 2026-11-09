/** 批量命令：读计划文件，整个计划编成一次 run-code 执行。 */
import { UserError } from '../errors.ts';
import { output } from '../format.ts';
import { runCli, sessionExists } from '../playwright.ts';
import { readPlan, runPlan } from '../script/plan.ts';
import { readState, writeState } from '../session-state.ts';
import { resolveFrontendUrl } from '../url.ts';
import { parseViewport, viewportFor } from '../viewport.ts';
import { applyViewport, captureRootSnapshot, currentFrontend, launch, waitForReady } from './session.ts';

/**
 * audit 是唯一自动创建会话的命令（计划里已声明 frontend）。
 *
 * 已有会话且前端不同时必须重开：设备模拟（dpr/UA）只能在 open 时指定，
 * 否则 mobile 计划会跑在 desktop 的 dpr=1 上，`min-resolution` /
 * `pointer: coarse` 全部走错分支。
 *
 * 复用会话时**不要**无条件 resize：mobile 会话带着 iPhone 13 的设备视口
 * （390x664），resize 成 390x844 会让同一个前端在 open 与 audit 两条路径上
 * 给出不同测量视口。
 */
export async function audit(args: string[], json: boolean, url: string | null): Promise<void> {
  const planPath = args[0];
  if (!planPath) throw new UserError('audit 需要计划文件路径');
  const plan = readPlan(planPath);

  const targetUrl = resolveFrontendUrl(plan.frontend, url);
  const viewport = plan.viewport === undefined ? null : parseViewport(plan.viewport);
  const state = readState();
  const actual = sessionExists() ? currentFrontend() : null;
  const reuse = actual === plan.frontend;

  if (reuse) {
    // 计划声明了 frontend：已有会话也要导航到对应入口，不能沿用别的页面。
    if (viewport) applyViewport(viewport);
    runCli(['goto', targetUrl]);
    await waitForReady();
    captureRootSnapshot();
  } else {
    await launch(plan.frontend, targetUrl, { viewport: viewport ?? viewportFor(plan.frontend) });
  }
  writeState({
    url: targetUrl,
    frontend: plan.frontend,
    device: reuse ? (state?.device ?? null) : null,
    viewport: reuse ? (viewport ?? state?.viewport ?? null) : viewport,
  });
  output(runPlan(plan), json);
}
