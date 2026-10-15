/**
 * dsh-api-proxy 宿主侧离线验证。
 *
 * 用假的 cordis ctx 把插件挂起来，然后**真的**走一遍完整链路：
 * 注册设置命名空间 → 挂路由 → 拉订阅 → 生成配置 → 起 mihomo → 装全局
 * dispatcher → 测速 → 切节点 → 实测 API 速度 → 关闭。
 *
 * 不写任何 DSH 配置，不改系统设置；跑完会把核心进程带走。
 *
 * 需要一个**你自己的**订阅地址（脚本不内置任何订阅）：
 *
 *   $env:DSH_PROXY_TEST_SUB = 'https://你的机场/订阅地址'
 *   node verify/host-sim.mjs
 *
 * 可选：
 *   $env:DSH_PROXY_TEST_DOMAIN  走代理的域名后缀，默认 example.com
 *   $env:DSH_PROXY_TEST_API     用来量速度的 URL，默认一个公共 204 探测点
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/* ------------------------------------------------------------------ *
 * 让插件的 createRequire 兜底路径与真实运行时一致：
 * dsh 进程里 process.argv[1] 就是 dsh 的入口，插件据此解析
 * js-yaml / schemastery / dsh-http-proxy。
 * ------------------------------------------------------------------ */

/**
 * 找到 dsh 安装目录。
 * @returns 入口文件绝对路径。
 */
function findDshEntry() {
  const explicit = process.env.DSH_ROOT
  if (typeof explicit === 'string' && explicit !== '') return join(explicit, 'lib', 'bin.js')
  const roots = []
  try {
    roots.push(execFileSync('npm', ['root', '-g'], { encoding: 'utf8', windowsHide: true }).trim())
  } catch {
    // npm 不在 PATH 上就试常见位置。
  }
  roots.push(
    join(process.env.APPDATA ?? '', 'npm', 'node_modules'),
    join(process.env.LOCALAPPDATA ?? '', 'pnpm', 'global', '5', 'node_modules'),
  )
  for (const root of roots) {
    if (root === '') continue
    const entry = join(root, '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    if (existsSync(entry)) return entry
  }
  console.error('找不到 dsh 安装目录。请设置 DSH_ROOT 指向 @deepseek-ai/dsh 包目录。')
  process.exit(1)
}

process.argv[1] = findDshEntry()

const DATA_DIR = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'api-proxy')
const CONFIG_PATH = join(DATA_DIR, 'config.yaml')
const CORE_PATH = join(DATA_DIR, 'mihomo.exe')

const SUBSCRIPTION_URL = process.env.DSH_PROXY_TEST_SUB ?? ''
const TEST_DOMAIN = process.env.DSH_PROXY_TEST_DOMAIN ?? 'example.com'
const API_PROBE = process.env.DSH_PROXY_TEST_API ?? 'https://www.gstatic.com/generate_204'

if (SUBSCRIPTION_URL === '') {
  console.error('缺少订阅地址。请先设置环境变量：')
  console.error("  $env:DSH_PROXY_TEST_SUB = 'https://你的机场/订阅地址'")
  process.exit(1)
}

let passed = 0
let failed = 0

/** 等一会儿。 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function check(label, ok, detail = '') {
  if (ok) {
    passed += 1
    console.log(`  PASS  ${label}${detail === '' ? '' : `  ${detail}`}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${label}${detail === '' ? '' : `  ${detail}`}`)
  }
}

/* ------------------------------------------------------------------ *
 * 假 ctx 与假 req/res
 * ------------------------------------------------------------------ */

/** 设置文档；测试通过改它来模拟用户在设置页里的操作。 */
const settingsDoc = {
  enabled: false,
  subscriptionUrl: SUBSCRIPTION_URL,
  apiDomains: TEST_DOMAIN,
  targetGroup: '',
  targetNode: '',
  testUrl: 'https://www.gstatic.com/generate_204',
}

const routes = new Map()
const effects = []

function createContext() {
  return {
    inject(services, callback) {
      if (services.includes('settings')) {
        callback({
          settings: {
            register(namespace, schema) {
              return { get: () => schema(settingsDoc) }
            },
          },
        })
      }
    },
    effect(callback, label) {
      effects.push(label)
      return callback()
    },
    webServer: {
      register({ path, handler }) {
        routes.set(path, handler)
        return () => routes.delete(path)
      },
    },
  }
}

