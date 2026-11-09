/**
 * 页面片段：**在假的 DOM 上真的执行**，断言行为而不是源码字符串。
 *
 * 旧版本这里全是 `toContain('missing')` 之类的文本断言：把 `missing.push(...)`
 * 删掉、只留变量名，测试照样全绿。现在每个片段都在 `new Function` 里跑一遍，
 * 用最小假 DOM 喂输入、检查输出。
 */
import { describe, expect, it } from 'vitest';
import {
  ATTR_FN,
  contrastFn,
  DEFAULT_ELEMENT_PROPS,
  dockFn,
  elementFn,
  ENV_FN,
  evalExpr,
  MENU_FN,
  RESET_FN,
  styleOfFn,
  TOKENS_FN,
} from '../src/cli/script/recipe.ts';

// ---- 最小假 DOM ----

/** 一个可配置的假元素。 */
interface FakeElement {
  tagName: string;
  attributes: Record<string, string>;
  style: Record<string, string>;
  rect: { x: number; y: number; width: number; height: number };
  clicked: number;
  getAttribute(name: string): string | null;
  getAttributeNames(): string[];
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  getBoundingClientRect(): { x: number; y: number; width: number; height: number };
  click(): void;
}

/** 造一个假元素。 */
function element(tagName: string, attributes: Record<string, string> = {}, style: Record<string, string> = {}): FakeElement {
  const el: FakeElement = {
    tagName: tagName.toUpperCase(),
    attributes: { ...attributes },
    style,
    rect: { x: 8, y: 8, width: 200, height: 40 },
    clicked: 0,
    getAttribute(name) {
      return el.attributes[name] ?? null;
    },
    getAttributeNames() {
      return Object.keys(el.attributes);
    },
    setAttribute(name, value) {
      el.attributes[name] = value;
    },
    removeAttribute(name) {
      delete el.attributes[name];
    },
    getBoundingClientRect() {
      return el.rect;
    },
    click() {
      el.clicked += 1;
    },
  };
  return el;
}

/** 装一个最小 window/document，跑完还原。 */
function withDom<T>(setup: { root?: FakeElement; all?: FakeElement[]; bySelector?: Record<string, FakeElement[]>; menu?: unknown }, run: () => T): T {
  const root = setup.root ?? element('html');
  const all = setup.all ?? [];
  const bySelector = setup.bySelector ?? {};
  const globals = globalThis as unknown as Record<string, unknown>;
  const saved = {
    document: globals.document,
    window: globals.window,
    getComputedStyle: globals.getComputedStyle,
  };
  const documentStub = {
    documentElement: root,
    body: element('body'),
    querySelector(selector: string) {
      if (selector in bySelector) return bySelector[selector]![0] ?? null;
      return all.find((el) => matches(el, selector)) ?? null;
    },
    querySelectorAll(selector: string) {
      if (selector === '*') return all;
      if (selector in bySelector) return bySelector[selector]!;
      return all.filter((el) => matches(el, selector));
    },
    getElementById(id: string) {
      return all.find((el) => el.attributes.id === id) ?? null;
    },
  };
  globals.document = documentStub;
  globals.window = { siyuan: { config: {}, menus: { menu: setup.menu } } };
  globals.getComputedStyle = (el: FakeElement) => {
    // 真实 CSSStyleDeclaration 既支持 `style[i]` 索引访问，也支持按名取值；
    // TOKENS_FN 靠索引枚举所有已定义的自定义属性。
    const names = Object.keys(el.style);
    const style: Record<string | number, unknown> = {
      ...el.style,
      display: el.style.display ?? 'block',
      visibility: el.style.visibility ?? 'visible',
      opacity: el.style.opacity ?? '1',
      length: names.length,
      getPropertyValue(name: string) {
        return el.style[name] ?? '';
      },
    };
    names.forEach((name, index) => {
      style[index] = name;
    });
    return style;
  };
  try {
    return run();
  } finally {
    globals.document = saved.document;
    globals.window = saved.window;
    globals.getComputedStyle = saved.getComputedStyle;
  }
}

/** 只支持测试用到的几种选择器。 */
function matches(el: FakeElement, selector: string): boolean {
  const attr = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(selector);
  if (attr) {
    const value = el.attributes[attr[1]!];
    return attr[2] === undefined ? value !== undefined : value === attr[2];
  }
  const classSel = /^\.([\w-]+)$/.exec(selector);
  if (classSel) return (el.attributes.class ?? '').split(/\s+/).includes(classSel[1]!);
  if (selector.startsWith('#')) return el.attributes.id === selector.slice(1);
  return el.tagName.toLowerCase() === selector.toLowerCase();
}

/** 把片段源码变成可调用函数。 */
function load(source: string): (...args: unknown[]) => unknown {
  return new Function(`return (${source});`)() as (...args: unknown[]) => unknown;
}

