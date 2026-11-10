/**
 * 计划文件的 schema：唯一的形状来源。
 *
 * 类型由 `z.infer` 反推，校验与类型不再各写一份。
 *
 * **每个嵌套对象都 `.strict()`**：只在根上加时，步骤里把 `props` 拼成 `propss`
 * 会被 zod 静默剥掉，读数退回默认值、报告却显示成功——这正是要防的静默失败。
 *
 * `.strict()` 只防「拼错」，不防「放错步骤」：`{ read: 'env', props: [...] }`
 * 的字段名合法、但那个步骤根本不读 props，编译时会被忽略。所以下面还要逐项
 * 校验「字段只能出现在对应类型的步骤里」。
 *
 * 编译期不再重复这里已经保证的检查：`plan.ts` 只处理「形状已合法」的计划。
 */
import { z } from 'zod';
import { parseProps } from '../css.ts';
import { parseViewport } from '../viewport.ts';

const stringArray = (label: string) =>
  z.array(z.string({ error: `${label}[i] 必须是字符串` }), { error: `${label} 必须是数组` });

/** 计划里支持的 `do` 动作。plan.ts 用它判断动作合法性，不另写一份。 */
export const PLAN_ACTIONS = ['hover', 'click', 'menu'] as const;

/** 各 read 类型允许的字段。 */
const READ_FIELDS: Record<string, readonly string[]> = {
  env: [],
  tokens: ['names'],
  element: ['selector', 'props', 'box', 'limit'],
  contrast: ['foreground', 'background'],
};

/** 各字段只在对应 read 类型下有效；用于「字段放错步骤」的报错。 */
const FIELD_OWNER: Record<string, string> = {
  selector: 'read element',
  props: 'read element',
  box: 'read element',
  limit: 'read element',
  names: 'read tokens',
  foreground: 'read contrast',
  background: 'read contrast',
};

