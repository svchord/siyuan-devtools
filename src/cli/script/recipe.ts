/**
 * 页面 JS 片段：唯一定义处。
 *
 * 这些片段跑在页面里，不能引用 Node 侧的任何变量，所有常量内联进函数体。
 * `cli --json eval` 与 `audit` 的 run-code 都从这里取，避免两处漂移。
 *
 * 片段分两种形状：
 *   - `evaluate(fn, arg)` 用：函数体字符串（如 `names => {...}`）
 *   - `eval "<expr>"` 用：自执行表达式（如 `(names => {...})([...])`）
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
  return {
    frontend: root.getAttribute('data-frontend'),
    backend: root.getAttribute('data-backend'),
    themeMode: root.getAttribute('data-theme-mode'),
    uiDensity: root.getAttribute('data-ui-density'),
    themeStyle: document.getElementById('themeStyle')?.getAttribute('href') ?? null,
    pluginsStyle: [...document.querySelectorAll('[id^="pluginsStyle"]')].map(el => el.id),
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

/** 对比度读数：令牌名或字面量颜色都可以，对比度本身在 Node 侧算。 */
export const contrastFn = (fg: string, bg: string): string => `() => {
  const root = getComputedStyle(document.documentElement);
  const read = (value) => value.startsWith('--') ? root.getPropertyValue(value).trim() : value;
  return { foreground: read(${JSON.stringify(fg)}),
    background: read(${JSON.stringify(bg)}) };
}`;

/** 可见性判定：position:fixed 元素的 offsetParent 恒 null，必须用 rect + computedStyle。 */
const VISIBLE = `el => {
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return false;
  const cs = getComputedStyle(el);
  return cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity) !== 0;
}`;

/** 元素读数：函数体，选择器与属性内联。 */
export const elementFn = (selector: string, props: string[], box: boolean, limit: number): string => `() => {
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
  ${box ? `out.boxes = shown.slice(0, ${limit}).map((el, i) => {
    const r = el.getBoundingClientRect();
    return { index: i, x: Math.round(r.x * 10) / 10, y: Math.round(r.y * 10) / 10,
      width: Math.round(r.width * 10) / 10, height: Math.round(r.height * 10) / 10 };
  });` : ''}
  return out;
}`;

/** 样式快照（--diff 前后读数）。 */
export const styleOfFn = (selector: string, props: string[]): string => `() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return null;
  const cs = getComputedStyle(el);
  const out = {};
  for (const p of ${JSON.stringify(props)}) out[p] = cs.getPropertyValue(p);
  return out;
}`;

// ---- 思源专用动作（都在页面 JS 内完成，不需要 page 对象）----

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
    document.querySelector('[data-id="' + selector + '"]'),
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

export const DOCK_FN = `type => {
  const el = document.querySelector(\`.dock__item[data-type="\${type}"]\`);
  if (!el) return { ok: false, reason: '找不到停靠项' };
  el.click();
  return { ok: true };
}`;

export const ATTR_FN = `pair => {
  const [name, value] = pair;
  if (value === undefined || value === null) document.documentElement.removeAttribute(name);
  else document.documentElement.setAttribute(name, value);
  return { ok: true, name, value: value ?? null };
}`;

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
  window.siyuan?.menus?.menu?.remove();
  return { ok: true, restored: Boolean(snapshot) };
}`;

/** 把「函数体 + 参数」包成给 `cli --json eval` 用的自执行表达式。 */
export function evalExpr(fn: string, arg?: unknown): string {
  return fn === '' ? '' : arg === undefined ? `(${fn})()` : `(${fn})(${JSON.stringify(arg)})`;
}