/** 造一个假的 Node req。 */
function makeReq({ method = 'GET', url = '/', headers = {}, body = null } = {}) {
  const listeners = new Map()
  const req = {
    method,
    url,
    headers,
    on(event, handler) {
      listeners.set(event, handler)
      return req
    },
    destroy() {},
  }
  // 请求体在下一个 tick 里喂进去，模拟真实流。
  queueMicrotask(() => {
    if (body !== null) listeners.get('data')?.(Buffer.from(JSON.stringify(body), 'utf8'))
    listeners.get('end')?.()
  })
  return req
}

/** 造一个假的 Node res，把响应收下来。 */
function makeRes() {
  const captured = { status: 0, headers: null, body: '' }
  return {
    captured,
    writeHead(status, headers) {
      captured.status = status
      captured.headers = headers
    },
    end(payload) {
      captured.body = payload === undefined ? '' : String(payload)
    },
    done: null,
  }
}

/** 调一次路由，返回解析后的 JSON。 */
async function call(path, options = {}) {
  const handler = routes.get(path)
  if (handler === undefined) throw new Error(`路由未注册：${path}`)
  const res = makeRes()
  await handler(makeReq({ url: path, ...options }), res)
  // handleAction 是 async 的，注册时被包成 void；等一拍让它跑完。
  await new Promise((resolve) => setTimeout(resolve, 50))
  let parsed = null
  try {
    parsed = JSON.parse(res.captured.body)
  } catch {
    parsed = null
  }
  return { status: res.captured.status, json: parsed, raw: res.captured.body, res }
}

/** 调动作路由并等它真正结束。 */
async function action(payload) {
  const handler = routes.get('/dsh-api-proxy/action')
  const res = makeRes()
  let settle
  const done = new Promise((resolve) => {
    settle = resolve
  })
  const originalEnd = res.end.bind(res)
  res.end = (body) => {
    originalEnd(body)
    settle()
  }
  const req = makeReq({
    method: 'POST',
    url: '/dsh-api-proxy/action',
    headers: { host: '127.0.0.1:3080' },
    body: payload,
  })
  await handler(req, res)
  await Promise.race([done, new Promise((resolve) => setTimeout(resolve, 180000))])
  let parsed = null
  try {
    parsed = JSON.parse(res.captured.body)
  } catch {
    parsed = null
  }
  return { status: res.captured.status, json: parsed, raw: res.captured.body }
}

/**
 * 直接量一次 API。
 *
 * 用 `Connection: close` 强制每次新建连接 —— 实测这台机器上直连的问题出在
 * TLS 握手阶段（curl 的 5 次里有 3 次传到一半卡死，握手耗时 0.65~4.24s 乱跳），
 * 而 keep-alive 会把这个症状掩盖掉，量不出真实差距。
 * @param rounds - 请求次数。
 * @returns `{ ok, rounds, average, times }`。
 */
async function measureApi(rounds = 5) {
  let ok = 0
  const times = []
  for (let i = 0; i < rounds; i += 1) {
    const started = Date.now()
    try {
      const response = await fetch(API_PROBE, {
        headers: { Connection: 'close' },
        signal: AbortSignal.timeout(30000),
      })
      // 必须读完整个 body：卡死正是发生在传了一部分之后。
      const body = await response.arrayBuffer()
      if (response.ok && body.byteLength > 0) {
        ok += 1
        times.push(Date.now() - started)
      }
    } catch {
      // 超时/重置都算失败。
    }
  }
  const average = times.length === 0 ? null : Math.round(times.reduce((a, b) => a + b, 0) / times.length)
  return { ok, rounds, average, times }
}

/* ------------------------------------------------------------------ *
 * 跑
 * ------------------------------------------------------------------ */

console.log('='.repeat(72))
console.log('dsh-api-proxy 宿主侧离线验证')
console.log('='.repeat(72))
console.log('')

console.log('[1] 加载模块并挂载插件')
const plugin = await import('../lib/index.js')
check('模块导出 name', plugin.name === 'dsh-api-proxy', plugin.name)
check('模块导出 apply', typeof plugin.apply === 'function')

const ctx = createContext()
const autoStart = plugin.apply(ctx)
check('apply 返回启动钩子', typeof autoStart === 'function')
await new Promise((resolve) => setTimeout(resolve, 300))
check('注册了状态路由', routes.has('/dsh-api-proxy/status'))
check('注册了动作路由', routes.has('/dsh-api-proxy/action'))
check('注册了关闭钩子', effects.some((label) => /shutdown/.test(label)))
console.log('')

