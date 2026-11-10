/**
 * 矩阵输出：多场景读数的**唯一**渲染器。
 *
 * 列只写一次、行是纯值数组；所有场景都相同的列默认折叠进 `same`。
 * `read --at`、`shot --at`、`audit` 都用这里，不再各写一套表。
 */
import { isRecord } from './util.ts';

/** 一列：`label` 给人看，`path` 用来取值（点路径，数组下标用数字段）。 */
export interface MatrixColumn {
  label: string;
  path: string;
}

/** 一次测量的结果，`at` 让调用方不必回头猜测是哪一格。 */
export interface SceneReading<T> {
  at: string;
  value: T;
}

/** 按点路径取值；中间层缺失给 null（不猜、不抛）。数组下标用数字段。 */
function readPath(value: unknown, path: string): unknown {
  let current = value;
  for (const key of path.split('.')) {
    if (Array.isArray(current)) {
      const index = Number(key);
      if (!Number.isInteger(index) || index < 0) return null;
      current = current[index];
      continue;
    }
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return current ?? null;
}

/**
 * 多场景读数 → 表。
 *
 * `full` 为真时所有列都保留；默认把「所有场景都相同」的列折叠进 `same`。
 */
export function renderMatrix(
  columns: readonly MatrixColumn[],
  readings: readonly SceneReading<unknown>[],
  full = false
): Record<string, unknown> {
  const rows = readings.map((reading) => columns.map((column) => readPath(reading.value, column.path)));
  const same: Record<string, unknown> = {};
  const keptLabels: string[] = [];
  const keptIndexes: number[] = [];
  columns.forEach((column, index) => {
    const values = rows.map((row) => row[index]);
    const first = values[0];
    const allEqual = values.every((value) => JSON.stringify(value) === JSON.stringify(first));
    if (!full && allEqual) same[column.label] = first ?? null;
    else {
      keptLabels.push(column.label);
      keptIndexes.push(index);
    }
  });
  const table: Record<string, unknown> = {
    cells: readings.map((reading) => reading.at),
    columns: keptLabels,
    rows: rows.map((row) => keptIndexes.map((index) => row[index] ?? null)),
  };
  if (!full && Object.keys(same).length) table.same = same;
  return table;
}
