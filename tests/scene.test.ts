/**
 * 场景（Scene）：解析、合法域与矩阵渲染。
 *
 * 这是工具里唯一的“测什么模式”定义：`--at`、计划 axes、截图文件名都走它。
 * 跑错格给的是一张看起来合理的假数据，比报错更糟——所以边界优先。
 */
import { describe, expect, it } from 'vitest';
import { SCENES, expandAxes, parseAt, sceneFile, sceneLabel } from '../src/cli/scene.ts';
import { renderMatrix } from '../src/cli/matrix.ts';

describe('合法域', () => {
  it('只有 6 格：desktop 4 格 + mobile 2 格', () => {
    expect(SCENES.map(sceneLabel)).toEqual([
      'desktop/light/default',
      'desktop/light/compact',
      'desktop/dark/default',
      'desktop/dark/compact',
      'mobile/light/default',
      'mobile/dark/default',
    ]);
  });

  it('mobile × compact 不在合法域里', () => {
    expect(SCENES.some((scene) => scene.frontend === 'mobile' && scene.density === 'compact')).toBe(false);
  });
});

describe('parseAt', () => {
  it('all 展开成 6 格并说明跳过原因', () => {
    const spec = parseAt('all');
    expect(spec.scenes).toHaveLength(6);
    expect(spec.skipped.join()).toContain('mobile');
  });

  it('完整格只解析出一格', () => {
    expect(parseAt('desktop/dark/compact').scenes.map(sceneLabel)).toEqual(['desktop/dark/compact']);
  });

  it('省略密度时展开该前端的两个密度', () => {
    expect(parseAt('desktop/dark').scenes.map(sceneLabel)).toEqual(['desktop/dark/default', 'desktop/dark/compact']);
  });

  it('省略后两段时展开该前端全部合法格', () => {
    expect(parseAt('mobile').scenes.map(sceneLabel)).toEqual(['mobile/light/default', 'mobile/dark/default']);
  });

  it('mobile/compact 被跳过而不是产出一个假格', () => {
    expect(() => parseAt('mobile/light/compact')).toThrow('上游移动端没有紧凑模式');
  });

  it('全部被跳过时报错', () => {
    expect(() => parseAt('mobile/light/compact,mobile/dark/compact')).toThrow('没有展开出任何场景');
  });

  it('逗号列表按输入顺序展开并去重', () => {
    expect(parseAt('desktop/dark,desktop/dark/default').scenes.map(sceneLabel)).toEqual([
      'desktop/dark/default',
      'desktop/dark/compact',
    ]);
  });

  it('附加属性写在第四段之后', () => {
    expect(parseAt('desktop/dark/default/data-rc-style=fluent').scenes.map(sceneLabel)).toEqual([
      'desktop/dark/default;data-rc-style=fluent',
    ]);
  });

  it('all 也可以带附加属性', () => {
    const spec = parseAt('all/data-rc-palette=shadcn');
    expect(spec.scenes).toHaveLength(6);
    expect(spec.scenes.every((scene) => scene.attrs['data-rc-palette'] === 'shadcn')).toBe(true);
  });

  it('comfortable 有专门提示，指向 default', () => {
    expect(() => parseAt('desktop/light/comfortable')).toThrow('请用 default');
  });

  it('拼错的前端/明暗/密度报错，不静默回退', () => {
    expect(() => parseAt('pad/light/default')).toThrow('前端不合法');
    expect(() => parseAt('desktop/medium/default')).toThrow('明暗不合法');
    expect(() => parseAt('desktop/light/loose')).toThrow('密度不合法');
    expect(() => parseAt('')).toThrow('不能为空');
  });
});

describe('expandAxes', () => {
  it('缺省轴取全部合法值', () => {
    expect(expandAxes({}).scenes).toHaveLength(6);
  });

  it('指定 frontend 与 theme 时只展开存在的密度', () => {
    expect(expandAxes({ frontend: ['mobile'], theme: ['dark'] }).scenes.map(sceneLabel)).toEqual(['mobile/dark/default']);
  });

  it('显式请求 mobile+compact 时整份 axes 报错并说明原因', () => {
    expect(() => expandAxes({ frontend: ['mobile'], theme: ['light'], density: ['compact'] })).toThrow(
      '上游移动端没有紧凑模式'
    );
    expect(() => expandAxes({ frontend: ['mobile'], density: ['compact'] })).toThrow('没有展开出任何场景');
  });

  it('部分组合不存在时跳过并保留其余格', () => {
    const spec = expandAxes({ frontend: ['desktop', 'mobile'], density: ['compact'] });
    expect(spec.scenes.map(sceneLabel)).toEqual(['desktop/light/compact', 'desktop/dark/compact']);
    expect(spec.skipped.join()).toContain('mobile');
  });

  it('attrs 按笛卡尔积展开', () => {
    const spec = expandAxes({
      frontend: ['desktop'],
      theme: ['light'],
      density: ['default'],
      attrs: { 'data-rc-style': ['material', 'fluent'], 'data-rc-palette': ['shadcn'] },
    });
    expect(spec.scenes.map(sceneLabel)).toEqual([
      'desktop/light/default;data-rc-palette=shadcn;data-rc-style=material',
      'desktop/light/default;data-rc-palette=shadcn;data-rc-style=fluent',
    ]);
  });
});

describe('sceneFile', () => {
  it('文件名带全部维度', () => {
    expect(sceneFile({ frontend: 'desktop', theme: 'dark', density: 'compact', attrs: {} })).toBe(
      'desktop-dark-compact.png'
    );
    expect(
      sceneFile({ frontend: 'mobile', theme: 'light', density: 'default', attrs: { 'data-rc-style': 'fluent' } })
    ).toContain('mobile-light-default-rc-style=fluent.png');
  });
});

describe('renderMatrix', () => {
  it('相同的列折叠进 same，变化的列留在表里', () => {
    const table = renderMatrix(
      [
        { label: 'brand', path: 'brand' },
        { label: 'bg', path: 'bg' },
      ],
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
      [
        { label: 'color', path: 'styles.color' },
        { label: 'missing', path: 'styles.missing' },
      ],
      [
        { at: 'a', value: { styles: { color: 'red' } } },
        { at: 'b', value: { styles: { color: 'blue' } } },
      ]
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
