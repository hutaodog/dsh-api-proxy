/**
 * dsh-api-proxy — 宿主侧（host half）。
 *
 * 把「Clash 订阅」变成本机一个只服务 DSH 的 HTTP 代理端口，并把 DSH 的出站
 * 流量**只对指定 API 域名**挂到那个端口上。全程不碰系统路由、不开 TUN、
 * 不需要管理员权限 —— 这是它和「全局梯子」的根本区别。
 *
 * 三块职责：
 *   1. 订阅：带 Clash UA 拉取 → 解析 YAML → 缓存节点/分组
 *   2. 核心：按订阅生成 mihomo 配置（覆盖端口与规则）→ 托管子进程
 *   3. 接线：调 `installProxyFromEnvironment()` 热装/热卸全局 dispatcher，
 *      因此开关**不需要重启 dsh**（已实测）
 *
 * 节点切换与测速走 mihomo 自带的 external-controller REST API，不需要重启核心。
 */

import { spawn, execFileSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Cordis 插件名。 */
export const name = 'dsh-api-proxy'

/** 只依赖 web server 来挂自己的同源路由。 */
export const inject = ['webServer']

/** 设置命名空间，与浏览器侧共享。 */
const SETTINGS_NS = 'api-proxy'

/** 状态路由：报告一切，但绝不回传订阅里的节点凭据。 */
const STATUS_ROUTE = '/dsh-api-proxy/status'

/** 动作路由：开关 / 刷新订阅 / 选节点 / 测速 / 重启核心。 */
const ACTION_ROUTE = '/dsh-api-proxy/action'

/** mihomo 版本与下载源。 */
const MIHOMO_VERSION = 'v1.19.32'
const MIHOMO_ASSET = `mihomo-windows-amd64-compatible-${MIHOMO_VERSION}.zip`
const MIHOMO_URL = `https://github.com/MetaCubeX/mihomo/releases/download/${MIHOMO_VERSION}/${MIHOMO_ASSET}`
/** 国内直连 GitHub 常被重置，按序回退到镜像。 */
const MIRRORS = ['https://ghfast.top/', 'https://gh-proxy.com/', 'https://gh.llkk.cc/', 'https://ghproxy.net/']

/** 设置项默认值。键名同时是设置文档里的字段名。 */
const DEFAULTS = {
  /** 总开关；为 true 时 dsh 启动会自动拉起核心并挂上代理。 */
  enabled: false,
  /** 机场订阅地址（Clash / mihomo 格式）。 */
  subscriptionUrl: '',
  /**
   * 要挂梯子的域名后缀，逗号/空格/换行分隔；其余一律直连。
   *
   * 默认空 —— 本插件不预设任何服务商。留空等于 `MATCH,DIRECT`，也就是挂了
   * 核心但什么都不代理，界面上会明确提示。
   */
  apiDomains: '',
  /** 用哪个策略组承载 API 流量；留空则自动挑一个 select 组。 */
  targetGroup: '',
  /**
   * 固定使用哪个节点。**两种模式就看这一个字段**：
   *
   * - 空串 = **自动模式**：每次开启（含 dsh 启动时）都先测速，再切到延迟最低的
   *   真实节点。候选里排除子分组 —— url-test 组会在流式响应中途换节点，
   *   那会直接掐断正在生成的 LLM 回复。
   * - 非空 = **固定模式**：每次开启都切到这个值，不测速、不覆盖。可以填一个
   *   具体节点名，也可以填订阅自己的分组名（比如「自动选择」），
   *   那就等于把这个决定交回给 mihomo。
   */
  targetNode: '',
  /** 测速用的目标地址。 */
  testUrl: 'https://www.gstatic.com/generate_204',
}

/** 由 DSH_HOME 决定的数据目录。 */
function resolveHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim()
  return join(homedir(), '.dsh')
}

const DATA_DIR = join(resolveHome(), 'api-proxy')
const CORE_PATH = join(DATA_DIR, process.platform === 'win32' ? 'mihomo.exe' : 'mihomo')
const CONFIG_PATH = join(DATA_DIR, 'config.yaml')
const CACHE_PATH = join(DATA_DIR, 'subscription.yaml')
const STATE_PATH = join(DATA_DIR, 'nodes.json')
const LOG_PATH = join(DATA_DIR, 'mihomo.log')
const PID_PATH = join(DATA_DIR, 'mihomo.pid')

/* ===================================================================== *
 * 运行期状态
 * ===================================================================== */

/** 当前设置快照，由 {@link settingsOwner} 读出。 */
let settingsOwner = null

/** 宿主侧诊断，供 `?diag=1` 暴露。 */
const diagnostics = {
  settingsSource: 'none',
  injectFired: false,
  registered: false,
  registerError: null,
  autoStart: 'idle',
}

/** 核心与代理的实时状态。 */
const runtime = {
  /** 'stopped' | 'starting' | 'running' | 'failed' */
  core: 'stopped',
  coreError: null,
  coreVersion: null,
  /** 本机 HTTP 代理端口（mihomo mixed-port）。 */
  mixedPort: null,
  /** mihomo external-controller 的端口与密钥。 */
  controllerPort: null,
  controllerSecret: null,
  /** 全局 dispatcher 当前是否已挂到本插件的端口上。 */
  proxyInstalled: false,
  /** dispatcher 实际指向的端口。与 `mixedPort` 不一致就说明该重装了。 */
  proxyPort: null,
  /** 订阅本身（解析后的 YAML 对象）。 */
  subscription: null,
  /** 订阅解析结果的元信息（流量、到期、抓取时间）。 */
  subscriptionInfo: null,
  /** 节点与分组缓存。 */
  groups: [],
  proxies: [],
  /** 最近一次自动测速选节点的结果：`{ name, delay, group, tested, usable, at }`。 */
  autoPick: null,
  /** 自动测速进行中时为真，供界面显示「测速中…」。 */
  autoPicking: false,
  /** 最近一次操作的结果，给界面显示。 */
  lastMessage: null,
}

/** 子进程与 dispatcher 卸载器。 */
let child = null
let disposeProxy = null
/** 用户主动停止时置位，避免 exit 处理器把它当成崩溃。 */
let stoppingOnPurpose = false

/* ===================================================================== *
 * 运行时模块加载（Windows junction 安装时普通 import 会失败）
 * ===================================================================== */