/** 一步：读数或动作。 */
const stepShape = z
  .object({
    read: z.enum(['env', 'tokens', 'element', 'contrast'], { error: 'read 必须是 env / tokens / element / contrast' }).optional(),
    do: z.string({ error: 'do 必须是字符串，如 "menu:theme"' }).optional(),
    diff: z
      .object({
        selector: z.string({ error: 'diff.selector 必须是字符串' }).min(1, { error: 'diff.selector 不能为空' }),
        props: stringArray('diff.props').min(1, { error: 'diff.props 不能为空' }),
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
  .superRefine((step, ctx) => {
    if (step.read === 'element' && !step.selector?.trim()) {
      ctx.addIssue({ code: 'custom', path: ['selector'], message: 'read element 需要 selector' });
    }
    if (step.read === 'tokens' && !step.names?.length) {
      ctx.addIssue({ code: 'custom', path: ['names'], message: 'read tokens 需要至少一个 names' });
    }
    if (step.read === 'contrast') {
      if (!step.foreground?.trim()) {
        ctx.addIssue({ code: 'custom', path: ['foreground'], message: 'read contrast 需要 foreground' });
      }
      if (!step.background?.trim()) {
        ctx.addIssue({ code: 'custom', path: ['background'], message: 'read contrast 需要 background' });
      }
    }
    if (step.do !== undefined) {
      if (!/^(?:hover|click|menu):[\s\S]+$/.test(step.do)) {
        ctx.addIssue({
          code: 'custom',
          path: ['do'],
          message: `do 必须是 ${PLAN_ACTIONS.join(' / ')} 之一，形如 hover:<selector>`,
        });
      }
    }
    if (step.diff && step.do === undefined) {
      ctx.addIssue({ code: 'custom', path: ['diff'], message: 'diff 只能用于 do 步骤' });
    }
    // 与 CLI 对齐：--limit 只影响 --box 的输出，单独给等于静默无效。
    if (step.limit !== undefined && step.box !== true) {
      ctx.addIssue({ code: 'custom', path: ['limit'], message: 'limit 只能与 box: true 一起使用' });
    }

    // 「字段放错步骤」：字段名合法、但当前步骤根本不读它。
    if (step.read !== undefined) {
      const allowed = READ_FIELDS[step.read] ?? [];
      for (const [field, owner] of Object.entries(FIELD_OWNER)) {
        if (allowed.includes(field)) continue;
        if ((step as Record<string, unknown>)[field] === undefined) continue;
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: `${field} 只能用于 ${owner}，不能出现在 read ${step.read} 里（否则会被静默忽略）`,
        });
      }
    } else {
      // do 步骤：只有 diff 是合法的附加字段。
      // 既没有 read 也没有 do 时交给下面的 refine 报「每一步必须有 read 或 do」，
      // 不要在这里抢先报一个让人困惑的字段错误。
      if (step.do === undefined) return;
      for (const [field, owner] of Object.entries(FIELD_OWNER)) {
        if ((step as Record<string, unknown>)[field] === undefined) continue;
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: `${field} 只能用于 ${owner}，不能出现在 do 步骤里（否则会被静默忽略）`,
        });
      }
    }

    // props 内容也在这里校验：放到编译期（runPlan）会变成「浏览器都开了才报错」。
    for (const [path, value] of [
      [['props'], step.props?.join(',')],
      [['diff', 'props'], step.diff?.props.join(',')],
    ] as const) {
      if (value === undefined) continue;
      try {
        parseProps(value, []);
      } catch (cause) {
        ctx.addIssue({
          code: 'custom',
          path: [...path],
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }
  })
  .refine((step) => step.read !== undefined || step.do !== undefined, {
    error: '每一步必须有 read 或 do',
  })
  .refine((step) => !(step.read !== undefined && step.do !== undefined), {
    error: '每一步只能有 read 或 do 之一',
  });

/** 计划整体。 */
export const planShape = z
  .object({
    /** 场景选择，与 CLI 的 `--at` 同一套语法（`all` / `desktop/dark` …）。 */
    at: z.string({ error: 'at 必须是字符串，如 "all" 或 "desktop/dark"' }).min(1, { error: 'at 不能为空' }).optional(),
    /** 结构化轴，与 `--at` 二选一；附加属性写在 attrs 里。 */
    axes: z
      .object({
        frontend: z.array(z.enum(['desktop', 'mobile']), { error: 'axes.frontend 必须是 desktop / mobile 的数组' }).optional(),
        theme: z.array(z.enum(['light', 'dark']), { error: 'axes.theme 必须是 light / dark 的数组' }).optional(),
        density: z.array(z.enum(['default', 'compact']), { error: 'axes.density 必须是 default / compact 的数组' }).optional(),
        attrs: z
          .record(z.string(), z.array(z.string({ error: 'axes.attrs 的每个值必须是字符串数组' })))
          .optional(),
      })
      .strict()
      .optional(),
    /** 每格截一张图。 */
    shots: z
      .object({
        out: z.string({ error: 'shots.out 必须是字符串（目录）' }).min(1, { error: 'shots.out 不能为空' }).optional(),
      })
      .strict()
      .optional(),
    viewport: z
      .string({ error: 'viewport 必须是字符串，如 "390x844"' })
      .refine(
        (value) => {
          try {
            parseViewport(value);
            return true;
          } catch {
            return false;
          }
        },
        { error: 'viewport 必须是正整数的 宽x高，如 "390x844"' }
      )
      .optional(),
    steps: z.array(stepShape, { error: 'steps 必须是数组' }).min(1, { error: 'steps 不能为空' }),
  })
  .strict()
  .refine((plan) => plan.at !== undefined || plan.axes !== undefined, {
    error: '计划需要 at 或 axes 之一',
    path: ['at'],
  })
  .refine((plan) => !(plan.at !== undefined && plan.axes !== undefined), {
    error: 'at 与 axes 不能同时给（两种写法）',
    path: ['at'],
  });

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
