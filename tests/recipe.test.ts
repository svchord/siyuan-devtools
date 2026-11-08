/**
 * 生成的页面片段：形状正确、能独立解析。
 *
 * `eval` 用自执行表达式，`audit` 的 run-code 用函数体；两者都从 recipe.ts 取，
 * 不该各写一份。
 */
import { describe, expect, it } from 'vitest';
import { elementFn, ENV_FN, evalExpr, styleOfFn, TOKENS_FN } from '../src/cli/script/recipe.ts';

/** 片段必须是可被 eval 的表达式。 */
function assertParses(source: string): void {
  expect(() => new Function(`return (${source});`)).not.toThrow();
}

describe('函数体（给 page.evaluate 用）', () => {
  it('env', () => assertParses(ENV_FN));
  it('tokens', () => assertParses(TOKENS_FN));
  it('element', () => assertParses(elementFn('.x', ['color'], true, 3)));
  it('styleOf', () => assertParses(styleOfFn('.x', ['color'])));
});

describe('evalExpr（给 cli --raw eval 用）', () => {
  it('无参函数包成自执行', () => {
    const expr = evalExpr(ENV_FN);
    expect(expr.startsWith('(')).toBe(true);
    expect(expr.endsWith(')()')).toBe(true);
    assertParses(expr);
  });

  it('带参函数把参数内联', () => {
    const expr = evalExpr(TOKENS_FN, ['--brand-8']);
    expect(expr).toContain('--brand-8');
    assertParses(expr);
  });
});

describe('element 片段', () => {
  it('把选择器与属性内联进去', () => {
    const source = elementFn('.b3-menu__item', ['color', 'background-color'], false, 5);
    expect(source).toContain('.b3-menu__item');
    expect(source).toContain('background-color');
    expect(source).not.toContain('boxes');
  });

  it('--box 时才输出 boxes', () => {
    expect(elementFn('.x', ['color'], true, 3)).toContain('out.boxes');
  });
});
