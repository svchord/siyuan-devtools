/**
 * 兼容层：`support.ts` 已经拆成 errors / util / timing / css。
 *
 * 这里只做再导出，供尚未迁移的调用方过渡使用。新代码请直接从对应模块
 * import；全部迁移完成后本文件会删除。
 */
export { UserError, EnvironmentError, describeError, firstLine, renderError } from './errors.ts';
export { sleep, readJsonFile, isRecord } from './util.ts';
export { ACTION_SETTLE_MS, POINTER_PARK_MS, THEME_SWITCH_MS, READY_TIMEOUT_MS } from './timing.ts';
export { parseProps } from './css.ts';
