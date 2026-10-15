# 更新日志

本文件记录每一个已发布版本的变更。版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

---

## [未发布]

暂无。

---

## [0.2.2] - 2026-10-15

只改文档，**插件代码与 0.2.1 完全相同**。不需要升级。

### 新增

- **README 增加「常见域名集」一节** —— 把「要给某个服务挂梯子该填哪些域名」这件事写清楚。起因是实测给 GitHub 挂梯子时发现：只填 `github.com` 会漏掉 `raw.` 与 `objects.`，而 release 附件、raw 文件、头像全都走 `githubusercontent.com`；静态资源又在 `githubassets.com`。少了后两条，`git clone` 能过、**下载 release 会卡死**。表格里同时写了「怎么确认没漏」。

### 变更

- README 的「用法」第 3 步指向新的域名集一节。
- 「实测数据」补一组 `github.com` 的对照：直连超时 vs 走代理 200 / 0.21 s，并记录了一个**反证** —— 同一时刻 `google.com` 走这个代理打不开，正说明它没被列进分流、按 `MATCH,DIRECT` 直连撞了墙。如果插件是「全都走代理」，google 反而会通。
- README 里「用『测速并锁定最快』手动钉一个节点」这句已经过时（那个按钮在 0.2.0 去掉了），改成指向「⚡ 自动」。
- `package.json` 的 `version` 补到 `0.2.2`（0.2.1 发布时漏了同步，它一直写着 0.2.0）。

---

## [0.2.1] - 2026-10-15

只动验证脚本，插件行为与 0.2.0 完全相同。

### 新增

- `verify/env-dedupe.mjs` —— 把「Windows 环境块重复键」这个已知问题的**实测范围**固化成脚本：dsh 进程自己没有重复键、派生的 shell 有、而用 Node `spawn` 合成的同样环境对象没有。它只断言已证实的部分，不去猜没验证的根因。

### 修复

- 该脚本里的正则误用了 JS 不支持的 `(?i)` 内联标志，运行即抛 `SyntaxError`。
- 该脚本把「子进程拿到的是外层已有的代理端口、不是本进程刚装的那个」判成了失败。那是 `proxyEnvironmentForChild()` 的**设计行为**（用户自己指定过的 scheme 原样透传给子进程），不是 bug，断言已改成只要求指向一个 loopback 代理。

---

## [0.2.0] - 2026-10-15

节点选择拆成「自动 / 固定」两种模式，并修掉两个隐藏很深的 bug。

### 新增

- **节点选择分两种模式**，节点列表里选什么就是什么模式，没有额外开关：
  - **⚡ 自动（每次开启测速选最快）** —— 每次开启（含 dsh 启动时的自动开启）都先测速，再切到延迟最低的节点。
  - **固定某个节点** —— 每次都连它，**不测速、不覆盖**。选了日本就一直走日本。
- **自动选节点的候选里排除子分组**。订阅常把「自动选择」这类 `url-test` 组塞进选择组当成员，它往往还测得最快 —— 但不能自动选它：`url-test` 组会在会话中途重新测速并换节点，那会直接掐断正在流式的 LLM 响应。手动选它仍然允许（用户自己的选择优先）。
- `autopick` 动作：切换回自动模式并立刻测一次速，界面马上能看到结果。
- `dedupeProxyEnv()`：插件装/卸 dispatcher 之后各压一次 dsh 进程自己的环境块，把「两种大小写各写一份」合并成一份。在 POSIX 上两种大小写是两个不同变量（正确），但在 Windows 上会产生重复键。

### 修复

- **`targetNode` 从来没有写回 mihomo。** 用户选的节点存进了设置文档，但核心启动时从来没被应用过 —— 于是核心一重启，分组就掉回配置里的默认项，通常正是那个会抖到 11 秒的 `url-test` 组。「选了日本，下次开机还是日本」这件事之前根本不成立。
- **重载核心后 dispatcher 指向一个已经消失的端口。** 核心每次启动都取新的随机端口，而 `enableProxy()` 见到「已装」就直接 `return`，端口变了也不重装。症状极其隐蔽：走代理的请求**全部**失败，但 `proxy.installed` 仍然是 `true`、状态页一片绿。点「保存并应用」分流规则（内部走 `reload`）就会踩到。现在所有「换一个核心进程」的路径统一走 `restartCore()`。

### 变更

