/**
 * 页面 JS 片段：唯一定义处。
 *
 * 这些片段跑在页面里，不能引用 Node 侧的任何变量，所有常量内联进函数体。
 * `cli --json eval` 与 `audit` 的 run-code 都从这里取，避免两处漂移。
 *
 * 片段分两种形状：
 *   - `evaluate(fn, arg)` 用：函数体字符串（如 `names => {...}`）
 *   - `eval "<expr>"` 用：自执行表达式（如 `(names => {...})([...])`）
 *
 * 注意：这些字符串**不被 tsc 检查**（它们是页面侧代码，不是模块）。改动后
 * 必须跑 recipe.test.ts —— 它会把每个片段放进 `new Function` 解析一遍。
 */

/** 页面是否已经完成思源前端启动。 */
export const READY_FN = `() => Boolean(
  window.siyuan?.config &&
  document.documentElement.getAttribute('data-frontend')
)`;

/** 记录会话开始时的 `<html>` 属性快照，供 reset 恢复。 */
export const SNAPSHOT_ROOT_FN = `() => {
  const attributes = {};
  for (const attribute of document.documentElement.attributes) attributes[attribute.name] = attribute.value;
  window.__siyuanDevtoolsRootAttrs = attributes;
  return true;
}`;

/** `read env` / 计划的 env 步骤。 */
export const ENV_FN = `() => {
  const root = document.documentElement;
  const stylesheetHref = (id) => document.getElementById(id)?.getAttribute('href') ?? null;
  return {
    frontend: root.getAttribute('data-frontend'),
    backend: root.getAttribute('data-backend'),
    themeMode: root.getAttribute('data-theme-mode'),
    uiDensity: root.getAttribute('data-ui-density'),
    themeStyle: stylesheetHref('themeStyle'),
    pluginsStyle: [...document.querySelectorAll('[id^="pluginsStyle"]')]
      .map(el => ({ id: el.id, href: el.getAttribute('href') })),
    url: location.href,
    domNodes: document.querySelectorAll('*').length,
    viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
  };
}`;

/**
 * 令牌读数：函数体，参数由调用方传。
 *
 * `getPropertyValue` 对未定义的自定义属性返回空字符串，和「定义了但值为空」
 * 无法区分。agent 最常犯的错就是令牌名拼错，若静默返回 ""，它会当成
 * 「这个令牌没有值」继续往下走。所以这里先枚举已定义的属性名，未命中的
 * 单独放进 missing，让调用方能明确区分两种情况。
 */
export const TOKENS_FN = `names => {
  const root = getComputedStyle(document.documentElement);
  const defined = new Set();
  for (let i = 0; i < root.length; i += 1) {
    const name = root[i];
    if (name.startsWith('--')) defined.add(name);
  }
  const values = {};
  const missing = [];
  for (const name of names) {
    if (defined.has(name)) values[name] = root.getPropertyValue(name).trim();
    else missing.push(name);
  }
  return { values, missing };
}`;

/**
 * 对比度读数：令牌名或字面量颜色都可以，对比度本身在 Node 侧算。
 *
 * 返回 `missing`：未定义的令牌名必须能被调用方识别出来。旧实现直接返回空
 * 字符串，`read contrast --typo --bg` 会得到 `ratio: null` 且退出码 0，
 * 和「令牌真的没有值」无法区分。
 */
export const contrastFn = (fg: string, bg: string): string => `() => {
  const root = getComputedStyle(document.documentElement);
  const read = (value) => value.startsWith('--') ? root.getPropertyValue(value).trim() : value;
  const missing = [];
  if (${JSON.stringify(fg)}.startsWith('--') && !read(${JSON.stringify(fg)})) missing.push(${JSON.stringify(fg)});
  if (${JSON.stringify(bg)}.startsWith('--') && !read(${JSON.stringify(bg)})) missing.push(${JSON.stringify(bg)});
  return { foreground: read(${JSON.stringify(fg)}),
    background: read(${JSON.stringify(bg)}),
    missing };
}`;

/** 可见性判定：position:fixed 元素的 offsetParent 恒 null，必须用 rect + computedStyle。 */
const VISIBLE = `el => {
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return false;
  const cs = getComputedStyle(el);
  return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) !== 0;
}`;

/** 元素读数默认属性；与 read element / plan 的 read element 共用。 */
export const DEFAULT_ELEMENT_PROPS = ['color', 'background-color'] as const;

/** 元素读数：函数体，选择器与属性内联。 */
export const elementFn = (selector: string, props: readonly string[], box: boolean, limit: number): string => `() => {
  const visible = ${VISIBLE};
  const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
  const shown = els.filter(visible);
  const target = shown[0] ?? els[0];
  const styles = {};
  if (target) {
    const cs = getComputedStyle(target);
    for (const p of ${JSON.stringify(props)}) styles[p] = cs.getPropertyValue(p);
  }
  const out = {
    found: Boolean(target),
    count: els.length,
    visible: shown.length,
    tag: target?.tagName.toLowerCase() ?? null,
    className: target ? (target.getAttribute('class') ?? '').slice(0, 120) : null,
    styles,
  };
  ${box ? `out.boxes = shown.slice(0, ${limit}).map((el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10,
      width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10 };
  });` : ''}
  return out;
}`;

