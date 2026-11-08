/**
 * 计划文件编译：形状正确、动作与读数都能落到 run-code 脚本里。
 */
import { describe, expect, it } from 'vitest';
import { compilePlan } from '../src/cli/script/plan.ts';
import type { Plan } from '../src/cli/script/plan.ts';

const PLAN: Plan = {
  frontend: 'desktop',
  steps: [
    { do: 'menu:theme' },
    { read: 'element', selector: '.b3-menu__item', props: ['color'] },
    { do: 'hover:.b3-menu__item', diff: { selector: '.b3-menu__item', props: ['color'] } },
    { read: 'contrast', foreground: '--rc-text-primary', background: '--rc-bg-page' },
  ],
};

describe('compilePlan', () => {
  it('生成 async (page) 形式，且能解析', () => {
    const source = compilePlan(PLAN);
    expect(source.startsWith('async (page) =>')).toBe(true);
    expect(() => new Function(`return (${source});`)).not.toThrow();
  });

  it('每一步都进脚本', () => {
    const source = compilePlan(PLAN);
    expect(source).toContain('page.locator(".b3-menu__item").hover()');
    expect(source).toContain('results.push');
    expect(source.match(/results\.push/g)?.length).toBe(PLAN.steps.length);
  });

  it('读数步骤带自己的参数', () => {
    const source = compilePlan(PLAN);
    expect(source).toContain('--rc-text-primary');
    expect(source).toContain('--rc-bg-page');
  });

  it('读数片段来自 recipe.ts，不在 plan.ts 另写一份', () => {
    const source = compilePlan({
      frontend: 'desktop',
      steps: [
        { read: 'env' },
        { read: 'tokens', names: ['--brand-8'] },
      ],
    });
    // env 片段里的 pluginsStyle 是 recipe.ts 独有的字段
    expect(source).toContain('pluginsStyle');
    expect(source).toContain('--brand-8');
  });

  it('读数片段内联成函数源码，不能包成字符串（否则 evaluate 返回 undefined）', () => {
    const source = compilePlan({
      frontend: 'desktop',
      steps: [{ read: 'env' }, { read: 'element', selector: '.x', props: ['color'] }],
    });
    expect(source).toContain('page.evaluate(() => {');
    expect(source).not.toContain('page.evaluate("() =>');
    // 带参数的片段同理
    const tokens = compilePlan({ frontend: 'desktop', steps: [{ read: 'tokens', names: ['--a'] }] });
    expect(tokens).toContain('page.evaluate(names => {');
    expect(tokens).not.toContain('page.evaluate("names =>');
  });

  it('未知动作报错', () => {
    expect(() => compilePlan({ frontend: 'desktop', steps: [{ do: 'teleport:x' }] })).toThrow('不支持的动作');
  });
});