/**
 * 按 voice-input 验证过的两级策略加载一个依赖：普通 import 优先；失败则用
 * `createRequire(process.argv[1])` 定位 dsh 安装目录里那份，再按绝对路径 import。
 * dsh plugin add link: 在 Windows 上装的是 junction，Node 会按链接**真实路径**
 * 解析，于是解析会落到 profile 模块树之外而失败。
 * @param spec - 包名。
 * @param candidates - 该包内可用的入口相对路径（按序尝试）。
 * @param validate - 判断加载结果是否可用。
 * @returns 加载到的模块，或 undefined。
 */
async function loadRuntimeModule(spec, candidates, validate) {
  try {
    const loaded = await import(spec)
    if (validate(loaded)) return loaded
    if (loaded?.default !== undefined && validate(loaded.default)) return loaded.default
  } catch {
    // 落到 vendored 副本。
  }
  try {
    const dshEntry = process.argv[1]
    if (typeof dshEntry === 'string' && dshEntry !== '') {
      const require = createRequire(pathToFileURL(dshEntry))
      const manifest = require.resolve(`${spec}/package.json`)
      for (const relative of candidates) {
        const entry = join(dirname(manifest), relative)
        if (!existsSync(entry)) continue
        const loaded = await import(pathToFileURL(entry).href)
        if (validate(loaded)) return loaded
        if (loaded?.default !== undefined && validate(loaded.default)) return loaded.default
      }
    }
  } catch {
    // 两条路都不通。
  }
  return undefined
}

/** schemastery 命名空间，或 undefined。 */
const loadSchemastery = () =>
  loadRuntimeModule(
    '@deepseek-ai/schemastery',
    [join('lib', 'index.mjs'), join('lib', 'index.js')],
    (m) => typeof (m?.default ?? m) === 'function',
  ).then((m) => (m === undefined ? undefined : (m.default ?? m)))

/** js-yaml，或 undefined。 */
const loadYaml = () =>
  loadRuntimeModule('js-yaml', [join('index.js'), join('dist', 'js-yaml.mjs')], (m) =>
    typeof (m?.load ?? m?.default?.load) === 'function',
  ).then((m) => {
    if (m === undefined) return undefined
    const picked = typeof m.load === 'function' ? m : m.default
    return picked !== undefined && typeof picked.load === 'function' ? picked : undefined
  })

/** dsh-http-proxy，或 undefined。 */
const loadHttpProxy = () =>
  loadRuntimeModule(
    '@deepseek-ai/dsh-http-proxy',
    [join('lib', 'index.js')],
    (m) => typeof m?.installProxyFromEnvironment === 'function',
  ).then((m) => (typeof m?.installProxyFromEnvironment === 'function' ? m : undefined))

/* ===================================================================== *
 * 设置
 * ===================================================================== */

/**
 * 把设置文档里的一段规范成完整设置，缺字段落回默认值。
 * @param raw - `settingsOwner.get()` 的返回值。
 * @returns 完整设置对象。
 */
function normalizeSettings(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  const value = { ...DEFAULTS }
  for (const key of Object.keys(DEFAULTS)) {
    const candidate = source[key]
    if (candidate === undefined || candidate === null) continue
    value[key] = typeof DEFAULTS[key] === 'boolean' ? candidate === true : String(candidate)
  }
  return value
}

/** 读取当前设置。 */
function readSettings() {
  return normalizeSettings(settingsOwner === null ? undefined : settingsOwner.get())
}

/* ===================================================================== *
 * 小工具
 * ===================================================================== */

/** 取一个当前空闲的 loopback 端口。存在极小的竞争窗口，可接受。 */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      server.close(() => (port > 0 ? resolve(port) : reject(new Error('无法分配空闲端口'))))
    })
  })
}

/** 生成 external-controller 的随机密钥。 */
function randomSecret() {
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 36).toString(36)).join('')
}

/** 把任意值当字符串安全取用。 */
function asString(value) {
  return typeof value === 'string' ? value : ''
}

/**
 * 判断请求是否来自本机浏览器。
 *
 * 这些路由由 harness 的 web server 服务，但**不在它的 `/api` 栅栏覆盖范围内**，
 * 所以栅栏要自己实现：Host 必须是 loopback（挡 DNS rebinding），若带 Origin
 * 则 Origin 也必须是 loopback（挡任意网页发起的跨站请求）。无 Origin 的请求
 * （同源 GET、curl、健康检查）放行 —— 网页无法伪造这种情况。
 * @param req - Node 请求对象。
 * @returns 是否放行。
 */
function isTrustedBrowser(req) {
  const host = req.headers?.host
  if (typeof host !== 'string' || host === '') return false
  if (!isLoopbackAuthority(host)) return false
  const origin = req.headers?.origin
  if (typeof origin !== 'string' || origin === '') return true
  try {
    return isLoopbackAuthority(new URL(origin).host)
  } catch {
    return false
  }
}

/**
 * `authority` 是不是一个 loopback 主机（可带端口）。
 * @param authority - `host` 或 `host:port`，IPv6 可带方括号。
 * @returns 是否 loopback。
 */
function isLoopbackAuthority(authority) {
  let host = authority.trim()
  if (host.startsWith('[')) {
    const end = host.indexOf(']')
    if (end === -1) return false
    host = host.slice(1, end)
  } else {
    const colon = host.lastIndexOf(':')
    if (colon !== -1) host = host.slice(0, colon)
  }
  host = host.toLowerCase()
  if (host === 'localhost' || host === '::1' || host === '0.0.0.0') return true
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
}

/** 回一个 JSON 响应。 */
function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8')
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(body.length),
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