/** 样式快照（--diff 前后读数）。 */
export const styleOfFn = (selector: string, props: readonly string[]): string => `() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return null;
  const cs = getComputedStyle(el);
  const out = {};
  for (const p of ${JSON.stringify(props)}) out[p] = cs.getPropertyValue(p);
  return out;
}`;

// ---- 思源专用动作（都在页面 JS 内完成，不需要 page 对象）----

/**
 * 点击菜单项。
 *
 * 选择器只认思源自己的菜单标记：`[data-menu-id]`、`#commonMenu` 里的
 * `.b3-menu__item[data-id]`、`[data-menu="true"][data-id]`。
 *
 * **不要**退回裸 `[data-id="x"]`：页面上任何带 `data-id` 的元素都会被命中，
 * `do menu theme` 可能点到文档树节点并返回 `{ok:true}`——对一个「确认交互态」
 * 的工具，点错元素还报成功是最坏的失败模式（实测插入一个带 data-id 的 div
 * 就能劫持）。
 */
export const MENU_FN = `id => {
  const escape = (value) => window.CSS?.escape
    ? CSS.escape(String(value))
    : String(value).replace(/["\\\\]/g, '\\\\$&');
  const idText = String(id);
  const selector = escape(idText);
  const candidates = [
    document.querySelector('[data-menu-id="' + selector + '"]'),
    document.querySelector('#commonMenu .b3-menu__item[data-id="' + selector + '"]'),
    document.querySelector('[data-menu="true"][data-id="' + selector + '"]'),
  ];
  const element = candidates.find(Boolean);
  if (element) {
    element.click();
    return { ok: true, id: idText };
  }
  const named = window.siyuan?.menus?.menu?.[idText];
  if (named?.element) {
    named.element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return { ok: true, id: idText };
  }
  return { ok: false, reason: '找不到菜单项：' + idText };
}`;

/**
 * 点击停靠栏项。
 *
 * type 由 `JSON.stringify` 注入，和 MENU_FN 用同一套转义策略：直接拼进
 * 选择器会让 `do dock 'x"]'` 抛 SyntaxError（旧实现就是这样）。
 */
export const dockFn = (type: string): string => `() => {
  const el = document.querySelector('.dock__item[data-type=' + JSON.stringify(${JSON.stringify(type)}) + ']');
  if (!el) return { ok: false, reason: '找不到停靠项：' + ${JSON.stringify(type)} };
  el.click();
  return { ok: true };
}`;

export const ATTR_FN = `pair => {
  const [name, value] = pair;
  if (!name) return { ok: false, reason: '属性名不能为空' };
  if (value === undefined || value === null) document.documentElement.removeAttribute(name);
  else document.documentElement.setAttribute(name, value);
  return { ok: true, name, value: value ?? null };
}`;

/**
 * 恢复 open/reload 时记录的 `<html>` 属性快照。
 *
 * `window.siyuan.menus.menu` 可能是空对象（早期初始化、或页面是别的版本），
 * 直接 `.remove()` 会抛 TypeError。这里先判类型。
 */
export const RESET_FN = `() => {
  const root = document.documentElement;
  const snapshot = window.__siyuanDevtoolsRootAttrs;
  if (snapshot && typeof snapshot === 'object') {
    for (const name of [...root.getAttributeNames()]) {
      if (!Object.prototype.hasOwnProperty.call(snapshot, name)) root.removeAttribute(name);
    }
    for (const [name, value] of Object.entries(snapshot)) {
      if (root.getAttribute(name) !== value) root.setAttribute(name, value);
    }
  } else {
    root.removeAttribute('data-theme-mode');
    root.removeAttribute('data-ui-density');
  }
  const menu = window.siyuan?.menus?.menu;
  if (menu && typeof menu.remove === 'function') menu.remove();
  return { ok: true, restored: Boolean(snapshot) };
}`;

/** 把「函数体 + 参数」包成给 `cli --json eval` 用的自执行表达式。 */
export function evalExpr(fn: string, arg?: unknown): string {
  return arg === undefined ? `(${fn})()` : `(${fn})(${JSON.stringify(arg)})`;
}

/** @deprecated 临时别名：do.ts 迁移到 dockFn 后删除。 */
export const DOCK_FN = `type => {
  const el = document.querySelector('.dock__item[data-type="' + type + '"]');
  if (!el) return { ok: false, reason: '找不到停靠项' };
  el.click();
  return { ok: true };
}`;
