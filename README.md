# siyuan-devtools

agent 面向的思源渲染测量 CLI：在真实前端页面里读样式、令牌、对比度，驱动交互，截图。

## 安装

```bash
pnpm add -D siyuan-devtools
npx siyuan-devtools install --skills    # 给 agent 装一页 skill
```

`playwright-core` 是普通依赖，会自动装上，不需要单独安装。它不带浏览器，用系统已有的 Chrome。

## 命令

```
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
  siyuan-devtools shot [--frontend both|desktop|mobile] [--state dark|light|compact] [--out shots]
```

## 工作流

```
1. siyuan-devtools open --frontend desktop      # 一次
2. 改源码
3. 等 pnpm dev 输出 [vite-plugin-siyuan] build #N ready
4. siyuan-devtools reload                        # 加载新 CSS
5. 重建交互场景（do hover / do menu ...）
6. read / audit
```

`reload` 会整页刷新，之前的 hover、打开的菜单、滚动位置都会清空。

## 设计

引擎是 `playwright-core` 自带的 `cli`（daemon + 持久会话），本 CLI 只做三件事：

| 命令 | 实现 |
|---|---|
| `do click/hover/fill/press/...` | 直接转发原生命令 |
| `read *`、`do menu/dock/attr/reset` | `cli --raw eval` 跑页面 JS 片段 |
| `audit` | `cli --raw run-code`，整个计划一次执行 |

`open` 会起新 Chrome；会话已存在时不要重复 `open`（它会杀掉旧的），加载新产物用 `reload`。

## 环境变量

| 变量 | 说明 |
|---|---|
| `SIYUAN_PORT` | kernel 端口，缺省 6806 |
| `--url` | 直接给前端 URL，覆盖端口拼装 |

## 退出码

- `0` 成功
- `2` 失败（错误信息在 stderr）
