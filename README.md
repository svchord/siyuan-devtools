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
  siyuan-devtools open [--frontend desktop|mobile] [--device "iPhone 13"] [--viewport 390x844] [--theme light|dark] [--density default|compact] [--headed]
  siyuan-devtools reload [--frontend desktop|mobile] [--viewport 390x844] [--theme light|dark] [--density default|compact]
  siyuan-devtools status [--raw]   默认给测量状态（open/frontend/theme/density/url/viewport），--raw 才是 playwright 会话列表
  siyuan-devtools close

读数（不带 --at：读当前页；带 --at：多场景矩阵）
  siyuan-devtools read env
  siyuan-devtools read tokens <name...>
  siyuan-devtools read element <selector> [--props a,b] [--box [--limit N]] [--meta]
  siyuan-devtools read contrast <fg> <bg>    # fg/bg 可以是令牌名，也可以是 #fff / rgb(...) / hsl(...)

动作（只作用于当前页）
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
  siyuan-devtools audit <plan.json>                   # 计划里写 at / axes
```

## 场景（`--at`）

一个场景是 `frontend/theme/density` 三元组，可以附加任意 `<html>` 属性：

```bash
siyuan-devtools read tokens --brand-8 --at all
siyuan-devtools read element .b3-menu__item --props color --at desktop/dark
siyuan-devtools read contrast --rc-text-primary --rc-bg-page --at desktop
siyuan-devtools read tokens --brand-8 --at desktop/dark/default/data-rc-style=fluent
```

- 取值：`all` 或 `frontend[/theme[/density]][/键=值...]`，逗号分隔多段。
- 省略的段按该段全部取值展开（`desktop` = 4 格，`desktop/dark` = 2 格）。
- 合法域由工具定义：desktop 4 格 + mobile 2 格 = 6 格；`mobile/compact` 不存在。
- 多场景输出是表：`cells`（行标签）+ `columns` + `rows`，所有格相同的列折叠进 `same`，失败的格进 `errors`。

### 页面模型（为什么 `--at` 不会弄乱你的页面）

- `open` 只创建你指定的那一个前端页面。
- 带 `--at` 时：**当前前端直接用你正在交互的那一页**，主题/密度只是改 `<html>` 属性（约 25ms），跑完把属性设回去——菜单、hover、滚动位置都不丢。
- 其它前端（比如 `--at all` 里的 mobile）第一次用到时才创建测量页，之后复用；它放在独立 context 里，不会出现在 `tab-list`。
- `read --at` / `shot --at` 永远不导航你的页面。

计划文件用同一套语法：

```json
{
  "at": "desktop",
  "steps": [
    { "do": "click:.dock__item[data-type=file]" },
    { "read": "element", "selector": ".dock__item[data-type=file]", "props": ["background-color", "width", "height"] },
    { "read": "contrast", "foreground": "--b3-theme-on-background", "background": "--b3-theme-background" }
  ],
  "shots": { "out": "shots" }
}
```

```bash
siyuan-devtools audit plan.json
```

计划里的 `do` 只支持 `hover:<selector>`、`click:<selector>`、`menu:<id>` 三种；其余动作只能在命令行上单独跑。

`audit` 用**独立的测量页**（`measure-only`）：计划里的 `do` 会改动页面，每格开始前 reload，所以不会碰你的交互页。纯读数的计划也走同一条路径，保证结果可复现。`axes` 是 `at` 的结构化写法，额外轴写在 `axes.attrs` 里。

跨前端（`at: all`）时选择器必须在两个前端都存在，否则那个前端的格会记进 `errors`。

## 工作流

```
1. siyuan-devtools open --frontend desktop      # 一次
2. 改源码
3. 等 pnpm dev 输出 [vite-plugin-siyuan] build #N ready
4. siyuan-devtools reload                        # 加载新 CSS
5. 重建交互场景（do hover / do menu ...）
6. read / audit
```

`reload` 会整页刷新，之前的 hover、打开的菜单、滚动位置都会清空；但它会**从当前页面读一次明暗/密度并重放**（导航会把它们重置回思源配置）。状态文件只记页面身份（URL/前端/设备/视口），不再记明暗/密度。

## 设计

引擎是 `playwright-core` 自带的 `cli`（daemon + 持久会话）。CLI 自己只负责：

| 层 | 职责 |
|---|---|
| `scene.ts` | 场景定义与唯一展开（`--at` / `axes` / 截图文件名共用） |
| `batch.ts` | 一次 `run-code` 跑完整个矩阵；页面按前端复用；截图直接落盘 |
| `matrix.ts` | 唯一的矩阵渲染 |
| `commands/*` | 参数校验、把命令编译成一个单步计划 |

页面规则只有一条：**每个前端一个页面**。`open` 建一个；需要别的前端时懒创建；`close` 全关。

## 环境变量

| 变量 | 说明 |
|---|---|
| `SIYUAN_PORT` | kernel 端口，缺省 6806（必须是 1–65535 的整数） |
| `--url` | 直接给前端 URL，覆盖端口拼装；后续命令会记住它 |

`--` 之后的参数一律按字面量处理，用来传以 `--` 开头的值：

```bash
siyuan-devtools do fill '#inp' -- --json     # 把字面量 "--json" 输入到页面
```

## 退出码

- `0` 成功
- `2` 失败（错误信息在 stderr）

## 参与开发

### 提 PR

1. PR 标题必须符合 [Conventional Commits](https://www.conventionalcommits.org/)——CI 会检查：
   - `feat: ...` → 次版本（0.2.0）
   - `fix: ...` → 补丁版本（0.1.1）
   - `feat!: ...` → 1.0 之前只升次版本
   - `docs:` / `chore:` / `ci:` / `test:` / `refactor:` → 不发版
2. 合并方式固定为 **Squash and merge**，PR 标题会成为最终 commit。
3. 本地提交同样受约束：`pnpm install` 会通过 `prepare` 安装 husky 钩子，
   `commit-msg` 用 commitlint 校验单条消息，`pre-push` 校验本次推送新增的提交，
   规则见 `commitlint.config.js`。绕过钩子（`git commit --no-verify`）产生的提交
   会在 push 时被拦下；确实要绕过时用 `git push --no-verify`，并自行确认该提交
   不会进入 CHANGELOG。

### 发布流程

用 [release-please](https://github.com/googleapis/release-please) 自动管理版本，仓库里不手写版本号：

```
普通 PR 合入 main
  └─ release-please 开/更新 Release PR「chore(main): release x.y.z」
       └─ 合并该 PR
            ├─ 自动打 tag、建 GitHub Release、生成 CHANGELOG.md
            └─ pnpm stage publish → 版本进 npm 暂存区
                 └─ 维护者在 npmjs.com 用安全密钥（WebAuthn）批准后才真正上线
```

`package.json` 的 `version` 由 Release PR 更新，不要手动改。

CI 只 **stage** 不直接发布，所以即使 CI 被攻破、或红色 Release PR 被误合并，包也不会自动发出。

### 发布故障排查

- **`OIDC token exchange ... 404`**：见 [npm/cli#9969](https://github.com/npm/cli/issues/9969)，
  影响 2026-07-15 之后创建的仓库（本仓库在内）。若遇到，只能用 granular token 兜底：
  解开 `release-please.yml` 里注释掉的 `NODE_AUTH_TOKEN`，**同时**给 `setup-node`
  加上 `registry-url: https://registry.npmjs.org`——少了 `registry-url`，
  `actions/setup-node` 不会生成 `.npmrc`，`NODE_AUTH_TOKEN` 没有任何东西去读它，
  兜底会静默失效。注意 token 兜底与 npm 的「disallow tokens」加固互斥。
- **`ENEEDAUTH` / `404`**：通常是 trusted publisher 的仓库名、workflow 文件名
  大小写不匹配，或 `package.json` 的 `repository.url` 与 GitHub 仓库不一致。
- 不要用 `npm whoami` 验证 trusted publishing，它不检查发布权限；
  用实际的 stage 操作验证。