console.log('[2] 信任栅栏')
const forged = await call('/dsh-api-proxy/status', { headers: { host: 'evil.example.com' } })
check('非 loopback Host 被拒', forged.status === 403, `HTTP ${forged.status}`)
const crossSite = await call('/dsh-api-proxy/status', {
  headers: { host: '127.0.0.1:3080', origin: 'https://evil.example.com' },
})
check('跨站 Origin 被拒', crossSite.status === 403, `HTTP ${crossSite.status}`)
const sameOrigin = await call('/dsh-api-proxy/status', { headers: { host: '127.0.0.1:3080' } })
check('同源请求放行', sameOrigin.status === 200 && sameOrigin.json?.ok === true)
console.log('')

console.log('[2b] 失败的动作必须报告 ok=false')
// 曾经这里被 snapshot() 自带的 `ok: true` 覆盖，失败在界面上会显示成成功。
const failedAction = await action({ action: 'select', group: '', node: '' })
check('失败动作报告 ok=false', failedAction.json?.ok === false, `ok=${JSON.stringify(failedAction.json?.ok)}`)
check(
  '失败动作带上错误文本',
  typeof failedAction.json?.error === 'string' && failedAction.json.error !== '',
  String(failedAction.json?.error),
)
const unknownAction = await action({ action: 'no-such-action' })
check('未知动作也报告 ok=false', unknownAction.json?.ok === false, `ok=${JSON.stringify(unknownAction.json?.ok)}`)
console.log('')

console.log('[3] 拉订阅并解析')
// 直连这条线本身就会抽风（这正是本插件存在的理由），所以给几次重试；
// 拉不到时插件会退回磁盘缓存 —— 那也算通过，但要说明。
let refreshed = null
for (let attempt = 1; attempt <= 3; attempt += 1) {
  refreshed = await action({ action: 'refresh' })
  if (refreshed.json?.ok === true) break
  console.log(`        第 ${attempt} 次失败：${refreshed.json?.error ?? '未知'}，重试…`)
  await sleep(1500)
}
if (refreshed.json?.ok === true) {
  check('refresh 成功', true)
} else {
  const cached = await action({ action: 'active' })
  check(
    'refresh 失败但退回了缓存',
    (cached.json?.proxies?.length ?? 0) > 0,
    `${cached.json?.proxies?.length ?? 0} 个节点（网络原因，非插件问题）`,
  )
}
const nodeCount = refreshed.json?.proxies?.length ?? 0
check('解析出节点', nodeCount > 0, `${nodeCount} 个`)
const groupNames = (refreshed.json?.groups ?? []).map((group) => group.name)
check('解析出分组', groupNames.length > 0, groupNames.join(' / '))
console.log('')

console.log('[4] 直连基线（每次新建连接，读完整 body）')
const direct = await measureApi(5)
console.log(
  `        直连: ${direct.ok}/${direct.rounds} 成功，平均 ${direct.average ?? '-'} ms  [${direct.times.join(', ')}]`,
)
console.log('')

console.log('[5] 生成 mihomo 配置并打开开关')
const started = await action({ action: 'enable' })
check('enable 成功', started.json?.ok === true, started.json?.error ?? '')
check('核心已运行', started.json?.core?.state === 'running', started.json?.core?.state ?? '')
check('代理已装上', started.json?.proxy?.installed === true, started.json?.proxy?.url ?? '')
const corePort = started.json?.proxy?.port ?? 0
check('代理端口不是 7890', corePort !== 7890, `端口 ${corePort}`)

// 记下**本次**启动的核心 pid。收尾时只检查这一个 —— 机器上可能还跑着
// 另一个 dsh 实例的核心（用户界面里开着开关），全局「无 mihomo 进程」
// 那种断言会跟它撞车。
const PID_PATH = join(DATA_DIR, 'mihomo.pid')
const spawnedPid = existsSync(PID_PATH) ? Number(readFileSync(PID_PATH, 'utf8').trim()) : 0
check('写下了核心 pid', Number.isInteger(spawnedPid) && spawnedPid > 0, `pid=${spawnedPid}`)

if (existsSync(CONFIG_PATH)) {
  const configText = readFileSync(CONFIG_PATH, 'utf8')
  check('配置里没有 allow-lan: true', !/allow-lan:\s*true/.test(configText))
  check('配置里 bind-address 是 loopback', /bind-address:\s*'?127\.0\.0\.1'?/.test(configText))
  // 必须按行锚定：`respect-rules: false` 里也含有 `rules:` 子串。
  const configLines = configText.split(/\r?\n/)
  const rulesIndex = configLines.findIndex((line) => /^rules:$/.test(line))
  const ruleList = rulesIndex === -1 ? [] : configLines.slice(rulesIndex + 1).filter((line) => line.trim() !== '')
  check('规则被整体替换（只留 API 域名 + 兜底）', ruleList.length === 2, ruleList.join('  |  '))
  check(
    '规则里含配置的域名',
    configText.includes(`DOMAIN-SUFFIX,${TEST_DOMAIN},`),
    `期望 DOMAIN-SUFFIX,${TEST_DOMAIN}`,
  )
  check('规则以 MATCH,DIRECT 收尾', ruleList[ruleList.length - 1]?.trim() === '- MATCH,DIRECT')
} else {
  check('配置文件已生成', false, CONFIG_PATH)
}
console.log('')