/** 片段必须能被解析成表达式。 */
function assertParses(source: string): void {
  expect(() => new Function(`return (${source});`)).not.toThrow();
}

describe('片段可解析', () => {
  it.each([
    ['env', ENV_FN],
    ['tokens', TOKENS_FN],
    ['element', elementFn('.x', ['color'], true, 3)],
    ['styleOf', styleOfFn('.x', ['color'])],
    ['menu', MENU_FN],
    ['dock', dockFn('outline')],
    ['attr', ATTR_FN],
    ['reset', RESET_FN],
    ['contrast', contrastFn('--a', '--b')],
  ])('%s', (_name, source) => assertParses(source));
});

describe('evalExpr', () => {
  it('无参函数包成自执行，带参函数内联参数', () => {
    expect(evalExpr(ENV_FN)).toMatch(/^\([\s\S]*\)\(\)$/);
    expect(evalExpr(TOKENS_FN, ['--brand-8'])).toContain('--brand-8');
    assertParses(evalExpr(TOKENS_FN, ['--brand-8']));
  });
});

describe('TOKENS_FN 的行为', () => {
  it('区分「未定义」与「定义了但值为空」', () => {
    const root = element('html');
    const result = withDom({ root, bySelector: { ':root': [root] } }, () => {
      // getComputedStyle(document.documentElement) 需要 style 里有令牌
      root.style['--defined'] = 'red';
      root.style['--empty'] = '';
      return load(TOKENS_FN)(['--defined', '--empty', '--missing']) as {
        values: Record<string, string>;
        missing: string[];
      };
    });
    expect(result.values['--defined']).toBe('red');
    expect(result.values['--empty']).toBe('');
    expect(result.missing).toEqual(['--missing']);
  });
});

describe('contrastFn 的行为', () => {
  it('未定义令牌进 missing，已定义的返回值', () => {
    const root = element('html');
    root.style['--bg'] = 'rgb(255, 255, 255)';
    const result = withDom({ root }, () => load(contrastFn('--typo', '--bg'))() as Record<string, unknown>);
    expect(result.foreground).toBe('');
    expect(result.background).toBe('rgb(255, 255, 255)');
    expect(result.missing).toEqual(['--typo']);
  });

  it('字面量颜色不进 missing', () => {
    const result = withDom({}, () => load(contrastFn('#fff', '#000'))() as { missing: string[] });
    expect(result.missing).toEqual([]);
  });
});

describe('elementFn 的行为', () => {
  it('找不到元素时 found=false 且不抛错', () => {
    const result = withDom({ all: [] }, () => load(elementFn('.nope', ['color'], false, 5))() as Record<string, unknown>);
    expect(result).toMatchObject({ found: false, count: 0, visible: 0, tag: null, styles: {} });
  });

  it('优先取可见元素，并读出属性值', () => {
    const hidden = element('div', { class: 'item' }, { display: 'none', color: 'rgb(0, 0, 255)' });
    const shown = element('div', { class: 'item' }, { color: 'rgb(255, 0, 0)' });
    const result = withDom({ all: [hidden, shown] }, () =>
      load(elementFn('.item', ['color'], false, 5))()
    ) as Record<string, unknown>;
    expect(result).toMatchObject({ found: true, count: 2, visible: 1, tag: 'div' });
    expect((result.styles as Record<string, string>).color).toBe('rgb(255, 0, 0)');
  });

  it('--box 时输出可见元素的尺寸，且不含恒等于下标的 index', () => {
    const a = element('div', { class: 'item' });
    const result = withDom({ all: [a] }, () => load(elementFn('.item', ['color'], true, 5))() as Record<string, unknown>);
    expect(result.boxes).toEqual([{ x: 8, y: 8, width: 200, height: 40 }]);
  });

  it('默认属性只有一处定义', () => {
    expect([...DEFAULT_ELEMENT_PROPS]).toEqual(['color', 'background-color']);
  });
});

describe('MENU_FN 的行为', () => {
  it('点击 data-menu-id 命中的元素', () => {
    const target = element('div', { 'data-menu-id': 'theme' });
    const result = withDom({ bySelector: { '[data-menu-id="theme"]': [target] } }, () =>
      load(MENU_FN)('theme')
    ) as Record<string, unknown>;
    expect(result).toEqual({ ok: true, id: 'theme' });
    expect(target.clicked).toBe(1);
  });

  it('不会点到只有 data-id 的无关元素（旧实现会）', () => {
    const decoy = element('div', { id: 'decoy', 'data-id': 'theme' });
    const result = withDom({ all: [decoy] }, () => load(MENU_FN)('theme')) as Record<string, unknown>;
    expect(result.ok).toBe(false);
    expect(decoy.clicked).toBe(0);
  });

  it('找不到时返回 ok:false 与原因', () => {
    const result = withDom({}, () => load(MENU_FN)('nope')) as Record<string, unknown>;
    expect(result.ok).toBe(false);
    expect(String(result.reason)).toContain('找不到菜单项');
  });

  it('id 里有引号/空格也不会拼出非法选择器', () => {
    const target = element('div', { 'data-menu-id': 'a b' });
    const result = withDom({ bySelector: { '[data-menu-id="a\\ b"]': [target] } }, () => load(MENU_FN)('a b'));
    expect(result).toBeDefined();
  });
});