/** 读一个 JSON 请求体，带大小上限。 */
function readJsonBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (text.trim() === '') return resolve({})
      try {
        resolve(JSON.parse(text))
      } catch {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

/* ===================================================================== *
 * mihomo external-controller 客户端
 * ===================================================================== */

/**
 * 调一次 mihomo 的 REST API。
 *
 * 目标是 127.0.0.1，而 `dsh-http-proxy` 永远绕过 loopback，所以这些调用绝不会
 * 被自己刚装上的代理绕回去。
 * @param path - 控制器路径，含 query。
 * @param init - fetch 选项。
 * @returns 解析后的 JSON，或 null。
 */
async function controller(path, init = {}) {
  if (runtime.controllerPort === null) throw new Error('核心未运行')
  const url = `http://127.0.0.1:${runtime.controllerPort}${path}`
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${runtime.controllerSecret}`,
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(20000),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`mihomo ${path} -> HTTP ${response.status} ${text.slice(0, 200)}`)
  return text.trim() === '' ? null : JSON.parse(text)
}

/** 轮询控制器直到就绪。 */
async function waitForController(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  let lastError = null
  while (Date.now() < deadline) {
    try {
      const payload = await controller('/version')
      if (payload !== null) {
        runtime.coreVersion = asString(payload.version) || null
        return
      }
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`核心启动超时：${lastError instanceof Error ? lastError.message : '无响应'}`)
}

/* ===================================================================== *
 * 订阅
 * ===================================================================== */

/**
 * 拉取订阅。机场普遍按 User-Agent 分流：不带 Clash 系 UA 会拿到空响应，
 * 所以这里必须伪装成 Clash 客户端。
 * @param url - 订阅地址。
 * @returns 原始 YAML 文本与几个有信息量的响应头。
 */
async function fetchSubscription(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'clash-verge/v2.0.0',
      Accept: '*/*',
      'Accept-Encoding': 'identity',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(40000),
  })
  if (!response.ok) throw new Error(`订阅返回 HTTP ${response.status}`)
  const text = await response.text()
  if (text.trim() === '') {
    throw new Error('订阅返回空内容：链接可能已过期，或该机场要求 Clash 系 User-Agent（本插件已带）')
  }
  return {
    text,
    userinfo: response.headers.get('subscription-userinfo'),
    updateInterval: response.headers.get('profile-update-interval'),
    fileName: decodeURIComponent(
      (response.headers.get('content-disposition') ?? '').replace(/^.*filename\*=UTF-8''/, ''),
    ),
  }
}

/**
 * 解析 `subscription-userinfo` 头。
 * @param header - 形如 `upload=1; download=2; total=3; expire=4`。
 * @returns 字节数与到期时间，缺项为 null。
 */
function parseUserInfo(header) {
  if (typeof header !== 'string' || header === '') return null
  const fields = {}
  for (const part of header.split(';')) {
    const [key, value] = part.split('=').map((piece) => piece.trim())
    if (key !== undefined && value !== undefined && value !== '') fields[key] = Number(value)
  }
  const pick = (key) => (Number.isFinite(fields[key]) ? fields[key] : null)
  return {
    upload: pick('upload'),
    download: pick('download'),
    total: pick('total'),
    expire: pick('expire'),
  }
}

/* ===================================================================== *
 * 配置生成
 * ===================================================================== */

/**
 * 从订阅里挑出承载 API 流量的策略组。
 * @param wanted - 用户指定的组名。
 * @param groups - 订阅里的 proxy-groups 数组。
 * @returns 组名。
 */
function pickGroup(wanted, groups) {
  const list = Array.isArray(groups) ? groups : []
  const names = list.map((group) => asString(group?.name)).filter((value) => value !== '')
  if (wanted !== '' && names.includes(wanted)) return wanted
  // 优先挑名字像「节点选择」的 select 组，那是用户手动选节点的地方。
  const select = list.find(
    (group) => asString(group?.type) === 'select' && /节点选择|选择|select/i.test(asString(group?.name)),
  )
  if (select !== undefined) return asString(select.name)
  const anySelect = list.find((group) => asString(group?.type) === 'select')
  if (anySelect !== undefined) return asString(anySelect.name)
  if (names.length > 0) return names[0]
  // 订阅没给分组时，用内置的兜底组名（buildCoreConfig 会补一个同名组）。
  return 'PROXY'
}

/**
 * 生成规则：只把列出的域名后缀送去代理组，其余一律直连。
 *
 * 机场自带 600+ 条规则、结尾是 `MATCH,节点选择`（国内直连、其余全代理），
 * 与本插件的目标正好相反，所以整个替换掉。
 * @param apiDomains - 逗号/空白分隔的域名后缀。
 * @param group - 承载 API 流量的组名。
 * @returns 规则数组。
 */
function buildRules(apiDomains, group) {
  const rules = []
  const seen = new Set()
  for (const entry of apiDomains.split(/[\s,;]+/)) {
    const domain = entry.trim().replace(/^\*?\.?/, '')
    if (domain === '' || seen.has(domain)) continue
    seen.add(domain)
    rules.push(`DOMAIN-SUFFIX,${domain},${group}`)
  }
  rules.push('MATCH,DIRECT')
  return rules
}

/**
 * 归一化 DNS 段。
 *
 * 订阅里是给 TUN 用的 `fake-ip` 配置；本插件不开 TUN，HTTP 代理模式下由 mihomo
 * 自己解析目标域名，`normal` 才是对的。
 * @param source - 订阅里的 dns 段。
 * @returns mihomo 的 dns 段。
 */
function buildDns(source) {
  const section = source !== null && typeof source === 'object' ? source : {}
  const list = (key, fallback) =>
    Array.isArray(section[key]) && section[key].length > 0 ? section[key] : fallback
  return {
    enable: true,
    ipv6: false,
    'enhanced-mode': 'normal',
    'use-hosts': true,
    'respect-rules': false,
    'default-nameserver': list('default-nameserver', ['223.5.5.5', '119.29.29.29']),
    nameserver: list('nameserver', ['https://dns.alidns.com/dns-query', 'https://doh.pub/dns-query']),
    'proxy-server-nameserver': list('proxy-server-nameserver', [
      'https://223.5.5.5/dns-query',
      'https://doh.pub/dns-query',
    ]),
  }
}

/**
 * 由订阅生成 mihomo 配置。
 *
 * 端口、控制器、LAN 暴露与规则一律覆盖：订阅里的 `mixed-port: 7890`、
 * `allow-lan: true`、`bind-address: '*'` 是给桌面客户端用的，照抄会跟用户
 * 已有的客户端抢端口、并把代理暴露到局域网。
 * @param subscription - 解析后的订阅对象。
 * @param settings - 当前设置。
 * @param ports - `{ mixedPort, controllerPort, secret }`。
 * @returns mihomo 配置对象。
 */
function buildCoreConfig(subscription, settings, ports) {
  const groups = Array.isArray(subscription['proxy-groups']) ? subscription['proxy-groups'] : []
  const group = pickGroup(settings.targetGroup, groups)
  const effectiveGroups =
    groups.length > 0
      ? groups
      : [
          {
            name: 'PROXY',
            type: 'select',
            proxies: (Array.isArray(subscription.proxies) ? subscription.proxies : [])
              .map((proxy) => asString(proxy?.name))
              .filter((value) => value !== ''),
          },
        ]
  const config = {
    'mixed-port': ports.mixedPort,
    'allow-lan': false,
    'bind-address': '127.0.0.1',
    mode: 'rule',
    'log-level': 'warning',
    ipv6: false,
    'unified-delay': true,
    'tcp-concurrent': true,
    'find-process-mode': 'off',
    'external-controller': `127.0.0.1:${ports.controllerPort}`,
    secret: ports.secret,
    'geodata-mode': false,
    hosts: subscription.hosts,
    dns: buildDns(subscription.dns),
    proxies: subscription.proxies,
    'proxy-groups': effectiveGroups,
    rules: buildRules(settings.apiDomains, group),
  }
  if (config.hosts === undefined) delete config.hosts
  return { config, group }
}

/* ===================================================================== *
 * 核心进程
 * ===================================================================== */

/** 清掉会让 mihomo 自己绕回自己的代理环境变量。 */
function childEnv() {
  const env = { ...process.env }
  for (const key of [
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'ALL_PROXY',
    'NO_PROXY',
    'http_proxy',
    'https_proxy',
    'all_proxy',
    'no_proxy',
    'NODE_USE_ENV_PROXY',
  ]) {
    delete env[key]
  }
  return env
}

/** 清理上一轮被强杀留下的核心进程。 */
function killOrphan() {
  if (!existsSync(PID_PATH)) return
  const pid = Number(readFileSync(PID_PATH, 'utf8').trim())
  rmSync(PID_PATH, { force: true })
  if (!Number.isInteger(pid) || pid <= 0) return
  try {
    const listing = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
      encoding: 'utf8',
      windowsHide: true,
    })
    // 只杀确认是我们那个二进制的进程：PID 会被系统复用，凭 pidfile 直接杀太危险。
    if (/mihomo/i.test(listing)) {
      execFileSync('taskkill', ['/PID', String(pid), '/F', '/T'], { stdio: 'ignore', windowsHide: true })
    }
  } catch {
    // 进程已不在，或 tasklist 不可用。
  }
}

/** 结束当前核心进程。 */
async function stopCore() {
  const current = child
  child = null
  runtime.core = 'stopped'
  runtime.coreVersion = null
  if (current === null) return
  stoppingOnPurpose = true
  try {
    current.kill()
  } catch {
    // 已经退出。
  }
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      try {
        execFileSync('taskkill', ['/PID', String(current.pid), '/F', '/T'], {
          stdio: 'ignore',
          windowsHide: true,
        })
      } catch {
        // 已经不在了。
      }
      resolve()
    }, 3000)
    current.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
  })
  rmSync(PID_PATH, { force: true })
}

/**
 * 启动核心。
 * @param settings - 当前设置。
 * @param subscription - 解析后的订阅。
 * @returns 生效的组名与端口。
 */
async function startCore(settings, subscription) {
  if (!existsSync(CORE_PATH)) {
    throw new Error(`找不到核心：${CORE_PATH}。请先点「下载核心」。`)
  }
  await stopCore()
  runtime.core = 'starting'
  runtime.coreError = null

  const mixedPort = await freePort()
  const controllerPort = await freePort()
  const secret = randomSecret()
  const { config, group } = buildCoreConfig(subscription, settings, { mixedPort, controllerPort, secret })

  const yaml = await loadYaml()
  if (yaml === undefined) throw new Error('无法加载 js-yaml，写不出核心配置')
  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(CONFIG_PATH, yaml.dump(config, { lineWidth: -1, noRefs: true }), 'utf8')

  const log = createWriteStream(LOG_PATH, { flags: 'a' })
  log.write(`\n===== ${new Date().toISOString()} 启动核心 =====\n`)
  const spawned = spawn(CORE_PATH, ['-d', DATA_DIR, '-f', CONFIG_PATH], {
    cwd: DATA_DIR,
    env: childEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  spawned.stdout.pipe(log)
  spawned.stderr.pipe(log)
  spawned.on('exit', (code) => {
    log.write(`===== ${new Date().toISOString()} 核心退出 code=${code} =====\n`)
    if (child === spawned) child = null
    if (stoppingOnPurpose) {
      stoppingOnPurpose = false
      return
    }
    runtime.core = 'failed'
    runtime.coreError = `核心意外退出（code ${code}），详见 mihomo.log`
    // 核心一死，装着的代理就变成黑洞：立刻卸掉，否则连订阅都刷不了。
    void disableProxy()
  })
  spawned.on('error', (error) => {
    runtime.core = 'failed'
    runtime.coreError = `核心启动失败：${error.message}`
  })
  child = spawned
  writeFileSync(PID_PATH, String(spawned.pid), 'utf8')

  runtime.mixedPort = mixedPort
  runtime.controllerPort = controllerPort
  runtime.controllerSecret = secret

  try {
    await waitForController()
  } catch (error) {
    runtime.core = 'failed'
    runtime.coreError = error instanceof Error ? error.message : String(error)
    await stopCore()
    throw error
  }
  runtime.core = 'running'
  runtime.coreError = null
  return { group, mixedPort }
}

/* ===================================================================== *
 * 代理热装 / 热卸
 * ===================================================================== */

/** 所有会被写成两种大小写的代理变量名。 */
const PROXY_ENV_CASINGS = [
  'http_proxy',
  'HTTP_PROXY',
  'https_proxy',
  'HTTPS_PROXY',
  'all_proxy',
  'ALL_PROXY',
  'no_proxy',
  'NO_PROXY',
]

/**
 * Windows 上把「两种大小写各写一份」压成一份。
 *
 * `dsh-http-proxy` 按设计同时写 `http_proxy` 与 `HTTP_PROXY`（README：「两种
 * 大小写总是一起写或一起清」）。在 POSIX 上那是两个不同的变量，没问题；但
 * **Windows 的环境变量大小写不敏感**，于是 SetEnvironmentVariable 会把它们
 * 存成环境块里的**两条独立记录**。任何按大小写不敏感建字典的消费者都会抛
 * `An item with the same key has already been added` —— PowerShell 的
 * `Get-ChildItem env:`、.NET 的 `Environment.GetEnvironmentVariables()`、
 * 以及一堆脚本都会因此炸掉。
 *
 * 删是大小写不敏感的（一次清掉全部同名的），所以「全删 → 只写大写一份」
 * 就能得到干净的环境块。大写形式的可读性没有损失：Node 的 `process.env`
 * 在 Windows 上本来就是大小写不敏感的，undici、curl、git 也都读得到。
 */
function dedupeProxyEnv() {
  if (process.platform !== 'win32') return
  const env = process.env
  const keep = {}
  for (const name of PROXY_ENV_CASINGS) {
    const value = env[name]
    if (typeof value === 'string' && value !== '') keep[name.toUpperCase()] = value
  }
  for (const name of PROXY_ENV_CASINGS) delete env[name]
  for (const [name, value] of Object.entries(keep)) env[name] = value
}

/**
 * 诊断用：数一数环境块里有没有「大小写不同、其实是同一个变量」的重复项。
 * @returns 重复的变量名（小写归一后）。
 */
function duplicateEnvNames() {
  if (process.platform !== 'win32') return []
  let raw = ''
  try {
    raw = execFileSync('cmd', ['/c', 'set'], { encoding: 'utf8', windowsHide: true })
  } catch {
    return []
  }
  const seen = new Map()
  for (const line of raw.split(/\r?\n/)) {
    const name = line.split('=', 1)[0]
    if (name === '') continue
    const key = name.toLowerCase()
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  return [...seen.entries()].filter(([, count]) => count > 1).map(([name]) => name)
}

/**
 * 把全局 dispatcher 挂到本机核心端口上。
 *
 * `installProxyFromEnvironment` 是 dsh-http-proxy 的公开导出，返回一个卸载器。
 * 它本来是给启动器「启动时装一次」用的，但实测可以在运行时反复调用 —— 这正是
 * 「开关免重启」的依据。
 *
 * **端口变了就必须重装。** 核心每次启动都取一个新的随机端口，而已经装上的
 * dispatcher 是不会自己跟着变的：不重装的话它会继续指着一个已经消失的端口，
 * 此后所有走代理的请求全部失败，偏偏 `proxy.installed` 还是 true，看上去一切
 * 正常。重载核心、改分流规则都会走到这条路。
 */
async function enableProxy() {
  if (runtime.mixedPort === null) throw new Error('核心未运行，无法挂代理')
  if (disposeProxy !== null && runtime.proxyPort === runtime.mixedPort) return
  if (disposeProxy !== null) await disableProxy()
  const mod = await loadHttpProxy()
  if (mod === undefined) throw new Error('无法加载 @deepseek-ai/dsh-http-proxy')
  const url = `http://127.0.0.1:${runtime.mixedPort}`
  disposeProxy = await mod.installProxyFromEnvironment(
    {
      get: (key) => (key === 'https_proxy' || key === 'http_proxy' ? { value: url } : undefined),
    },
    (message) => process.stderr.write(`dsh-api-proxy: ${message}\n`),
  )
  dedupeProxyEnv()
  runtime.proxyPort = runtime.mixedPort
  runtime.proxyInstalled = true
}

/** 卸掉全局 dispatcher，回到直连。 */
async function disableProxy() {
  const dispose = disposeProxy
  disposeProxy = null
  runtime.proxyInstalled = false
  runtime.proxyPort = null
  if (dispose === null) return
  try {
    await dispose()
  } catch {
    // 卸载失败也不该阻断关闭流程。
  }
  // 还原同样会写回两种大小写，所以这里也要压一次。
  dedupeProxyEnv()
}

/**
 * 重启核心，并把 dispatcher 重新接到新端口上。
 *
 * 所有「换一个核心进程」的路径都得走这里 —— {@link startCore} 会挑新的随机端口，
 * 只换核心不换 dispatcher 等于把代理指向空气。
 * @param settings - 当前设置。
 * @param subscription - 解析后的订阅。
 * @returns `{ group, mixedPort }`。
 */
async function restartCore(settings, subscription) {
  await disableProxy()
  const result = await startCore(settings, subscription)
  await enableProxy()
  return result
}

/* ===================================================================== *
 * 节点缓存
 * ===================================================================== */

/**
 * 从订阅里抽出供界面使用的分组与节点清单。
 * @param subscription - 解析后的订阅。
 * @returns `{ groups, proxies }`。
 */
function indexNodes(subscription) {
  const proxies = (Array.isArray(subscription.proxies) ? subscription.proxies : []).map((proxy) => ({
    name: asString(proxy?.name),
    type: asString(proxy?.type),
  }))
  const groups = (Array.isArray(subscription['proxy-groups']) ? subscription['proxy-groups'] : []).map(
    (group) => ({
      name: asString(group?.name),
      type: asString(group?.type),
      members: (Array.isArray(group?.proxies) ? group.proxies : []).map((member) => asString(member)),
    }),
  )
  return { groups, proxies }
}

/** 落盘节点缓存，供重启后立刻能显示列表。 */
function persistNodes() {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(
      STATE_PATH,
      JSON.stringify({ groups: runtime.groups, proxies: runtime.proxies }, null, 2),
      'utf8',
    )
  } catch {
    // 缓存写不了不影响功能。
  }
}