console.log('[6] 走代理实测同一个 API')
const proxied = await measureApi(5)
console.log(
  `        走代理: ${proxied.ok}/${proxied.rounds} 成功，平均 ${proxied.average ?? '-'} ms  [${proxied.times.join(', ')}]`,
)
check('走代理时 API 全部成功', proxied.ok === proxied.rounds, `${proxied.ok}/${proxied.rounds}`)
console.log('')

console.log('[7] 测速与切节点')
const group = started.json?.groups?.find((entry) => entry.type === 'select')?.name ?? ''
check('找到 select 分组', group !== '', group)
const measured = await action({ action: 'delay', group, timeout: 5000 })
const delays = measured.json?.delays ?? {}
const usable = Object.entries(delays).filter(([, delay]) => typeof delay === 'number' && delay > 0)
check('测速返回结果', Object.keys(delays).length > 0, `${usable.length}/${Object.keys(delays).length} 个节点可用`)
const fastest = usable.sort((a, b) => a[1] - b[1])[0]
if (fastest !== undefined) {
  console.log(`        最快节点: ${fastest[0]}  ${fastest[1]} ms`)
}
if (fastest !== undefined) {
  const selected = await action({ action: 'select', group, node: fastest[0] })
  check('切换节点成功', selected.json?.ok === true, selected.json?.error ?? '')
  const active = await action({ action: 'active' })
  check('分组已指向该节点', active.json?.selection?.[group] === fastest[0], String(active.json?.selection?.[group]))
  // 这才是用户的实际用法：锁定一个测出来最快的节点，而不是让 auto 组自己抽风。
  const pinned = await measureApi(5)
  console.log(
    `        锁定该节点后: ${pinned.ok}/${pinned.rounds} 成功，平均 ${pinned.average ?? '-'} ms  [${pinned.times.join(', ')}]`,
  )
  check('锁定节点后 API 全部成功', pinned.ok === pinned.rounds, `${pinned.ok}/${pinned.rounds}`)
}
console.log('')

console.log('[8] 关闭开关')
const stopped = await action({ action: 'disable' })
check('disable 成功', stopped.json?.ok === true, stopped.json?.error ?? '')
check('核心已停止', stopped.json?.core?.state === 'stopped', stopped.json?.core?.state ?? '')
check('代理已卸下', stopped.json?.proxy?.installed === false)
const afterOff = await measureApi(2)
console.log(`        关闭后直连: ${afterOff.ok}/${afterOff.rounds} 成功  [${afterOff.times.join(', ')}]`)
console.log('')

console.log('[9] 本次启动的核心进程已回收')
await new Promise((resolve) => setTimeout(resolve, 800))

/** 某个 pid 现在还在不在（且是不是 mihomo）。 */
function stillAlive(pid) {
  try {
    const listing = execFileSync('tasklist', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], {
      encoding: 'utf8',
      windowsHide: true,
    })
    return /mihomo/i.test(listing)
  } catch {
    return false
  }
}

check('本次启动的核心已退出', !stillAlive(spawnedPid), `pid=${spawnedPid}`)
// pid 文件可能已被**另一个** dsh 实例重写（用户界面里开着开关时就会），
// 所以只断言它没有留下**我们**那个 pid。
const pidFileNow = existsSync(PID_PATH) ? Number(readFileSync(PID_PATH, 'utf8').trim()) : 0
check(
  'pid 文件没有留下本次的 pid',
  pidFileNow !== spawnedPid,
  existsSync(PID_PATH) ? `文件里现在是 pid=${pidFileNow}` : '文件已删除',
)
check('核心二进制存在', existsSync(CORE_PATH), CORE_PATH)
rmSync(join(DATA_DIR, 'mihomo.zip'), { force: true })

console.log('')
console.log('='.repeat(72))
console.log(`结果：${passed} 通过，${failed} 失败`)
console.log('='.repeat(72))
process.exit(failed === 0 ? 0 : 1)
