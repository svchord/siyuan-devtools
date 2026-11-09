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

读数
  siyuan-devtools read env
  siyuan-devtools read tokens <name...>
  siyuan-devtools read element <selector> [--props a,b] [--box [--limit N]] [--meta]
  siyuan-devtools read contrast <fg> <bg>    # fg/bg 可以是令牌名，也可以是 #fff / rgb(...) / hsl(...)

动作（click/hover/dblclick/fill/drag/select 支持 --diff a,b）
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
  siyuan-devtools audit <plan.json> [--json]     # 计划可带 axes，一次跑完所有模式
  siyuan-devtools shot [--frontend both|desktop|mobile] [--theme light,dark] [--density default,compact] [--out shots]
  siyuan-devtools shot --at all --out shots       # 同上，用格语法表达
```

`--theme` / `--density` 都接受逗号多值，展开成「前端 × 明暗 × 密度」的格子，一条命令出全部截图；
文件名带生效维度（`desktop-light-compact.png`）。移动端没有紧凑模式（上游 `isCompactModeAvailable`
只允许桌面系），`mobile × compact` 会被跳过并在 stderr 说明原因。

## 测量格（`--at`）

三个维度（frontend / theme / density）可以写成**一个格** `desktop/dark/default`，
任何读数与动作都能用 `--at` 指定，一条命令在多个格上取值：

```bash
siyuan-devtools read tokens --brand-8 --at all
siyuan-devtools read element .b3-menu__item --props color --at desktop/dark
siyuan-devtools read contrast --rc-text-primary --rc-bg-page --at desktop/dark
siyuan-devtools do hover .b3-menu__item --diff color --at desktop/dark/default
```

`--at` 取值：`all` 或 `frontend[/theme[/density]]`，逗号分隔多段。省略的段按该段全部取值展开
（`desktop` = 4 格，`desktop/dark` = 2 格）。合法域由工具定义：desktop 4 格 + mobile 2 格 = 6 格，
`mobile/compact` 不存在。

多格输出是一张表：列只写一次、行是纯值数组，所有格相同的列折叠进 `same`。`--at` 是纯命令，
执行完会把页面还原到进入前的格；`do --at` 例外（它就是要改变页面状态）。

计划文件也可以声明轴，效果与 `--at all` 相同：

```json
{
  "axes": { "frontend": ["desktop", "mobile"], "theme": ["light", "dark"], "density": ["default", "compact"] },
  "steps": [ { "read": "tokens", "names": ["--brand-8"] } ],
  "shots": { "out": "shots" }
}
```

`--frontend mobile` 默认模拟 iPhone 13（dpr 3、移动端 UA、touch），CSS 视口仍是 390x844；`desktop` 默认 1600x1000 与 dpr 1。
`--device` 只在 `open` 时用原生设备模拟；已有会话上切换前端时，`reload` / `audit` / `shot`
会改用 CDP 就地切换设备参数（dpr / UA / touch / pointer 全部一致），不重开浏览器。

`--theme` 不只是改 `data-theme-mode` 属性：内置 daylight/midnight 的配色是两张独立 CSS，
所以切换时会一并换掉 `#themeDefaultStyle` / `#themeStyle` 的 `href`。只改属性对内置主题无效。

`reload` 会重放会话里记录的 `--theme` / `--density`：导航会把它们重置回思源配置，
不重放的话「设暗色 → 改 CSS → reload → 测量」会静默测成亮色。

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
| `read *`、`do menu/dock/attr/reset` | `cli --json eval` 跑页面 JS 片段 |
| `audit` | `cli --json run-code`，整个计划一次执行 |

`open` 会起新 Chrome；会话按 Playwright 的 workspace（向上查找 `.playwright/`）隔离。同一 workspace 已有会话时不要重复 `open`（它会杀掉旧的），加载新产物用 `reload`。

会话状态（入口 URL、前端、设备、视口、明暗、密度）记在 `.playwright/siyuan-devtools.json`，所以 `reload` / `audit` / `shot` 不带 `--url` 时会沿用 `open` 时的实例，`reload` 也会重放明暗与密度。

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
