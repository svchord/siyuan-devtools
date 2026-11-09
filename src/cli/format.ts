/**
 * 输出排版：纯文本，不做颜色、图标、表格对齐。
 *
 * CLI 的主要消费者是 agent：ANSI、box 边框、表格补空格都只是 token 开销。
 * JSON 的缩进换行同样不携带信息——实测同一份 `audit` 结果 pretty 1438 B、
 * compact 907 B（-37%），`read env` 443 → 366 B。所以默认紧凑，需要人读时
 * 才用 `--pretty` 换回缩进。
 *
 * 分流规则（clig.dev）：数据走 stdout，状态提示走 stderr。
 * `--json` 时 stdout 只有一段合法 JSON，可直接被 `jq` 消费。
 */

/** 是否缩进 JSON。进程内只解析一次 argv，所以用模块级开关而不是逐处传参。 */
let pretty = false;

/** 设置 JSON 缩进；`--pretty` 隐含 `--json`，何时调用由 main 决定。 */
export function setPretty(enabled: boolean): void {
  pretty = enabled;
}

/**
 * 输出结果：默认紧凑文本，`--json` 时输出 JSON（紧凑，`--pretty` 时缩进）。
 *
 * `--json` 的契约是「stdout 只有一段合法 JSON」：`JSON.stringify(undefined)`
 * 返回 undefined，直接打印会输出字面量 `undefined`，`jq` 当场失败。
 * 所以 undefined 在 JSON 模式下折成 null。
 */
export function output(value: unknown, json: boolean): void {
  if (json) {
    const data = value === undefined ? null : value;
    // 函数 / Symbol 这类不可序列化的值同样会让 stringify 返回 undefined，
    // 兜成 null 才能守住「一段合法 JSON」。
    console.log((pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data)) ?? 'null');
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
        if (item === undefined) return `${pad}${key}: (无)`;
        if (item !== null && typeof item === 'object') {
          return `${pad}${key}:\n${render(item, indent + 1)}`;
        }
        return `${pad}${key}: ${item === null ? '(无)' : String(item)}`;
      })
      .join('\n');
  }
  return `${pad}${String(value)}`;
}

/** 状态提示：走 stderr，不污染 stdout 的数据。 */
export function note(message: string): void {
  console.error(message);
}