/** 读回节点缓存。 */
function restoreNodes() {
  try {
    if (!existsSync(STATE_PATH)) return
    const parsed = JSON.parse(readFileSync(STATE_PATH, 'utf8'))
    if (Array.isArray(parsed?.groups)) runtime.groups = parsed.groups
    if (Array.isArray(parsed?.proxies)) runtime.proxies = parsed.proxies
  } catch {
    // 缓存损坏就当没有。
  }
}

/* ===================================================================== *
 * 下载核心
 * ===================================================================== */

/** 从 GitHub（含镜像回退）取核心并解压。 */
async function downloadCore() {
  if (process.platform !== 'win32') throw new Error('自动下载目前只支持 Windows')
  mkdirSync(DATA_DIR, { recursive: true })
  const zipPath = join(DATA_DIR, 'mihomo.zip')
  const attempts = [MIHOMO_URL, ...MIRRORS.map((mirror) => mirror + MIHOMO_URL)]
  let lastError = null
  for (const url of attempts) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        signal: AbortSignal.timeout(600000),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const buffer = Buffer.from(await response.arrayBuffer())
      if (buffer.length < 5 * 1024 * 1024) throw new Error(`包体过小（${buffer.length} 字节）`)
      writeFileSync(zipPath, buffer)
      lastError = null
      break
    } catch (error) {
      lastError = error
    }
  }
  if (lastError !== null) throw new Error(`下载失败：${lastError.message}`)

  // Windows 10 1803+ 自带 bsdtar，能直接解 zip。
  try {
    execFileSync('tar', ['-xf', zipPath, '-C', DATA_DIR], { stdio: 'ignore', windowsHide: true })
  } catch {
    execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${DATA_DIR}' -Force`,
      ],
      { stdio: 'ignore', windowsHide: true },
    )
  }
  rmSync(zipPath, { force: true })

  // 解出来的文件名带版本号，改名成固定的 mihomo.exe。
  for (const entry of readdirSync(DATA_DIR)) {
    if (!/\.exe$/i.test(entry) || entry.toLowerCase() === 'mihomo.exe') continue
    renameSync(join(DATA_DIR, entry), CORE_PATH)
    break
  }
  if (!existsSync(CORE_PATH)) throw new Error('解压后没找到 mihomo 可执行文件')
  return CORE_PATH
}

