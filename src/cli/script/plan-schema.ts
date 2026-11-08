/**
 * 计划文件的 schema：唯一的形状来源。
 *
 * 类型由 `z.infer` 反推，校验与类型不再各写一份。
 *
 * **每个嵌套对象都 `.strict()`**：只在根上加时，步骤里把 `props` 拼成 `propss`
 * 会被 zod 静默剥掉，读数退回默认值、报告却显示成功——这正是要防的静默失败。
 */
import { z } from 'zod';

const stringArray = (label: string) =>
  z.array(z.string({ error: `${label}[i] 必须是字符串` }), { error: `${label} 必须是数组` });

/** 一步：读数或动作。 */
const stepShape = z
  .object({
    read: z.enum(['env', 'tokens', 'element', 'contrast'], { error: 'read 必须是 env / tokens / element / contrast' }).optional(),
    do: z.string({ error: 'do 必须是字符串，如 "menu:theme"' }).optional(),
    diff: z
      .object({
        selector: z.string({ error: 'diff.selector 必须是字符串' }),
        props: stringArray('diff.props'),
      })
      .strict()
      .optional(),
    selector: z.string({ error: 'selector 必须是字符串' }).optional(),
    props: stringArray('props').optional(),
    names: stringArray('names').optional(),
    foreground: z.string({ error: 'foreground 必须是字符串' }).optional(),
    background: z.string({ error: 'background 必须是字符串' }).optional(),
    box: z.boolean({ error: 'box 必须是布尔值' }).optional(),
    limit: z.number({ error: 'limit 必须是数字' }).int({ error: 'limit 必须是整数' }).positive({ error: 'limit 必须大于 0' }).optional(),
  })
  .strict()
  .refine((step) => step.read !== undefined || step.do !== undefined, {
    error: '每一步必须有 read 或 do',
  })
  .refine((step) => !(step.read !== undefined && step.do !== undefined), {
    error: '每一步只能有 read 或 do 之一',
  });

/** 计划整体。 */
export const planShape = z
  .object({
    frontend: z.enum(['desktop', 'mobile'], { error: 'frontend 必须是 desktop 或 mobile' }),
    viewport: z.string({ error: 'viewport 必须是字符串，如 "390x844"' }).optional(),
    steps: z.array(stepShape, { error: 'steps 必须是数组' }).min(1, { error: 'steps 不能为空' }),
  })
  .strict();

export type Plan = z.infer<typeof planShape>;
export type PlanStep = z.infer<typeof stepShape>;

/** 把 zod 的路径转成人能读的位置，如 `steps[2].props`。 */
function pathLabel(path: ReadonlyArray<PropertyKey>): string {
  let label = '';
  for (const segment of path) {
    if (typeof segment === 'number') label += `[${segment}]`;
    else label += label ? `.${String(segment)}` : String(segment);
  }
  return label;
}

/** 期望类型的中文名。 */
function expectedNoun(expected: string): string {
  switch (expected) {
    case 'string':
      return '字符串';
    case 'number':
      return '数字';
    case 'boolean':
      return '布尔值';
    case 'array':
      return '数组';
    case 'object':
      return '对象';
    default:
      return expected;
  }
}

/** 一条 zod 问题转成一句中文。 */
function issueMessage(issue: z.core.$ZodIssue): string {
  const label = pathLabel(issue.path);
  if (issue.code === 'unrecognized_keys') {
    const where = label ? `${label} 里的` : '';
    return `${where}未知字段：${issue.keys.join('、')}（拼写错误会被静默忽略，所以这里直接报错）`;
  }
  if (issue.code === 'invalid_type') {
    return label ? `${label} 必须是${expectedNoun(issue.expected)}` : `计划${expectedNoun(issue.expected)}格式不对`;
  }
  if (issue.code === 'too_small' && issue.origin === 'array') {
    return `${label} 不能为空`;
  }
  if (issue.code === 'too_small' && issue.origin === 'number') {
    return `${label} 必须大于 0`;
  }
  if (issue.code === 'invalid_value') {
    return `${label} 的取值不合法：${issue.message}`;
  }
  return label ? `${label}：${issue.message}` : issue.message;
}

/** 校验计划形状；失败时给出全部问题（一次改完，不用逐个试）。 */
export function parsePlan(data: unknown): { ok: true; plan: Plan } | { ok: false; errors: string[] } {
  const parsed = planShape.safeParse(data);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map(issueMessage) };
  return { ok: true, plan: parsed.data };
}