describe('dockFn 的行为', () => {
  it('type 里的引号不会抛 SyntaxError，而是查不到就返回 ok:false', () => {
    const result = withDom({ all: [] }, () => load(dockFn('x"]'))()) as Record<string, unknown>;
    expect(result.ok).toBe(false);
    expect(String(result.reason)).toContain('找不到停靠项');
  });

  it('命中停靠项时点击', () => {
    const target = element('div', { class: 'dock__item', 'data-type': 'outline' });
    const result = withDom({ bySelector: { '.dock__item[data-type="outline"]': [target] } }, () =>
      load(dockFn('outline'))()
    ) as Record<string, unknown>;
    expect(result).toEqual({ ok: true });
    expect(target.clicked).toBe(1);
  });
});

describe('ATTR_FN 的行为', () => {
  it('有值时设置属性', () => {
    const root = element('html');
    const result = withDom({ root }, () => load(ATTR_FN)(['data-theme-mode', 'dark'])) as Record<string, unknown>;
    expect(result.ok).toBe(true);
    expect(root.attributes['data-theme-mode']).toBe('dark');
  });

  it('null 时删除属性', () => {
    const root = element('html', { 'data-x': '1' });
    withDom({ root }, () => load(ATTR_FN)(['data-x', null]));
    expect(root.attributes['data-x']).toBeUndefined();
  });

  it('空属性名返回 ok:false，不抛 InvalidCharacterError', () => {
    const result = withDom({}, () => load(ATTR_FN)(['', 'x'])) as Record<string, unknown>;
    expect(result.ok).toBe(false);
  });
});

describe('RESET_FN 的行为', () => {
  it('恢复快照里的属性并删掉多出来的', () => {
    const root = element('html', { 'data-theme-mode': 'dark', 'data-extra': '1' });
    (globalThis as unknown as Record<string, unknown>).window = {
      __siyuanDevtoolsRootAttrs: { 'data-theme-mode': 'light' },
      siyuan: { menus: { menu: { remove() {} } } },
    };
    const globals = globalThis as unknown as Record<string, unknown>;
    const savedDocument = globals.document;
    globals.document = { documentElement: root };
    try {
      const result = load(RESET_FN)() as Record<string, unknown>;
      expect(root.attributes['data-theme-mode']).toBe('light');
      expect(root.attributes['data-extra']).toBeUndefined();
      expect(result).toEqual({ ok: true, restored: true });
    } finally {
      globals.document = savedDocument;
      delete globals.window;
    }
  });

  it('menus.menu 没有 remove 时不抛错', () => {
    const root = element('html');
    const globals = globalThis as unknown as Record<string, unknown>;
    const savedDocument = globals.document;
    globals.document = { documentElement: root };
    globals.window = { siyuan: { menus: { menu: {} } } };
    try {
      expect(() => load(RESET_FN)()).not.toThrow();
    } finally {
      globals.document = savedDocument;
      delete globals.window;
    }
  });
});

describe('ENV_FN 的行为', () => {
  it('读出前端/主题/视口等字段', () => {
    const root = element('html', {
      'data-frontend': 'browser-desktop',
      'data-backend': 'browser',
      'data-theme-mode': 'dark',
      'data-ui-density': 'compact',
    });
    const globals = globalThis as unknown as Record<string, unknown>;
    const saved = { document: globals.document, window: globals.window, innerWidth: globals.innerWidth };
    globals.document = { documentElement: root, querySelectorAll: () => [], getElementById: () => null };
    globals.window = { siyuan: { config: {} } };
    globals.innerWidth = 1600;
    globals.innerHeight = 1000;
    globals.devicePixelRatio = 2;
    globals.location = { href: 'http://x/' };
    try {
      const result = load(ENV_FN)() as Record<string, unknown>;
      expect(result).toMatchObject({
        frontend: 'browser-desktop',
        backend: 'browser',
        themeMode: 'dark',
        uiDensity: 'compact',
        themeStyle: null,
        pluginsStyle: [],
        url: 'http://x/',
        domNodes: 0,
      });
      expect(result.viewport).toEqual({ width: 1600, height: 1000, dpr: 2 });
    } finally {
      globals.document = saved.document;
      globals.window = saved.window;
      globals.innerWidth = saved.innerWidth;
      delete globals.innerHeight;
      delete globals.devicePixelRatio;
      delete globals.location;
    }
  });
});