/* ===================================================================== *
 * 动作
 * ===================================================================== */

/** 确保有可用的订阅对象：优先用内存/磁盘缓存。 */
async function ensureSubscription(settings, { force = false } = {}) {
  if (!force && runtime.subscription !== null) return runtime.subscription
  if (asString(settings.subscriptionUrl) === '') throw new Error('还没填订阅地址')
  if (!force && existsSync(CACHE_PATH)) {
    try {
      const yaml = await loadYaml()
      const parsed = yaml.load(readFileSync(CACHE_PATH, 'utf8'))
      if (parsed !== null && typeof parsed === 'object') {
        runtime.subscription = parsed
        const indexed = indexNodes(parsed)
        runtime.groups = indexed.groups
        runtime.proxies = indexed.proxies
        return parsed
      }
    } catch {
      // 缓存不可用就走网络。
    }
  }
  return refreshSubscription(settings)
}

/** 拉订阅 → 解析 → 缓存。 */
async function refreshSubscription(settings) {
  const url = asString(settings.subscriptionUrl)
  if (url === '') throw new Error('还没填订阅地址')
  const fetched = await fetchSubscription(url)
  const yaml = await loadYaml()
  if (yaml === undefined) throw new Error('无法加载 js-yaml，解析不了订阅')
  let parsed
  try {
    parsed = yaml.load(fetched.text)
  } catch (error) {
    throw new Error(`订阅不是合法 YAML：${error instanceof Error ? error.message : String(error)}`)
  }
  if (parsed === null || typeof parsed !== 'object') throw new Error('订阅内容不是配置对象')
  if (!Array.isArray(parsed.proxies) || parsed.proxies.length === 0) {
    throw new Error('订阅里没有 proxies：可能不是 Clash/mihomo 格式')
  }
  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(CACHE_PATH, fetched.text, 'utf8')
  const indexed = indexNodes(parsed)
  runtime.subscription = parsed
  runtime.groups = indexed.groups
  runtime.proxies = indexed.proxies
  runtime.subscriptionInfo = {
    userinfo: parseUserInfo(fetched.userinfo),
    updateInterval: fetched.updateInterval,
    fileName: fetched.fileName,
    fetchedAt: new Date().toISOString(),
    nodeCount: indexed.proxies.length,
  }
  persistNodes()
  return parsed
}

