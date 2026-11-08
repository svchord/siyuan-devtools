/** 帮助文本。 */
export const HELP = `siyuan-devtools — 思源主题/插件渲染测量

会话
  siyuan-devtools open [--frontend desktop|mobile] [--device "iPhone 13"] [--viewport 390x844]
  siyuan-devtools reload
  siyuan-devtools status
  siyuan-devtools close

读数
  siyuan-devtools read env
  siyuan-devtools read tokens <name...>
  siyuan-devtools read element <selector> [--props a,b] [--box] [--limit N]
  siyuan-devtools read contrast <fg> <bg>

动作（都支持 --diff a,b）
  siyuan-devtools do click <selector> [--button left|right|middle] [--count 1|2]
  siyuan-devtools do hover <selector>
  siyuan-devtools do dblclick <selector>
  siyuan-devtools do fill <selector> <text>
  siyuan-devtools do press <key>
  siyuan-devtools do keydown <key> / do keyup <key>
  siyuan-devtools do mousemove <x> <y>
  siyuan-devtools do drag <from> <to>
  siyuan-devtools do select <selector> <value>
  siyuan-devtools do menu <id>
  siyuan-devtools do dock <type>
  siyuan-devtools do attr <name=value>
  siyuan-devtools do reset

批量 / 产物
  siyuan-devtools audit <plan.json> [--json]
  siyuan-devtools shot [--frontend both|desktop|mobile] [--theme dark|light] [--density comfortable|compact] [--out shots]

其他
  siyuan-devtools install --skills [--global]
  siyuan-devtools --help

全局选项：--json（结构化输出）、--url <前端 URL>（默认按 SIYUAN_PORT 或 6806 拼）
`;
