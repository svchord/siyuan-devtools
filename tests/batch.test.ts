/**
 * batch 执行器：脚本生成与页面参数。
 *
 * 真正跑页面需要浏览器，这里只测「生成出来的脚本形状」与纯函数边界：
 * 参数错了必须在开浏览器之前暴露，而不是静默跑错场景。
 */
import { describe, expect, it } from 'vitest';
import { buildBatchScript, targetConfig } from '../src/cli/batch.ts';
import { parseAt, sceneLabel } from '../src/cli/scene.ts';

const DESKTOP = targetConfig('desktop', 'http://x/', null, null);
const MOBILE = targetConfig('mobile', 'http://x/', null, null);

describe('targetConfig', () => {
  it('桌面 1600x1000 dpr1，不带 UA', () => {
    expect(DESKTOP).toMatchObject({ viewport: { width: 1600, height: 1000 }, dpr: 1, mobile: false, touch: false, ua: '' });
  });

  it('移动 390x844 dpr3，带移动 UA 与 touch', () => {
    expect(MOBILE.viewport).toEqual({ width: 390, height: 844 });
    expect(MOBILE.dpr).toBe(3);
    expect(MOBILE.mobile).toBe(true);
    expect(MOBILE.touch).toBe(true);
    expect(MOBILE.ua).toContain('iPhone');
  });

  it('URL 带测量页标记，便于跨命令找回同一个页面', () => {
    expect(DESKTOP.url).toBe('http://x/#syd-measure=desktop');
  });
});

describe('buildBatchScript', () => {
  const spec = parseAt('desktop/dark/default,desktop/dark/compact');

  it('把场景与目标写进同一段 run-code', () => {
    const script = buildBatchScript(spec.scenes, [], null, 'live-first', false, { desktop: DESKTOP });
    expect(script).toContain('"at":"desktop/dark/default"');
    expect(script).toContain('"at":"desktop/dark/compact"');
    expect(script).toContain('const POLICY = "live-first"');
    expect(script).toContain('"dpr":1');
    expect(() => new Function(`return (${script});`)).not.toThrow();
  });

  it('预载另一张内置主题表，切换只改 media', () => {
    const script = buildBatchScript(spec.scenes, [], null, 'live-first', false, { desktop: DESKTOP });
    expect(script).toContain("id = 'syd-other'");
    expect(script).toContain('media = \'not all\'');
    expect(script).toContain('themeDefaultStyle');
    expect(script).toContain('/midnight/');
  });

  it('live-first 会记录并还原当前页属性', () => {
    const script = buildBatchScript(spec.scenes, [], null, 'live-first', false, { desktop: DESKTOP });
    expect(script).toContain('liveSnapshot');
    expect(script).toContain('data-theme-mode');
    expect(script).toContain('data-ui-density');
  });

  it('截图路径写进脚本，由页面侧直接落盘', () => {
    const shots = [{ at: 'desktop/dark/default', path: 'out/desktop-dark-default.png' }];
    const script = buildBatchScript(spec.scenes, [], shots, 'measure-only', true, { desktop: DESKTOP });
    expect(script).toContain('out/desktop-dark-default.png');
    expect(script).toContain('p.screenshot');
    expect(script).toContain('const POLICY = "measure-only"');
    expect(script).toContain('const RELOAD_WHEN_DIRTY = true');
  });

  it('空步骤也生成合法的 runSteps', () => {
    const script = buildBatchScript(spec.scenes, [], null, 'live-first', false, { desktop: DESKTOP });
    expect(script).toContain('const runSteps = async (page) =>');
    expect(() => new Function(`return (${script});`)).not.toThrow();
  });

  it('场景标签与截图文件名共用同一套命名', () => {
    expect(sceneLabel(spec.scenes[0]!)).toBe('desktop/dark/default');
  });
});