/**
 * 从 mihomo 的 `/proxies` 里分出「真节点」与「分组」。
 *
 * 分组的特征是有 `all` 数组。区分它们很关键：订阅常把「自动选择」这类
 * url-test 组塞进选择组当成员，而自动测速绝不能选中一个分组 —— 那等于
 * 把选择权又交回给那个实测会抖到 11 秒的东西。
 * @returns `{ nodes, groups }` 两个名字集合。
 */
async function classifyProxies() {
  const payload = await controller('/proxies')
  const nodes = new Set()
  const groups = new Set()
  const entries = payload !== null && typeof payload === 'object' ? (payload.proxies ?? {}) : {}
  for (const [name, value] of Object.entries(entries)) {
    if (value === null || typeof value !== 'object') continue
    if (Array.isArray(value.all)) groups.add(name)
    else nodes.add(name)
  }
  return { nodes, groups }
}

/**
 * 把分组切到指定节点。
 * @param group - 分组名。
 * @param node - 节点名。
 */
async function applyNode(group, node) {
  await controller(`/proxies/${encodeURIComponent(group)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: node }),
  })
}

/**
 * 测速并切到延迟最低的节点。
 * @param settings - 当前设置（用它的 `testUrl`）。
 * @param group - 要切换的分组。
 * @param timeout - 单个节点的测速超时（毫秒）。
 * @returns `{ name, delay, tested, usable }`，全都不通时返回 null。
 */
async function pickFastest(settings, group, timeout = 5000) {
  const { groups } = await classifyProxies()
  const delays = await controller(
    `/group/${encodeURIComponent(group)}/delay?timeout=${timeout}&url=${encodeURIComponent(settings.testUrl)}`,
  )
  const table = delays !== null && typeof delays === 'object' ? delays : {}
  const candidates = Object.entries(table)
    .filter(([name, delay]) => typeof delay === 'number' && delay > 0 && !groups.has(name))
    .sort((a, b) => a[1] - b[1])
  if (candidates.length === 0) return null
  const [name, delay] = candidates[0]
  await applyNode(group, name)
  return { name, delay, tested: Object.keys(table).length, usable: candidates.length }
}

/**
 * 打开开关：核心起来 → 挂上代理 → 按模式决定节点。
 *
 * 模式只看 `settings.targetNode`：
 * - 空串 → 自动：测速选延迟最低的真实节点
 * - 非空 → 固定：每次都切到它，不测速
 *
 * 两条路都以「先挂代理」开始，这样 dsh 尽早恢复可用；mihomo 的测速是它自己
 * 去连节点，与宿主装不装代理无关，所以顺序不影响测速结果。
 * @param settings - 当前设置。
 * @returns 结果摘要。
 */
async function actionEnable(settings) {
  const subscription = await ensureSubscription(settings)
  const { group } = await restartCore(settings, subscription)
  runtime.autoPick = null

  // ---- 固定模式 ----
  const fixed = settings.targetNode.trim()
  if (fixed !== '') {
    try {
      await applyNode(group, fixed)
      runtime.lastMessage = `已开启：固定使用「${fixed}」（不测速）`
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      runtime.lastMessage = `已开启，但切到「${fixed}」失败：${message} —— 当前用的是 ${group} 的默认选择`
    }
    return { group, mixedPort: runtime.mixedPort, autoPick: null }
  }

  // ---- 自动模式 ----
  const base = `已开启：${group} 承载 ${settings.apiDomains || '（未配置域名）'}，其余直连`
  runtime.autoPicking = true
  try {
    const picked = await pickFastest(settings, group)
    if (picked === null) {
      runtime.lastMessage = `${base} —— 但所有节点都测不通，保留分组默认选择`
    } else {
      runtime.autoPick = { ...picked, group, at: new Date().toISOString() }
      runtime.lastMessage = `已开启，自动锁定最快节点：${picked.name}（${picked.delay} ms，测了 ${picked.tested} 个，可用 ${picked.usable} 个）`
    }
  } catch (error) {
    runtime.lastMessage = `${base} —— 但自动测速失败：${error instanceof Error ? error.message : String(error)}`
  } finally {
    runtime.autoPicking = false
  }
  return { group, mixedPort: runtime.mixedPort, autoPick: runtime.autoPick }
}

/** 关闭开关：先卸代理再停核心。 */
async function actionDisable() {
  await disableProxy()
  await stopCore()
  runtime.lastMessage = '已关闭，全部直连'
  return {}
}

/* ===================================================================== *
 * 状态快照
 * ===================================================================== */

/** 收集当前状态，供界面轮询与 `?diag=1` 排错。 */
function snapshot() {
  const settings = readSettings()
  return {
    ok: true,
    settings: {
      enabled: settings.enabled,
      subscriptionUrl: settings.subscriptionUrl,
      apiDomains: settings.apiDomains,
      targetGroup: settings.targetGroup,
      targetNode: settings.targetNode,
      testUrl: settings.testUrl,
    },
    /** 'auto' = 每次开启测速选最快；'fixed' = 每次都连 targetNode。 */
    mode: settings.targetNode.trim() === '' ? 'auto' : 'fixed',
    core: {
      state: runtime.core,
      error: runtime.coreError,
      version: runtime.coreVersion,
      path: CORE_PATH,
      installed: existsSync(CORE_PATH),
    },
    proxy: {
      installed: runtime.proxyInstalled,
      port: runtime.mixedPort,
      /** dispatcher 实际指向的端口。两者不同就是 bug，`?diag=1` 里看得到。 */
      boundPort: runtime.proxyPort,
      url: runtime.mixedPort === null ? null : `http://127.0.0.1:${runtime.mixedPort}`,
    },
    subscription: runtime.subscriptionInfo ?? null,
    groups: runtime.groups,
    proxies: runtime.proxies,
    /** 最近一次自动测速选节点的结果；`autoPicking` 为真时界面显示「测速中」。 */
    autoPick: runtime.autoPick,
    autoPicking: runtime.autoPicking,
    lastMessage: runtime.lastMessage,
  }
}

