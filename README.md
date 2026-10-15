# dsh-api-proxy

给 DeepSeek Harness 的 **API 请求单独挂梯子**。

在本机跑一个 mihomo 核心，只把你在设置里列的域名送去代理，**其余流量一律直连**。不开 TUN、不要管理员权限、不装驱动、不改系统代理设置 —— 系统里其它软件完全不受影响。

设置入口：**设置 → API 代理**。

---

## 为什么不是「直接开全局梯子」

- **不碰系统**：mihomo 只监听 `127.0.0.1` 的一个随机端口，走的是普通 HTTP 代理协议。不需要 WinTUN 驱动，不需要管理员权限，关掉 DSH 就什么都没了。
- **只代理该代理的**：网页抓取、联网搜索、HTTP MCP 全部保持直连。只有你列出的 API 域名走梯子。
- **不用常开**：DSH 起来它才起来。

## 安装

需要 DeepSeek Harness（`dsh` 命令可用）与 Node 20+。目前**核心二进制自动下载只支持 Windows**（其它平台手动放一个 mihomo 到 `$DSH_HOME/api-proxy/` 即可）。

**方式一：从 Releases 下载**（不用装 git）

到 [Releases](https://github.com/hutaodog/dsh-api-proxy/releases) 下载最新那个 zip，解压到任意目录，然后：

```powershell
dsh plugin --profile web add link:<解压出来的绝对路径>
```

**方式二：克隆仓库**

```powershell
git clone https://github.com/hutaodog/dsh-api-proxy
dsh plugin --profile web add link:<克隆下来的绝对路径>
```

两种方式装完都要**重启 `dsh web`** 并刷新页面。插件声明了 `dsh.client`，必须进 boot graph，热装不生效。

本插件**零 npm 依赖**（`js-yaml`、`schemastery`、`dsh-http-proxy` 都从 dsh 安装目录里借用），所以安装很快。

> 若 `pnpm` 报 `ERR_PNPM_UNEXPECTED_STORE`（改过 pnpm store 位置），加一个一次性的
> `--store-dir` 指向 `node_modules` 当前链接的那个 store 即可。

装好后在 profile 的 `package.json` 里确认 `dsh.profile.bundles` 含 `dsh-api-proxy` —— `dsh plugin add` 有时只写 dependencies，不写 bundles：

```json
"dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-api-proxy"] } }
```

## 用法

1. 设置 → API 代理 → **下载核心**（zip 约 21 MB，解压后约 58 MB；从 GitHub 下载，失败会自动换国内镜像）
2. 填**订阅地址** → 「保存并刷新」
3. 在「**分流**」里填你的 API 域名（比如 `api.example.com`）→ 「保存并应用」
4. 点「**测速并锁定最快**」挑一个节点
5. 点「**开启**」

之后只要 dsh 启动，插件会自动把核心拉起来并挂上代理。

### 分流

**默认什么都不代理** —— 本插件不预设任何服务商，你得自己填域名。留空时核心规则只剩 `MATCH,DIRECT`，界面会明确提示。

填了 `api.example.com` 之后，生成的核心规则就两条：

```yaml
rules:
  - DOMAIN-SUFFIX,api.example.com,🚀 节点选择
  - MATCH,DIRECT
```

`DOMAIN-SUFFIX` 连子域名一起匹配，所以填 `example.com` 也能覆盖 `api.example.com`。多个域名一行一个。

订阅自带的 600+ 条规则（结尾是 `MATCH,节点选择`，即「国内直连、其余全代理」）会被**整个丢弃** —— 那跟本插件的目标正好相反。

---

## 实测数据（作者本机，2026-10-15）

量的是一个 Cloudflare 后面的境外 API，每次新建连接并读完整 body。

**关键结论：这条直连路径的质量随时间剧烈变化 —— 这才是要挂代理的理由。**

同一天里量到的直连：

| 时刻 | 成功率 | 平均耗时 | 波动 |
|---|---|---|---|
| 关掉全局 TUN 后立刻 | **2/5**（3 次卡死超时） | — | 一次传到 7.4 KB 就断 |
| 半小时后 | 5/5 | 627 ms | 290 – 1339 ms（**4.6 倍**） |
| 又过一阵 | 5/5 | 419 ms | 407 – 428 ms |
| 插件挂上之后 | 5/5 | 218 ms | 206 – 232 ms（1.1 倍） |

同一时间的代理（锁定节点）：

| 节点 | 成功率 | 平均耗时 | 波动 |
|---|---|---|---|
| 🇯🇵日本-B(通用) — tuic | 6/6 | 217 ms | 199 – 251 ms（1.3 倍） |
| 🇯🇵日本-A(通用) | 5/5 | 333 ms | 283 – 503 ms |
| 🇯🇵东京-E(通用) | 5/5 | 582 ms | 538 – 637 ms |
| **auto 组（url-test）** | 5/5 | 2515 ms | 有一次 **11.4 秒** |

**读法：** 代理的延迟取决于你钉哪个节点（日本-B 是 217 ms，和直连最好时持平；换成东京-E 就是 582 ms）。所以代理的价值不是「一定更快」，而是**这条路径由你控制、不随网络抽风**——直连今天能在 3/5 超时和 218 ms 之间反复横跳，代理不会。

**不要用订阅自带的自动选择组。** 实测那个 url-test 组会出现 11 秒的抖动。用「测速并锁定最快」手动钉一个节点。

随时可复测（代理开着的时候）：

```powershell
node verify\compare.mjs
```

---

## 设计要点

```
┌─ dsh web 宿主进程 ────────────────────────────────────┐
│  dsh-api-proxy 插件                                    │
│   ├ 设置命名空间 api-proxy（设置文档）                 │
│   ├ 拉订阅（带 Clash UA）→ 解析 YAML → 缓存节点        │
│   ├ 生成 mihomo 配置（覆盖端口 + 规则）                │
│   ├ 托管 mihomo 子进程（随 dsh 启停、崩溃自动卸代理）  │
│   ├ 调 external-controller REST API → 切节点 / 测延迟  │
│   └ installProxyFromEnvironment() ← 热装 / 热卸        │
│  web server: /dsh-api-proxy/*（自带 loopback 栅栏）    │
└────────────────────────────────────────────────────────┘
              │ HTTP CONNECT → 127.0.0.1:<随机端口>
              ▼
      mihomo（非 TUN）
```

### 开关免重启是怎么做到的

DSH 的 `@deepseek-ai/dsh-http-proxy` 把策略做成「启动时装一次」：启动器在第一个插件加载前调用 `installProxyFromEnvironment()`，装上 undici 的全局 dispatcher。

但那个函数**是公开导出，且返回一个卸载器**。实测可以在进程运行时反复调用：

| 步骤 | 经过假代理的请求数 | |
|---|---|---|
| 基线直连 | 0 | PASS |
| 运行时装入策略 | 1 | PASS |
| 运行时卸载 | 0 | PASS |

所以开关直接换 dispatcher，**不需要重启 dsh**。

> 需要注意：这是该包未文档化的用法（它明确说自己「每进程只有一个答案」）。探针在 `verify/` 里，哪天上游改了行为会先在那里失败。

### 踩过的两个坑（离线测试抓不到，真机上才暴露）

**1. 设置页整块空白 —— `scope` 的原型方法不能裸传。**

`ctx.settingsScope.bind({ namespace, decode })` 返回的是 `new SettingsScopeController(...)` —— 一个**类实例**，`subscribe` 与 `getSnapshot` 都是**原型方法**。

```js
// 错：丢掉 this，React 一调用就抛 TypeError，界面只剩导航项
react.useSyncExternalStore(scope.subscribe, scope.getSnapshot)

// 对：箭头函数包一层，并用 useCallback 固定身份
const subscribe = react.useCallback((l) => scope.subscribe(l), [scope])
const getSnapshot = react.useCallback(() => scope.getSnapshot(), [scope])
react.useSyncExternalStore(subscribe, getSnapshot)
```

`verify/client-sim.mjs` 里的假 scope **刻意写成类**：用对象字面量（箭头函数属性）做假对象不会复现这个 bug。

**2. 失败的动作报告成功 —— `snapshot()` 的 `ok` 覆盖了错误分支的 `ok`。**

```js
// 错：snapshot() 自带 `ok: true`，展开时把前面的 false 盖掉
sendJson(res, 200, { ok: false, error: message, ...snapshot() })

// 对：展开在前，判定在后
sendJson(res, 200, { ...snapshot(), ok: false, error: message })
```

两个坑都有回归断言：`verify/host-sim.mjs` 的 `[2b]`，与 `verify/client-sim.mjs` 的 `[2]`。

### 安全

- **核心只监听 loopback**，`allow-lan: false`、`bind-address: 127.0.0.1`。订阅里原本是 `allow-lan: true` + `bind-address: '*'`，照抄会把代理暴露到局域网。
- **插件路由自带信任栅栏**：这些路由挂在 harness 的 web server 上，但**不在它的 `/api` 栅栏覆盖范围内**。插件自己校验 Host 必须是 loopback（挡 DNS rebinding），带 Origin 的请求其 Origin 也必须是 loopback（挡任意网页发起的跨站请求）。
- **订阅地址存在本机设置文档里**（`$DSH_HOME/settings.yaml` 的 `api-proxy:` 段），明文。它含你的账号令牌。没有用 `role('secret')` 是因为那样设置页就永远读不回这个值、没法编辑。
- **节点列表不落浏览器**：界面只拿到节点名和协议，节点凭据（uuid / password）留在宿主生成的配置里。
- **不给子进程传代理变量**：核心子进程启动时清掉了 `HTTP_PROXY` 等，否则它会绕回自己。

---

## 已知限制

- **只支持 Windows 自动下载核心**。其它平台要手动把 mihomo 放到 `$DSH_HOME/api-proxy/`。
- **只支持 Clash / mihomo 格式的订阅**。base64 的 v2ray 订阅要先转换。
- **订阅拉取要求机场认 Clash 系 User-Agent**。本插件带的是 `clash-verge/v2.0.0`。实测不带 UA 时有些机场返回空响应。
- **不代理 worker 里的代码**。DSH 的 `code-runtime` 与 `workflow` worker 拿不到代理配置（上游设计如此），它们自身的网络请求仍然直连。
- **`web_fetch` / 联网搜索默认直连**。这是「只代理 API」的必然结果。要它们也走代理，得把目标域名加进分流规则。
- **遥测直连**。DSH 的 OTLP 导出器走 `node:http`，全局 dispatcher 够不到（上游设计如此）。
- **改分流规则会重载核心**，正在跑的请求会断。
- **切换分组会让 mihomo 重新测速**，首次请求可能慢一拍。
- **同一时间只支持一个 dsh 实例开这个代理**。核心配置、端口与 pid 文件都在 `$DSH_HOME/api-proxy/` 下按单实例设计：同时跑 `dsh web` 和 `dsh desktop` 并都打开开关，两者会互相抢端口、并在启动时按 pid 文件清理掉对方的核心。用哪个实例就只在那个实例里开。
- **跑 `verify/host-sim.mjs` 之前要先把界面上的开关关掉**：它会按 pid 文件清理「孤儿」核心，而那个文件正属于你正在运行的核心。

## 排错

| 现象 | 处理 |
|---|---|
| 设置页显示「读不到宿主状态」 | 插件没进 boot graph。确认 profile 的 `dsh.` `profile.bundles` 里有 `dsh-api-proxy`，并**重启** `dsh web` |
| 点开启报「订阅返回空内容」 | 链接过期，或机场不认当前 UA |
| 点开启报「订阅里没有 proxies」 | 不是 Clash/mihomo 格式的订阅 |
| 核心状态「异常」 | 看 `$DSH_HOME/api-proxy/mihomo.log` |
| 节点全部测速超时 | tuic / hysteria2 是 QUIC/UDP 协议，这条线路可能对 UDP 不友好；试试 vless 节点 |
| API 还是不通 | 确认分流规则里的域名对得上你的 `baseURL` |

自检端点：

```powershell
curl.exe "http://127.0.0.1:3080/dsh-api-proxy/status"
curl.exe "http://127.0.0.1:3080/dsh-api-proxy/status?diag=1"
```

## 离线验证

`host-sim` 需要一个**你自己的**订阅地址（仓库里不含任何订阅）：

```powershell
$env:DSH_PROXY_TEST_SUB = 'https://你的机场/订阅地址'
node verify\host-sim.mjs     # 36 项：真拉订阅、真起核心、真装 dispatcher、真测速切节点、失败动作必须报 ok=false
node verify\client-sim.mjs   # 42 项：假 ctx 下渲染设置页并点击交互（假 scope 刻意写成类实例）
node verify\compare.mjs      # 直连 vs 走代理的实测对比（需要代理已开启）
```

可选环境变量：`DSH_PROXY_TEST_DOMAIN`（默认 `example.com`）、`DSH_PROXY_TEST_API`（量速度用的 URL）、`DSH_ROOT`（找不到 dsh 安装目录时手工指定）。

`client-sim` 完全离线，不需要订阅，随时可跑。

`host-sim` 会真的启动一次 mihomo 并临时接管该进程的出站流量，跑完自动回收。

> 跑 `host-sim` 之前先把界面上的开关关掉：它会清理 `$DSH_HOME/api-proxy/mihomo.pid` 里的孤儿进程，而那个文件属于正在运行的核心。

## 数据目录

`$DSH_HOME/api-proxy/`

| 文件 | 内容 |
|---|---|
| `mihomo.exe` | 核心 |
| `config.yaml` | 每次启动时按订阅重新生成 |
| `subscription.yaml` | 订阅原文缓存 |
| `nodes.json` | 节点/分组清单缓存 |
| `mihomo.log` | 核心日志 |
| `mihomo.pid` | 用于回收被强杀留下的孤儿进程 |

## 许可

MIT。mihomo 是独立的第三方二进制（GPL-3.0），不在本仓库内分发，由插件在首次使用时下载。
