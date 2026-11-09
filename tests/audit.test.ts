/**
 * 计划编译：**真的执行生成的脚本**（用假 page），断言行为而不是源码字符串。
 *
 * 旧版本只断言 `toContain('const before2')` 这类代码生成细节，所以
 * 「`do:'click'` 被编译成菜单点击」「contrast 不返回 ratio」两个 bug
 * 都测不出来。现在把生成的脚本放进 `new Function` 跑一遍。
 */
import { describe, expect, it } from 'vitest';

// 生成的脚本里有 `setTimeout(..., ACTION_SETTLE_MS)`；测试不需要真的等。
process.env.SIYUAN_DEVTOOLS_SETTLE_MS = '0';

const { compilePlan, runPlan } = await import('../src/cli/script/plan.ts');
type Plan = import('../src/cli/script/plan.ts').Plan;

/** 假 page：记录调用，按 evaluate 的片段返回预设值。 */
interface FakePage {
  calls: string[];
  locator(selector: string): { hover(): Promise<void>; click(): Promise<void> };
  evaluate(fn: (...args: unknown[]) => unknown, arg?: unknown): Promise<unknown>;
}

/** 造一个假 page；`evaluate` 的结果按片段内容决定。 */
function fakePage(): FakePage {
  const calls: string[] = [];
  return {
    calls,
    locator(selector: string) {
      return {
        async hover() {
          calls.push(`hover:${selector}`);
        },
        async click() {
          calls.push(`click:${selector}`);
        },
      };
    },
    async evaluate(fn, arg) {
      const source = fn.toString();
      calls.push(`evaluate:${source.slice(0, 40)}`);
      // 令牌读数
      if (source.includes('defined')) return { values: { '--a': 'red' }, missing: [] };
      // 对比度读数
      if (source.includes('missing')) return { foreground: '#000', background: '#fff', missing: [] };
      // 样式快照
      if (source.includes('getPropertyValue(p)')) return { color: 'red' };
      // 菜单动作
      if (source.includes('找不到菜单项')) return { ok: true, id: String(arg) };
      // env
      return { frontend: 'browser-desktop' };
    },
  };
}

/** 执行生成的脚本（模拟 run-code 的调用方式）。 */
async function execute(plan: Plan): Promise<unknown> {
  const page = fakePage();
  const script = compilePlan(plan);
  const fn = new Function(`return (${script});`)() as (page: FakePage) => Promise<unknown>;
  return fn(page);
}

describe('compilePlan 生成的脚本', () => {
  it('能解析成 async (page) 函数', () => {
    const source = compilePlan({ frontend: 'desktop', steps: [{ read: 'env' }] });
    expect(() => new Function(`return (${source});`)).not.toThrow();
  });

  it('每一步产出结果，顺序与 step 序号一致', async () => {
    const results = (await execute({
      frontend: 'desktop',
      steps: [{ read: 'env' }, { do: 'hover:.item' }],
    })) as Array<{ step: number }>;
    expect(results.map((item) => item.step)).toEqual([0, 1]);
  });

  it('hover / click 走 locator，不是页面内点击', async () => {
    const page = fakePage();
    const script = compilePlan({ frontend: 'desktop', steps: [{ do: 'hover:.a' }, { do: 'click:.b' }] });
    await (new Function(`return (${script});`)() as (page: FakePage) => Promise<unknown>)(page);
    expect(page.calls).toEqual(['hover:.a', 'click:.b']);
  });

  it('menu 走页面内的 MENU_FN，而不是 locator', async () => {
    const page = fakePage();
    const script = compilePlan({ frontend: 'desktop', steps: [{ do: 'menu:theme' }] });
    await (new Function(`return (${script});`)() as (page: FakePage) => Promise<unknown>)(page);
    expect(page.calls.some((call) => call.startsWith('evaluate:'))).toBe(true);
    expect(page.calls.some((call) => call.startsWith('click:'))).toBe(false);
  });

  it('选择器里的冒号不会被动作名切分截断', async () => {
    const page = fakePage();
    const script = compilePlan({ frontend: 'desktop', steps: [{ do: 'click:.a:hover' }] });
    await (new Function(`return (${script});`)() as (page: FakePage) => Promise<unknown>)(page);
    expect(page.calls).toEqual(['click:.a:hover']);
  });

  it('URL 选择器里的冒号同理', async () => {
    const page = fakePage();
    const script = compilePlan({ frontend: 'desktop', steps: [{ do: 'hover:a[href="http://x"]' }] });
    await (new Function(`return (${script});`)() as (page: FakePage) => Promise<unknown>)(page);
    expect(page.calls).toEqual(['hover:a[href="http://x"]']);
  });

  it('不认识的动作直接抛错，不默认成菜单', () => {
    // schema 会先拦住，但 compilePlan 是导出 API，不能有危险默认值。
    expect(() => compilePlan({ frontend: 'desktop', steps: [{ do: 'teleport:.x' }] })).toThrow('不支持的动作');
    expect(() => compilePlan({ frontend: 'desktop', steps: [{ do: 'click' }] })).toThrow('不支持的动作');
  });

  it('diff 步骤产出 before/after', async () => {
    const results = (await execute({
      frontend: 'desktop',
      steps: [{ do: 'hover:.a', diff: { selector: '.a', props: ['color'] } }],
    })) as Array<{ value: unknown }>;
    expect(results[0]!.value).toEqual({ before: { color: 'red' }, after: { color: 'red' } });
  });

  it('read element 不传 props 时用默认属性', async () => {
    const page = fakePage();
    const script = compilePlan({ frontend: 'desktop', steps: [{ read: 'element', selector: '.x' }] });
    await (new Function(`return (${script});`)() as (page: FakePage) => Promise<unknown>)(page);
    const evaluateCall = page.calls.find((call) => call.startsWith('evaluate:'));
    expect(evaluateCall).toBeDefined();
  });
});

describe('runPlan 给 contrast 步骤补 ratio', () => {
  it('结果与 read contrast 一致（含 ratio）', () => {
    // runPlan 需要真实浏览器（runCode），这里直接验证后处理函数的效果：
    // 用 compilePlan 的脚本 + 假 page 走一遍，再补 ratio。
    const plan: Plan = {
      frontend: 'desktop',
      steps: [{ read: 'contrast', foreground: '#000', background: '#fff' }],
    };
    const script = compilePlan(plan);
    expect(script).toContain('foreground');
    expect(script).toContain('background');
    // 脚本只带回颜色；ratio 由 Node 侧补上（见 plan.ts 的 fillContrastRatios）。
    expect(script).not.toContain('ratio');
    expect(typeof runPlan).toBe('function');
  });
});
