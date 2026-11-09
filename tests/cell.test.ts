/**
 * 测量格：解析、合法域与矩阵渲染。
 *
 * 这里的价值是**边界**：哪些格存在（mobile × compact 不存在）、哪些写法
 * 非法、表怎么折叠。跑错格给的是一张看起来合理的假数据，比报错更糟。
 */
import { describe, expect, it } from 'vitest';
import { CELLS, cellLabel, expandAxes, parseAt, renderMatrix } from '../src/cli/cell.ts';

describe('合法域', () => {
  it('只有 6 格：desktop 4 格 + mobile 2 格', () => {
    expect(CELLS.map(cellLabel)).toEqual([
      'desktop/light/default',
      'desktop/light/compact',
      'desktop/dark/default',
      'desktop/dark/compact',
      'mobile/light/default',
      'mobile/dark/default',
    ]);
  });

  it('mobile × compact 不在合法域里', () => {
    expect(CELLS.some((cell) => cell.frontend === 'mobile' && cell.density === 'compact')).toBe(false);
  });
});

describe('parseAt', () => {
  it('all 展开成 6 格并说明跳过原因', () => {
    const spec = parseAt('all');
    expect(spec.cells).toHaveLength(6);
    expect(spec.skipped.join()).toContain('mobile');
  });

  it('完整格只解析出一格', () => {
    expect(parseAt('desktop/dark/compact').cells.map(cellLabel)).toEqual(['desktop/dark/compact']);
  });

  it('省略密度时展开该前端的两个密度', () => {
    expect(parseAt('desktop/dark').cells.map(cellLabel)).toEqual([
      'desktop/dark/default',
      'desktop/dark/compact',
    ]);
  });

  it('省略后两段时展开该前端全部合法格', () => {
    expect(parseAt('mobile').cells.map(cellLabel)).toEqual(['mobile/light/default', 'mobile/dark/default']);
  });

  it('mobile/compact 被跳过而不是产出一个假格', () => {
    // 只请求这一格时没有可测的格，必须报错并说明原因——不能返回空表。
    expect(() => parseAt('mobile/light/compact')).toThrow('上游移动端没有紧凑模式');
  });

  it('全部被跳过时报错', () => {
    expect(() => parseAt('mobile/light/compact,mobile/dark/compact')).toThrow('没有展开出任何格');
  });

  it('逗号列表按输入顺序展开并去重', () => {
    expect(parseAt('desktop/dark,desktop/dark/default').cells.map(cellLabel)).toEqual([
      'desktop/dark/default',
      'desktop/dark/compact',
    ]);
  });

  it('comfortable 有专门提示，指向 default', () => {
    expect(() => parseAt('desktop/light/comfortable')).toThrow('请用 default');
  });

  it('拼错的前端/明暗/密度报错，不静默回退', () => {
    expect(() => parseAt('pad/light/default')).toThrow('前端不合法');
    expect(() => parseAt('desktop/medium/default')).toThrow('明暗不合法');
    expect(() => parseAt('desktop/light/loose')).toThrow('密度不合法');
    expect(() => parseAt('desktop/light/default/x')).toThrow('段数太多');
    expect(() => parseAt('')).toThrow('不能为空');
  });
});

describe('expandAxes', () => {
  it('缺省轴取全部合法值', () => {
    expect(expandAxes({}).cells).toHaveLength(6);
  });

  it('指定 frontend 与 theme 时只展开存在的密度', () => {
    expect(expandAxes({ frontend: ['mobile'], theme: ['dark'] }).cells.map(cellLabel)).toEqual([
      'mobile/dark/default',
    ]);
  });

  it('显式请求 mobile+compact 时整份 axes 报错并说明原因', () => {
    // 只请求不存在的组合：没有任何格可跑，必须报错而不是静默返回空表。
    expect(() => expandAxes({ frontend: ['mobile'], theme: ['light'], density: ['compact'] })).toThrow(
      '上游移动端没有紧凑模式'
    );
    expect(() => expandAxes({ frontend: ['mobile'], density: ['compact'] })).toThrow('没有展开出任何格');
  });

  it('部分组合不存在时跳过并保留其余格', () => {
    const spec = expandAxes({ frontend: ['desktop', 'mobile'], density: ['compact'] });
    expect(spec.cells.map(cellLabel)).toEqual(['desktop/light/compact', 'desktop/dark/compact']);
    expect(spec.skipped.join()).toContain('mobile');
  });
});

describe('renderMatrix', () => {
  it('相同的列折叠进 same，变化的列留在表里', () => {
    const table = renderMatrix(
      [{ label: 'brand', path: 'brand' }, { label: 'bg', path: 'bg' }],
      [
        { at: 'desktop/light/default', value: { brand: 'blue', bg: '#fff' } },
        { at: 'desktop/dark/default', value: { brand: 'blue', bg: '#111' } },
      ]
    );
    expect(table.cells).toEqual(['desktop/light/default', 'desktop/dark/default']);
    expect(table.columns).toEqual(['bg']);
    expect(table.rows).toEqual([['#fff'], ['#111']]);
    expect(table.same).toEqual({ brand: 'blue' });
  });

  it('点路径能取到嵌套值，缺失给 null', () => {
    const table = renderMatrix(
      [{ label: 'color', path: 'styles.color' }, { label: 'missing', path: 'styles.missing' }],
      [{ at: 'a', value: { styles: { color: 'red' } } }, { at: 'b', value: { styles: { color: 'blue' } } }]
    );
    expect(table.columns).toEqual(['color']);
    expect(table.rows).toEqual([['red'], ['blue']]);
  });

  it('数组下标也能取（--box 的首个 box）', () => {
    const table = renderMatrix(
      [{ label: 'width', path: 'boxes.0.width' }],
      [
        { at: 'a', value: { boxes: [{ width: 28 }] } },
        { at: 'b', value: { boxes: [{ width: 24 }] } },
      ]
    );
    expect(table.rows).toEqual([[28], [24]]);
  });

  it('所有列都相同时 rows 是空数组但 same 保留结论', () => {
    const table = renderMatrix([{ label: 'color', path: 'color' }], [
      { at: 'a', value: { color: 'red' } },
      { at: 'b', value: { color: 'red' } },
    ]);
    expect(table.columns).toEqual([]);
    expect(table.rows).toEqual([[], []]);
    expect(table.same).toEqual({ color: 'red' });
  });
});
