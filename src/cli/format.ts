/**
 * 输出排版：纯文本，不做颜色、图标、表格对齐。
 *
 * CLI 的主要消费者是 agent：ANSI、box 边框、表格补空格都只是 token 开销。
 *
 * 分流规则（clig.dev）：数据走 stdout，状态提示走 stderr。
 * `--json` 时 stdout 只有格式化 JSON，可直接被 `jq` 消费。
 */
/** 供 `--json` 用的类型别名（避免 any）。 */
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** 输出结果：默认紧凑文本，`--json` 时原样输出 JSON。 */
export function output(value: unknown, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(value as JsonValue, null, 2));
    return;
  }
  // 字符串按原样输出：调用方可能已经排好版（如 shot 的路径列表）。
  console.log(typeof value === 'string' ? value : render(value));
}

/** 把任意读数渲染成人读文本。 */
function render(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);
  if (value === null || value === undefined) return `${pad}(无)`;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return `${pad}${String(value)}`;
  }
  if (Array.isArray(value)) {
    if (!value.length) return `${pad}(空)`;
    return value.map((item, index) => `${pad}[${index}]\n${render(item, indent + 1)}`).join('\n');
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (!entries.length) return `${pad}(空)`;
    return entries
      .map(([key, item]) => {
        if (item !== null && typeof item === 'object') {
          return `${pad}${key}:\n${render(item, indent + 1)}`;
        }
        return `${pad}${key}: ${item === null ? '(无)' : String(item)}`;
      })
      .join('\n');
  }
  return `${pad}${String(value)}`;
}