/* ===================================================================== *
 * 路由
 * ===================================================================== */

/** `GET /dsh-api-proxy/status`。 */
function handleStatus(req, res) {
  if (!isTrustedBrowser(req)) {
    sendJson(res, 403, { ok: false, error: 'forbidden' })
    return
  }
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const payload = snapshot()
  if (url.searchParams.get('diag') === '1') {
    payload.diagnostics = { ...diagnostics, duplicateEnvNames: duplicateEnvNames() }
  }
  sendJson(res, 200, payload)
}

/** `POST /dsh-api-proxy/action`。 */
async function handleAction(ctx, req, res) {
  if (!isTrustedBrowser(req)) {
    sendJson(res, 403, { ok: false, error: 'forbidden' })
    return
  }
  let body
  try {
    body = await readJsonBody(req)
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
    return
  }
  const action = asString(body.action)
  const settings = readSettings()
  try {
    switch (action) {
      case 'enable':
        await actionEnable(settings)
        break
      case 'disable':
        await actionDisable()
        break
      case 'refresh': {
        const subscription = await refreshSubscription(settings)
        // 换核心就得重接 dispatcher —— startCore 会取新端口。
        if (runtime.core === 'running') await restartCore(settings, subscription)
        runtime.lastMessage = `订阅已刷新：${runtime.proxies.length} 个节点`
        break
      }
      case 'reload': {
        const subscription = await ensureSubscription(settings)
        await restartCore(settings, subscription)
        runtime.lastMessage = '核心已重载'
        break
      }
      case 'install-core':
        await downloadCore()
        runtime.lastMessage = `核心已下载：${CORE_PATH}`
        break
      case 'select': {
        const group = asString(body.group)
        const node = asString(body.node)
        if (group === '' || node === '') throw new Error('select 需要 group 与 node')
        await applyNode(group, node)
        runtime.lastMessage = `已切到 ${node}（固定模式：下次开启仍用它）`
        break
      }
      case 'autopick': {
        // 切回自动模式并立刻测一次速，让界面马上看到结果。
        const group = asString(body.group) || pickGroup(settings.targetGroup, runtime.groups)
        if (group === '') throw new Error('没有可用的分组')
        runtime.autoPicking = true
        try {
          const picked = await pickFastest(settings, group)
          if (picked === null) {
            runtime.lastMessage = '自动测速：所有节点都测不通'
          } else {
            runtime.autoPick = { ...picked, group, at: new Date().toISOString() }
            runtime.lastMessage = `自动锁定最快节点：${picked.name}（${picked.delay} ms，可用 ${picked.usable} 个）`
          }
        } finally {
          runtime.autoPicking = false
        }
        sendJson(res, 200, { ...snapshot(), ok: true })
        return
      }
      case 'delay': {
        const group = asString(body.group)
        const timeout = Number.isFinite(body.timeout) ? Number(body.timeout) : 5000
        const target = asString(body.url) || settings.testUrl
        if (group === '') throw new Error('delay 需要 group')
        const result = await controller(
          `/group/${encodeURIComponent(group)}/delay?timeout=${timeout}&url=${encodeURIComponent(target)}`,
        )
        sendJson(res, 200, { ...snapshot(), ok: true, delays: result ?? {} })
        return
      }
      case 'active': {
        const payload = await controller('/proxies')
        sendJson(res, 200, { ...snapshot(), ok: true, selection: extractSelection(payload) })
        return
      }
      default:
        throw new Error(`未知动作：${action}`)
    }
    sendJson(res, 200, { ...snapshot(), ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    runtime.lastMessage = message
    // `ok` 必须写在 snapshot() 展开之后：snapshot() 自己也带一个 `ok: true`，
    // 写在前面会被它覆盖，于是失败的动作在界面上报告成功。
    sendJson(res, 200, { ...snapshot(), ok: false, error: message })
  }
}

/**
 * 从 `/proxies` 的响应里抽出各分组当前选中的节点。
 * @param payload - mihomo `/proxies` 的响应体。
 * @returns `{ 组名: 当前节点 }`。
 */
function extractSelection(payload) {
  const selection = {}
  if (payload === null || typeof payload !== 'object') return selection
  const proxies = payload.proxies
  if (proxies === null || typeof proxies !== 'object') return selection
  for (const [key, value] of Object.entries(proxies)) {
    if (value === null || typeof value !== 'object') continue
    if (Array.isArray(value.all) && typeof value.now === 'string') selection[key] = value.now
  }
  return selection
}

/* ===================================================================== *
 * 插件体
 * ===================================================================== */

/**
 * 构建设置命名空间 schema（DSH ≤ 0.1.5 的路径）。
 * @returns `{ schema, source }`；取不到 schemastery 时给一个同契约的最小 schema。
 */
async function buildSettingsSchema() {
  const z = await loadSchemastery()
  if (z === undefined) return { source: 'fallback', schema: buildFallbackSchema() }
  try {
    return {
      source: 'schemastery',
      schema: z.object({
        enabled: z.boolean().default(DEFAULTS.enabled),
        subscriptionUrl: z.string().default(DEFAULTS.subscriptionUrl),
        apiDomains: z.string().default(DEFAULTS.apiDomains),
        targetGroup: z.string().default(DEFAULTS.targetGroup),
        targetNode: z.string().default(DEFAULTS.targetNode),
        testUrl: z.string().default(DEFAULTS.testUrl),
      }),
    }
  } catch {
    return { source: 'fallback', schema: buildFallbackSchema() }
  }
}

/**
 * 取不到 schemastery 时的最小 schema：与 SettingsProvider 同调用契约
 * （可调用 + `toJSON`），界面照常工作，只是少了严格校验。
 * @returns 可调用的 schema 对象。
 */
function buildFallbackSchema() {
  const schema = (section) => normalizeSettings(section)
  schema.toJSON = () => ({
    type: 'object',
    uid: 0,
    meta: { default: {} },
    dict: Object.fromEntries(
      Object.entries(DEFAULTS).map(([key, fallback]) => [
        key,
        { type: typeof fallback, uid: 0, meta: { default: fallback } },
      ]),
    ),
  })
  return schema
}

/**
 * 插件体：注册设置命名空间、状态路由、动作路由，并按需自动拉起核心。
 * @param ctx - 宿主插件上下文。
 * @param config - DSH ≥ 0.2 的 entry config；旧运行时为 undefined。
 */
export function apply(ctx, config) {
  restoreNodes()
  killOrphan()

  // DSH ≥ 0.2：设置就是这个 entry 的 config。
  if (config !== null && typeof config === 'object') {
    settingsOwner = { get: () => normalizeSettings(config) }
    diagnostics.settingsSource = 'entry-config'
    diagnostics.registered = true
  } else {
    ctx.inject(['settings'], (settingsCtx) => {
      diagnostics.injectFired = true
      const settings = settingsCtx.settings
      if (settings === undefined || typeof settings.register !== 'function') {
        diagnostics.registerError = 'settings.register 在当前运行时不可用'
        return
      }
      buildSettingsSchema()
        .then((result) => {
          try {
            settingsOwner = settings.register(SETTINGS_NS, result.schema, { applies: 'live' })
            diagnostics.registered = true
          } catch (error) {
            diagnostics.registerError = error instanceof Error ? error.message : String(error)
          }
          void autoStart()
        })
        .catch((error) => {
          diagnostics.registerError = error instanceof Error ? error.message : String(error)
          void autoStart()
        })
    })
  }

  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: STATUS_ROUTE, handler: handleStatus }),
    'dsh-api-proxy: status route',
  )
  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: ACTION_ROUTE, handler: (req, res) => void handleAction(ctx, req, res) }),
    'dsh-api-proxy: action route',
  )

  // dsh 退出时把核心一起带走，别留孤儿进程占端口。
  ctx.effect(
    () => () => {
      void (async () => {
        await disableProxy()
        await stopCore()
      })()
    },
    'dsh-api-proxy: shutdown',
  )

  // **不返回** autoStart 的 promise：开启现在包含一次全节点测速（几十个节点、
  // 每个最多 5 秒），把它 await 进插件装配会把 dsh 的启动拖住十几秒。
  // 让它在后台跑，状态经 /dsh-api-proxy/status 暴露。
  void autoStart()
}

/**
 * 设置就绪后，若上次是开着的那就把核心重新拉起来。
 *
 * 这就是「每次进 dsh 自动测速选最快节点」的落点：它走的也是
 * {@link actionEnable}，所以 `autoPickFastest` 开着时同样会先测速再选。
 */
async function autoStart() {
  const settings = readSettings()
  if (!settings.enabled) {
    diagnostics.autoStart = 'disabled'
    return
  }
  if (!existsSync(CORE_PATH)) {
    diagnostics.autoStart = 'core-missing'
    return
  }
  const startedAt = Date.now()
  try {
    diagnostics.autoStart = 'running'
    await actionEnable(settings)
    diagnostics.autoStart = runtime.autoPick === null
      ? `running:${Date.now() - startedAt}ms（未自动选节点）`
      : `running:${Date.now() - startedAt}ms → ${runtime.autoPick.name} (${runtime.autoPick.delay}ms)`
  } catch (error) {
    diagnostics.autoStart = `failed: ${error instanceof Error ? error.message : String(error)}`
    runtime.coreError = diagnostics.autoStart
    await disableProxy()
  }
}