- **自动选节点的逻辑从浏览器挪到宿主侧。** dsh 启动时的自动开启根本不经过浏览器，放在前端等于那条路径永远不测速。
- `apply()` 不再 `await autoStart()`。开启现在含一次全节点测速（45 个节点、5 秒超时），await 进插件装配会把 dsh 的启动拖十几秒。
- 「测速并锁定最快」这个独立按钮去掉了 —— 它会把「最快」直接写成固定选择，用户再也回不到自动模式。改成列表里可选的一项，与具体节点平级。
- 状态接口新增 `mode`（`auto` / `fixed`）与 `proxy.boundPort`（dispatcher 实际指向的端口；与 `proxy.port` 不同就是 bug）。

### 实测

同期在这台机器上量到的对比（同一个境外 API，每次新建连接读完整 body）：

| | 成功率 | 耗时 |
|---|---|---|
| 直连 | **0/5** | — |
| 走代理（自动选中 🇺🇸西美-E） | 5/5 | 704 ms |
| 走代理（固定 ❇️双鱼座-B(教育)） | 5/5 | 363 ms（357–367，极稳） |

---

## [0.1.0] - 2026-10-15

首个版本。

### 新增

- 导入 **Clash / mihomo 订阅**。机场普遍按 User-Agent 分流，不带 Clash 系 UA 会拿到空响应，插件自动带上 `clash-verge/v2.0.0`。
- **托管 mihomo 核心子进程**：随 dsh 启停、崩溃自动卸代理、启动时按 pid 文件回收上一轮被强杀留下的孤儿。核心只监听 `127.0.0.1` 的随机端口，强制 `allow-lan: false` + `bind-address: 127.0.0.1`（订阅里原本是 `allow-lan: true` + `bind-address: '*'`，照抄会把代理暴露到局域网）。
- **按域名精确分流**：只把设置里列的域名送去代理，其余一律 `MATCH,DIRECT`。订阅自带的 600+ 条规则（结尾是 `MATCH,节点选择`，即「国内直连、其余全代理」）会被整个丢弃。
- **开关免重启**：调 `@deepseek-ai/dsh-http-proxy` 的公开导出 `installProxyFromEnvironment()` 热装/热卸 undici 全局 dispatcher。
- **设置页**（设置 → API 代理）：订阅地址、分流规则、节点列表、测速、手动选节点、状态与诊断。
- 一键从 GitHub 下载核心，失败自动回退到国内镜像。
- 插件路由自带 **loopback 信任栅栏**：这些路由挂在 harness 的 web server 上但不在它的 `/api` 栅栏覆盖范围内，因此自己校验 Host 必须是 loopback（挡 DNS rebinding），带 Origin 的请求其 Origin 也必须是 loopback（挡任意网页发起的跨站请求）。

### 开发期间修掉的问题（都在首个发布之前）

- **设置页整块空白。** `ctx.settingsScope.bind()` 返回的是 `SettingsScopeController` 的**类实例**，`subscribe` / `getSnapshot` 是原型方法。裸传给 `useSyncExternalStore` 会丢掉 `this`，React 一调用就抛 `TypeError`，整个设置页渲染不出来、只剩导航项。
- **失败的动作报告成功。** `sendJson(res, 200, { ok: false, error, ...snapshot() })` 里 `snapshot()` 自带的 `ok: true` 把前面的 `false` 覆盖掉了 —— 任何失败都会在界面上显示成成功。

两个坑都有回归断言（`verify/host-sim.mjs` 的 `[2b]`、`verify/client-sim.mjs` 的 `[2]`），README 里也记了成因。

---

## 已知问题

开着代理时，dsh 派生的 shell（pwsh / bash 工具）里执行 `Get-ChildItem env:` 或任何 .NET 的环境枚举会抛 `An item with the same key has already been added`。原因是环境块里同时存在 `https_proxy` 与 `HTTPS_PROXY`。

实测范围：**dsh 进程自己没有**（插件在装/卸后各压一次），**dsh 派生的 shell 有**，而用 Node `spawn` + 同样环境对象合成出来的子进程**没有** —— 说明去重发生在 Node 构建环境块那一步，真正产生重复的是 dsh 更底层的某条 spawn 路径。**没有定位到确切位置**，也没有从插件侧绕过的办法（`proxyEnvironmentForChild()` 无条件写两种大小写，没有开关）。

影响面很窄：按名字读变量的工具（git / curl / node / python）全部正常，只有枚举整个环境的消费者会炸。详见 [README 的「已知问题」](README.md#已知问题dsh-的-pwsh--bash-工具里-get-childitem-env-会报错)。

---

[未发布]: https://github.com/hutaodog/dsh-api-proxy/compare/v0.2.2...HEAD
[0.2.2]: https://github.com/hutaodog/dsh-api-proxy/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/hutaodog/dsh-api-proxy/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/hutaodog/dsh-api-proxy/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/hutaodog/dsh-api-proxy/releases/tag/v0.1.0
