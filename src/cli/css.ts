/**
 * CSS 属性名规范化。
 *
 * `getPropertyValue('backgroundColor')` 返回空字符串——和「属性值为空」无法
 * 区分，正是 TOKENS_FN 花力气规避的那类静默失败。这里统一把 camelCase
 * 转成 kebab-case，非法名字直接报错。
 */
import { UserError } from './errors.ts';

/** 合法 CSS 属性名：可选厂商前缀 + 小写字母开头。 */
const PROPERTY_NAME = /^(?:--[a-zA-Z][\w-]*|-?[a-z][a-z0-9-]*)$/;

/**
 * camelCase / kebab-case → kebab-case；非法名字返回 null。
 *
 * 保留 `-webkit-` / `-moz-` 这类厂商前缀：思源主题里常见
 * `-webkit-text-fill-color`，旧的 `^[a-z]` 规则会把它们全部拒掉。
 */
function toKebab(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  // CSS 自定义属性（`--rc-brand-8`）本身就是合法的属性名，保持原样。
  if (text.startsWith('--')) return PROPERTY_NAME.test(text) ? text : null;
  const kebab = text.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
  return PROPERTY_NAME.test(kebab) ? kebab : null;
}

/**
 * 解析逗号分隔的属性名列表。
 *
 * 未传返回 fallback；传了但为空、或含非法名字则报错——静默退回默认值会让
 * agent 以为读到的是它要的属性。
 */
export function parseProps(value: string | undefined, fallback: readonly string[]): string[] {
  if (value === undefined) return [...fallback];
  const items = value.split(',').map((item) => item.trim()).filter(Boolean);
  if (!items.length) throw new UserError('--props 不能为空');
  return items.map((item) => {
    const kebab = toKebab(item);
    if (!kebab) throw new UserError(`--props 里的属性名不合法：${item}（应为 color / background-color 这类 CSS 属性名）`);
    return kebab;
  });
}
