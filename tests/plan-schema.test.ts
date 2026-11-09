/**
 * 计划 schema：合法形状通过，常见写法错误在开浏览器之前就报出来。
 */
import { describe, expect, it } from 'vitest';
import { parsePlan } from '../src/cli/script/plan-schema.ts';

const VALID = {
  frontend: 'desktop',
  steps: [{ read: 'env' }, { do: 'hover:.b3-menu__item' }],
};

/** 取第一条错误，方便断言文案。 */
function firstError(data: unknown): string {
  const result = parsePlan(data);
  if (result.ok) throw new Error('期望校验失败，但通过了');
  return result.errors[0]!;
}

describe('parsePlan', () => {
  it('合法计划通过', () => {
    const result = parsePlan(VALID);
    expect(result.ok).toBe(true);
  });

  it('frontend 取值不对时报错', () => {
    expect(firstError({ ...VALID, frontend: 'tablet' })).toContain('frontend');
  });

  it('steps 不是数组时报错', () => {
    expect(firstError({ ...VALID, steps: 'nope' })).toContain('steps 必须是数组');
  });

  it('steps 为空时报错', () => {
    expect(firstError({ ...VALID, steps: [] })).toContain('steps 不能为空');
  });

  it('步骤既没有 read 也没有 do 时报错', () => {
    expect(firstError({ ...VALID, steps: [{ selector: '.x' }] })).toContain('每一步必须有 read 或 do');
  });

  it('步骤同时有 read 和 do 时报错', () => {
    expect(firstError({ ...VALID, steps: [{ read: 'env', do: 'hover:.x' }] })).toContain('只能有 read 或 do 之一');
  });

  it('read 取值不对时报错', () => {
    expect(firstError({ ...VALID, steps: [{ read: 'styles' }] })).toContain('read');
  });

  it('未知字段报错，不静默忽略', () => {
    // props 拼成 propss 会被静默剥掉，读数退回默认值——必须报出来
    const message = firstError({
      ...VALID,
      steps: [{ read: 'element', selector: '.x', propss: ['color'] }],
    });
    expect(message).toContain('未知字段');
    expect(message).toContain('propss');
  });

  it('根级未知字段也报错', () => {
    const message = firstError({ ...VALID, frontendd: 'desktop' });
    expect(message).toContain('未知字段');
    expect(message).toContain('frontendd');
  });

  it('limit 必须是正整数', () => {
    expect(firstError({ ...VALID, steps: [{ read: 'element', selector: '.x', limit: 0 }] })).toContain('limit');
    expect(firstError({ ...VALID, steps: [{ read: 'element', selector: '.x', limit: 1.5 }] })).toContain('limit');
  });

  it('一次给出全部问题，不用逐个试', () => {
    const result = parsePlan({
      frontend: 'tablet',
      steps: [{ read: 'styles' }, { selector: '.x' }],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });

  it('错误信息带位置', () => {
    const message = firstError({ ...VALID, steps: [{ read: 'env' }, { read: 'element', selector: 1 }] });
    expect(message).toContain('steps[1]');
  });

  it('read element 缺 selector 报错', () => {
    expect(firstError({ ...VALID, steps: [{ read: 'element' }] })).toContain('selector');
  });

  it('read tokens 缺 names 报错', () => {
    expect(firstError({ ...VALID, steps: [{ read: 'tokens' }] })).toContain('names');
  });

  it('read contrast 缺前景/背景报错', () => {
    const result = parsePlan({ ...VALID, steps: [{ read: 'contrast' }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toContain('foreground');
  });

  it('do 必须是受支持的动作格式', () => {
    expect(firstError({ ...VALID, steps: [{ do: 'teleport:.x' }] })).toContain('hover:<selector>');
    expect(firstError({ ...VALID, steps: [{ do: 'click' }] })).toContain('hover:<selector>');
  });

  it('diff.props 不能为空', () => {
    expect(firstError({ ...VALID, steps: [{ do: 'hover:.x', diff: { selector: '.x', props: [] } }] })).toContain('diff.props');
  });

  it('limit 必须与 box 一起用（与 CLI 语义一致）', () => {
    expect(firstError({ ...VALID, steps: [{ read: 'element', selector: '.x', limit: 3 }] })).toContain('box');
    expect(parsePlan({ ...VALID, steps: [{ read: 'element', selector: '.x', box: true, limit: 3 }] }).ok).toBe(true);
  });

  /**
   * `.strict()` 只防「拼错」，不防「放错步骤」：字段名合法、但该步骤根本不读它，
   * 编译时会被静默忽略。这些用例锁住逐字段的归属校验。
   */
  it('字段放错步骤时报错，而不是静默忽略', () => {
    const cases: Array<[string, Record<string, unknown>]> = [
      ['selector', { read: 'env', selector: '.x' }],
      ['props', { read: 'env', props: ['color'] }],
      ['names', { read: 'element', selector: '.x', names: ['--a'] }],
      ['foreground', { read: 'env', foreground: '--a' }],
      ['selector', { do: 'hover:.x', selector: '.y' }],
      ['names', { do: 'hover:.x', names: ['--a'] }],
    ];
    for (const [field, step] of cases) {
      const message = firstError({ ...VALID, steps: [step] });
      expect(message, JSON.stringify(step)).toContain(field);
      expect(message, JSON.stringify(step)).toContain('静默忽略');
    }
  });

  it('props 内容在 schema 阶段就校验（不是开了浏览器才报错）', () => {
    expect(firstError({ ...VALID, steps: [{ read: 'element', selector: '.x', props: ['col or'] }] })).toContain('不合法');
    expect(firstError({ ...VALID, steps: [{ read: 'element', selector: '.x', props: [] }] })).toContain('不能为空');
    // camelCase 是合法的，会被规范化
    expect(parsePlan({ ...VALID, steps: [{ read: 'element', selector: '.x', props: ['backgroundColor'] }] }).ok).toBe(true);
  });

  it('厂商前缀属性是合法的', () => {
    expect(
      parsePlan({ ...VALID, steps: [{ read: 'element', selector: '.x', props: ['-webkit-text-fill-color'] }] }).ok
    ).toBe(true);
  });

  it('diff 只能用于 do 步骤', () => {
    expect(firstError({ ...VALID, steps: [{ read: 'env', diff: { selector: '.x', props: ['color'] } }] })).toContain('diff');
  });

  it('viewport 必须是正数宽高', () => {
    expect(firstError({ ...VALID, viewport: '0x0' })).toContain('viewport');
    expect(parsePlan({ ...VALID, viewport: '390x844' }).ok).toBe(true);
  });
});
