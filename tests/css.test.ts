/** CSS 属性名规范化：camelCase 会被转成 kebab-case，非法名字报错。 */
import { describe, expect, it } from 'vitest';
import { parseProps } from '../src/cli/css.ts';

const FALLBACK = ['color', 'background-color'] as const;

describe('parseProps', () => {
  it('未传返回默认属性', () => {
    expect(parseProps(undefined, FALLBACK)).toEqual([...FALLBACK]);
  });

  it('拆逗号并去空白', () => {
    expect(parseProps(' color , background-color ', FALLBACK)).toEqual(['color', 'background-color']);
  });

  it('camelCase 转成 kebab-case', () => {
    // getPropertyValue('backgroundColor') 返回空字符串，和「属性值为空」无法区分。
    expect(parseProps('backgroundColor,fontSize', FALLBACK)).toEqual(['background-color', 'font-size']);
  });

  it('CSS 自定义属性名保持原样', () => {
    expect(parseProps('--rc-brand-8', FALLBACK)).toEqual(['--rc-brand-8']);
  });

  it('空值报错，而不是静默退回默认值', () => {
    expect(() => parseProps('', FALLBACK)).toThrow('不能为空');
    expect(() => parseProps(' , ', FALLBACK)).toThrow('不能为空');
  });

  it('非法名字报错', () => {
    expect(() => parseProps('col or', FALLBACK)).toThrow('不合法');
    expect(() => parseProps('1color', FALLBACK)).toThrow('不合法');
  });
});
