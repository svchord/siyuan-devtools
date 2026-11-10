/** 帮助文本。README 与 SKILL 的命令表以这里为准。 */
export const HELP = `siyuan-devtools — 思源主题/插件渲染测量

会话
  siyuan-devtools open [--frontend desktop|mobile] [--device "iPhone 13"] [--viewport 390x844] [--theme light|dark] [--density default|compact] [--headed]
  siyuan-devtools reload [--frontend desktop|mobile] [--viewport 390x844] [--theme light|dark] [--density default|compact]
  siyuan-devtools status [--raw]   默认给测量状态：open/frontend/theme/density/url/viewport
  siyuan-devtools close

读数（不带 --at：读当前页；带 --at：返回多场景矩阵）
  siyuan-devtools read env
  siyuan-devtools read tokens <name...>
  siyuan-devtools read element <selector> [--props a,b] [--box [--limit N]] [--meta]
  siyuan-devtools read contrast <fg> <bg>

动作（只作用于当前页；批量动作写 audit 计划）
  siyuan-devtools do click <selector> [--button left|right|middle] [--count 1|2]
  siyuan-devtools do hover <selector>
  siyuan-devtools do dblclick <selector>
  siyuan-devtools do fill <selector> <text>
  siyuan-devtools do press <key> / do keydown <key> / do keyup <key>
  siyuan-devtools do mousemove <x> <y>
  siyuan-devtools do drag <from> <to>
  siyuan-devtools do select <selector> <value>
  siyuan-devtools do menu <id>
  siyuan-devtools do dock <type>
  siyuan-devtools do attr <name=value>
  siyuan-devtools do reset

批量 / 产物
  siyuan-devtools shot [--at <场景>] [--out shots]   # 不带 --at 截当前页；带 --at 批量截图
  siyuan-devtools audit <plan.json>                   # 计划里写 at/axes

场景（--at）
  取值：all | frontend[/theme[/density]][/键=值...]，逗号分隔多段。
  省略的段按该段全部取值展开（desktop = 4 格；desktop/dark = 2 格）。
  例：--at all
      --at desktop/dark
      --at desktop/dark/default/data-rc-style=fluent
  带 --at 时：当前前端用你正在交互的那一页（跑完属性设回去，交互态不丢），
  其它前端懒创建测量页并复用。移动端没有紧凑模式，mobile × compact 会被跳过。

选项细节
  read element 默认给 found/count/visible/styles（--box 加 boxes），--meta 才带 tag/className。
  --theme / --density 可逗号多值；density 的普通态是 default（没有该属性），不是 comfortable。
  status --raw 给 playwright 会话列表，不是测量状态。

其他
  siyuan-devtools install --skills [--global]
  siyuan-devtools --help

全局选项：--json（紧凑结构化输出）、--pretty（缩进 JSON，隐含 --json）、
--raw（只用于 status）、--at <场景>（多场景测量）、--url <前端 URL>
（默认沿用 open 时的 URL，否则按 SIYUAN_PORT 或 6806 拼）。
-- 之后的参数一律按字面量处理，例如 siyuan-devtools do fill '#inp' -- --json
`;
