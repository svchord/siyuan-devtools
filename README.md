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
  siyuan-devtools open [--frontend desktop|mobile] [--device "iPhone 13"] [--viewport 390x844] [--headed]
  siyuan-devtools reload [--frontend desktop|mobile] [--viewport 390x844]
  siyuan-devtools status [--json]
  siyuan-devtools close

读数
  siyuan-devtools read env
  siyuan-devtools read tokens <name...>
  siyuan-devtools read element <selector> [--props a,b] [--box] [--limit N]
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
  siyuan-devtools audit <plan.json> [--json]
  siyuan-devtools shot [--frontend both|desktop|mobile] [--theme dark|light] [--density comfortable|compact] [--out shots]
```

`--frontend mobile` 默认使用 390x844 视口；`desktop` 默认 1600x1000。`shot` 会按前端分别设置标准视口。

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

`open` 会起新 Chrome；会话按当前工作目录隔离。同一目录会话已存在时不要重复 `open`（它会杀掉旧的），加载新产物用 `reload`。

## 环境变量

| 变量 | 说明 |
|---|---|
| `SIYUAN_PORT` | kernel 端口，缺省 6806 |
| `--url` | 直接给前端 URL，覆盖端口拼装 |

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
