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
  THEME_FN,
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
function matches(el: FakeElement, selector: string): boolean {  const attr = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(selector);
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

/**
 * THEME_FN 的假 DOM。
 *
 * 它只走「换 `<link>`、等 load、摘旧表」这条路径，所以假节点只需要 href、
 * cloneNode 与事件监听；`insertBefore` 记录顺序，`load` 用微任务模拟
 * 样式表加载完成——同步派发反而测不出真实时序。
 */
interface FakeLink {
  id: string;
  href: string;
  parent: FakeParent | null;
  /** THEME_FN 用 `old.parentNode` 判断能否插入/摘除。 */
  parentNode: FakeParent | null;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  cloneNode(deep: boolean): FakeLink;
  addEventListener(type: string, fn: () => void): void;
  removeEventListener(type: string, fn: () => void): void;
  remove(): void;
}

interface FakeParent {
  children: FakeLink[];
  insertBefore(node: FakeLink, before: FakeLink | null): void;
}

async function withThemeDom<T>(
  setup: {
    links?: ReadonlyArray<{ id: string; href: string }>;
    appearance?: { themeLight?: string; themeDark?: string };
    /** 主题名 → 该表生效后的 body 背景色；缺省表示换表不改变背景。 */
    backgrounds?: Record<string, string>;
    /** false 表示页面里没有 window.siyuan（早期初始化）。 */
    siyuan?: boolean;
  },
  run: (ctx: { root: FakeElement; links: () => FakeLink[]; background: () => string }) => Promise<T>
): Promise<T> {
  const root = element('html');
  const body = element('body');
  const parent: FakeParent = {
    children: [],
    insertBefore(node, before) {
      const index = before === null ? -1 : parent.children.indexOf(before);
      if (index === -1) parent.children.push(node);
      else parent.children.splice(index, 0, node);
      node.parent = parent;
      node.parentNode = parent;
    },
  };
  let background = 'rgb(255, 255, 255)';

  const make = (id: string, href: string): FakeLink => {
    const link: FakeLink = {
      id,
      href,
      parent: null,
      parentNode: null,
      getAttribute(name) {
        return name === 'href' ? link.href : name === 'id' ? link.id : null;
      },
      setAttribute(name, value) {
        if (name === 'href') link.href = value;
        if (name === 'id') link.id = value;
      },
      cloneNode() {
        // 真实 cloneNode(false) 复制属性，但不复制监听器与父子关系。
        return make(link.id, link.href);
      },
      addEventListener(type, fn) {
        if (type !== 'load') return;
        queueMicrotask(() => {
          const theme = /\/appearance\/themes\/([^/]+)\//.exec(link.href)?.[1];
          if (theme !== undefined && setup.backgrounds?.[theme] !== undefined) {
            background = setup.backgrounds[theme]!;
          }
          fn();
        });
      },
      removeEventListener() {},
      remove() {
        const index = parent.children.indexOf(link);
        if (index !== -1) parent.children.splice(index, 1);
        link.parent = null;
        link.parentNode = null;
      },
    };
    return link;
  };

  for (const { id, href } of setup.links ?? []) {
    const link = make(id, href);
    link.parent = parent;
    link.parentNode = parent;
    parent.children.push(link);
  }

  const globals = globalThis as unknown as Record<string, unknown>;
  const saved = {
    document: globals.document,
    window: globals.window,
    getComputedStyle: globals.getComputedStyle,
    requestAnimationFrame: globals.requestAnimationFrame,
  };
  globals.document = {
    documentElement: root,
    body,
    getElementById: (id: string) => parent.children.find((link) => link.id === id) ?? null,
  };
  globals.window =
    setup.siyuan === false ? {} : { siyuan: { config: { appearance: setup.appearance ?? {} } } };
  globals.getComputedStyle = (el: FakeElement) => ({
    backgroundColor: el === body ? background : 'rgba(0, 0, 0, 0)',
  });
  globals.requestAnimationFrame = (fn: (time: number) => void) => queueMicrotask(() => fn(0));
  try {
    return await run({ root, links: () => parent.children, background: () => background });
  } finally {
    globals.document = saved.document;
    globals.window = saved.window;
    globals.getComputedStyle = saved.getComputedStyle;
    globals.requestAnimationFrame = saved.requestAnimationFrame;
  }
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
    ['theme', THEME_FN],
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

  it('--box 时输出可见元素的尺寸（含 index）', () => {
    const a = element('div', { class: 'item' });
    const result = withDom({ all: [a] }, () => load(elementFn('.item', ['color'], true, 5))() as Record<string, unknown>);
    expect(result.boxes).toEqual([{ index: 0, x: 8, y: 8, width: 200, height: 40 }]);
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

/**
 * 只改 `data-theme-mode` 对内置 daylight/midnight 无效：两者的配色是两张
 * 独立的 CSS 文件。实测设 dark 后 `--b3-theme-background` 仍是 `#fff`，换成
 * midnight 的 `<link>` 才变 `#1e1e1e`。这里锁住「属性 + 换表」两件事。
 */
describe('THEME_FN 的行为', () => {
  const DAYLIGHT = 'http://127.0.0.1:8899/appearance/themes/daylight/theme.css?v=3.8.9';
  const MIDNIGHT = 'http://127.0.0.1:8899/appearance/themes/midnight/theme.css?v=3.8.9';

  it('设置 data-theme-mode 属性', async () => {
    await withThemeDom({ links: [{ id: 'themeDefaultStyle', href: DAYLIGHT }] }, async ({ root }) => {
      await load(THEME_FN)('dark');
      expect(root.attributes['data-theme-mode']).toBe('dark');
    });
  });

  it('daylight → midnight：href 被替换且 ?v= 查询串保留', async () => {
    await withThemeDom({ links: [{ id: 'themeDefaultStyle', href: DAYLIGHT }] }, async ({ links }) => {
      const result = (await load(THEME_FN)('dark')) as Record<string, unknown>;
      expect(result.ok).toBe(true);
      expect(result.defaultTheme).toBe('midnight');
      // 旧表被摘掉，只剩新表。
      expect(links()).toHaveLength(1);
      expect(links()[0]!.getAttribute('href')).toBe(MIDNIGHT);
    });
  });

  it('light 时切回 daylight', async () => {
    await withThemeDom({ links: [{ id: 'themeDefaultStyle', href: MIDNIGHT }] }, async ({ links }) => {
      const result = (await load(THEME_FN)('light')) as Record<string, unknown>;
      expect(result.defaultTheme).toBe('daylight');
      expect(links()[0]!.getAttribute('href')).toBe(DAYLIGHT);
    });
  });

  /**
   * 回归：`changed` 必须反映**实际配色**，不能因为换了表就恒为 true。
   * 调用方靠它判断「这次切换到底有没有改变渲染」。
   */
  it('背景色不变时 changed 为 false', async () => {
    await withThemeDom({ links: [{ id: 'themeDefaultStyle', href: DAYLIGHT }] }, async () => {
      const result = (await load(THEME_FN)('dark')) as Record<string, unknown>;
      expect(result.changed).toBe(false);
    });
  });

  it('背景色真的变了时 changed 为 true', async () => {
    await withThemeDom(
      {
        links: [{ id: 'themeDefaultStyle', href: DAYLIGHT }],
        backgrounds: { daylight: 'rgb(255, 255, 255)', midnight: 'rgb(30, 30, 30)' },
      },
      async () => {
        const result = (await load(THEME_FN)('dark')) as Record<string, unknown>;
        expect(result.changed).toBe(true);
      }
    );
  });

  it('没有 window.siyuan 时只设属性，不抛错', async () => {
    await withThemeDom({ links: [], siyuan: false }, async ({ root }) => {
      const result = (await load(THEME_FN)('dark')) as Record<string, unknown>;
      expect(root.attributes['data-theme-mode']).toBe('dark');
      expect(result).toMatchObject({ ok: true, changed: false, customTheme: null });
    });
  });

  /**
   * 自定义主题：`appearance.themeDark` 与内置主题不同名时，`#themeStyle`
   * 也要换成那张表；同名或没有自定义主题时，`#themeStyle` 应当被摘掉，
   * 否则会和默认表叠加。
   */
  it('自定义暗色主题写到 #themeStyle', async () => {
    await withThemeDom(
      {
        links: [
          { id: 'themeDefaultStyle', href: DAYLIGHT },
          { id: 'themeStyle', href: 'http://127.0.0.1:8899/appearance/themes/Old/theme.css?v=1' },
        ],
        appearance: { themeDark: 'Rem Craft Dev' },
      },
      async ({ links }) => {
        await load(THEME_FN)('dark');
        const byId = Object.fromEntries(links().map((link) => [link.id, link.getAttribute('href')]));
        expect(byId['themeDefaultStyle']).toBe(MIDNIGHT);
        // 只换主题名那一段，原有查询串（缓存版本号）保留。
        expect(byId['themeStyle']).toBe('http://127.0.0.1:8899/appearance/themes/Rem Craft Dev/theme.css?v=1');
      }
    );
  });

  it('没有自定义主题时摘掉 #themeStyle，避免两套表叠加', async () => {
    await withThemeDom(
      {
        links: [
          { id: 'themeDefaultStyle', href: DAYLIGHT },
          { id: 'themeStyle', href: 'http://127.0.0.1:8899/appearance/themes/Rem Craft Dev/theme.css?v=1' },
        ],
        appearance: {},
      },
      async ({ links }) => {
        await load(THEME_FN)('dark');
        expect(links().map((link) => link.id)).toEqual(['themeDefaultStyle']);
      }
    );
  });

  it('自定义主题与内置主题同名时不重复换表', async () => {
    await withThemeDom(
      {
        links: [{ id: 'themeDefaultStyle', href: DAYLIGHT }],
        appearance: { themeDark: 'midnight' },
      },
      async ({ links }) => {
        await load(THEME_FN)('dark');
        expect(links()).toHaveLength(1);
        expect(links()[0]!.getAttribute('href')).toBe(MIDNIGHT);
      }
    );
  });

  /** 内置主题没有 #themeDefaultStyle 时不能抛错（早期初始化/别的版本）。 */
  it('没有 #themeDefaultStyle 时安全返回', async () => {
    await withThemeDom({ links: [] }, async () => {
      await expect(load(THEME_FN)('dark')).resolves.toMatchObject({ ok: true });
    });
  });
});
