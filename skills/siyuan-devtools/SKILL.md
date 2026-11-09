---
name: siyuan-devtools
description: 测量思源主题/插件的真实渲染（样式、令牌、对比度、交互态），并截图。当需要确认主题改动在思源里实际长什么样、某个选择器算出来的颜色/尺寸是多少、或要批量跑一组测量时使用。
---

# siyuan-devtools

在真实思源前端页面里读事实、驱动交互。浏览器会话由本工具管理，一次 `open` 之后所有命令复用同一个页面。

## 会话

```bash
siyuan-devtools open --frontend desktop     # 首次：起浏览器并打开页面，只调一次
siyuan-devtools status                      # 测量状态：open/frontend/theme/density/url/viewport
siyuan-devtools close
```

**不要再 open 第二次**——它会杀掉旧 Chrome。加载新产物用 `reload`；`reload` / `audit` / `shot`
切前端时在原会话里就地切设备模拟，不重开浏览器。`status --raw` 才是 playwright 的会话列表。

## 改完源码后

```
1. 改源码
2. 等 pnpm dev 输出 [vite-plugin-siyuan] build #N ready
3. siyuan-devtools reload
4. 重新建立交互场景（do hover / do menu ...）
5. 测量
```

`reload` 整页刷新，hover、打开的菜单、滚动位置全部清空；但它会**重放**会话里记的
`--theme` / `--density`（导航会把它们重置回思源配置）。

## 读数

```bash
siyuan-devtools read env
siyuan-devtools read tokens --brand-8 --rc-text-primary
siyuan-devtools read element .b3-menu__item --props color,background-color
siyuan-devtools read element .b3-menu__item --box --limit 3
siyuan-devtools read contrast --rc-text-primary --rc-bg-page
```

`read element` 默认只给 `found/count/visible/styles`（`--box` 加 `boxes`）；`--meta` 才带
`tag`/`className`，只要数值时别加。

## 测量格（最重要）

三个维度写成一个格：`frontend/theme/density`，例如 `desktop/dark/compact`。
任何读数都能加 `--at`，**一条命令在多个模式上取值**：

```bash
siyuan-devtools read tokens --brand-8 --at all                    # 全部 6 格
siyuan-devtools read element .b3-menu__item --props color --at desktop/dark
siyuan-devtools read contrast --rc-text-primary --rc-bg-page --at desktop
siyuan-devtools do hover .b3-menu__item --diff color --at desktop/dark/default
```

- `--at` 取值：`all` 或 `frontend[/theme[/density]]`，逗号分隔多段。
- 省略的段按该段全部取值展开：`desktop` = 4 格，`desktop/dark` = 2 格。
- 合法域由工具定义：desktop 4 格 + mobile 2 格 = 6 格；`mobile/compact` 不存在。
- 多格输出是表：`cells`（行标签）+ `columns` + `rows`，所有格相同的列折叠进 `same`。
- `--at` 是纯命令，跑完会还原到进入前的格；`do --at` 例外（它就是要改变页面状态）。

## 动作

```bash
siyuan-devtools do hover .b3-menu__item
siyuan-devtools do click .b3-menu__item --button right
siyuan-devtools do fill .b3-text-field "hello"
siyuan-devtools do menu theme        # 也有 dock / attr / press / reset
```

加 `--diff color,background-color` 会在动作前后各读一次，省一轮往返；支持
`click`/`hover`/`dblclick`/`fill`/`drag`/`select`。

选择器必须**唯一命中**：playwright 是 strict 模式，`.dock__item` 这类命中多个会直接报错，
用 `[data-type=x]` / `:nth-child` 收窄。交互态跨命令保留：`do hover` 后直接 `read element`
读到的就是 hover 后的样式。

## 明暗与密度

```bash
siyuan-devtools reload --theme dark --density compact   # 切换并记住
siyuan-devtools reload                                  # 重放记住的值
```

`--theme light|dark` 会同时改 `data-theme-mode` 与主题 `<link>` 的 href——内置
daylight/midnight 是两张独立 CSS，只改属性对内置主题无效。
`--density default|compact`：上游只有 `compact`，普通态是**没有**该属性，所以用 `default`。
移动端没有紧凑模式。

## 批量与截图

计划文件一次跑完，比逐条命令省往返；带 `axes` 时每个格各跑一遍：

```json
{
  "axes": { "frontend": ["desktop", "mobile"], "theme": ["light", "dark"], "density": ["default", "compact"] },
  "steps": [
    { "read": "tokens", "names": ["--brand-8", "--rc-text-primary"] },
    { "read": "contrast", "foreground": "--rc-text-primary", "background": "--rc-bg-page" }
  ],
  "shots": { "out": "shots" }
}
```

```bash
siyuan-devtools audit plan.json
siyuan-devtools shot --at all --out shots
siyuan-devtools shot --frontend both --theme light,dark --density default,compact --out shots
```

`audit` 的输出是按格对齐的表（列 = step 展开后的字段），截图只给路径与字节数。
`shot` 的 `--at` 与三组维度 flag 是两种写法，不能混用。`mobile × compact` 会被跳过并在
stderr 说明。`shot` 结束时把会话与页面维度还原到截图前。

## 约定

- `--json` 紧凑输出（不缩进）；`--pretty` 才缩进（隐含 `--json`）。
- 端口默认 6806，可用 `SIYUAN_PORT` 或 `--url` 覆盖；`open` 时的 URL 会被记住。
- `--` 之后的参数按字面量处理，例如 `do fill '#inp' -- --json`。
- 退出码 0 = 成功，2 = 失败（错误信息在 stderr）。参数不确定时用 `--help`。
