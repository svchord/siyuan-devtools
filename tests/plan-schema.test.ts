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
});
