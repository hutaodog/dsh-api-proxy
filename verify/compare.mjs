/**
 * 直连 vs 走代理：同一个 API 的稳定性对比。
 *
 * 每次请求都新建连接并读完整 body —— 这台机器上直连的问题出在 TLS 握手
 * 与传输中断，keep-alive 会把这个症状掩盖掉，量不出真实差距。
 *
 *   node verify/compare.mjs
 *
 * 代理端口从 $DSH_HOME/api-proxy/config.yaml 里读，不需要手工传。
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const DATA_DIR = join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'api-proxy')
const CONFIG = join(DATA_DIR, 'config.yaml')
/** 默认量一个公共探测点；量你自己的 API 就把它当第一个参数传进来。 */
const TARGET = process.argv[2] ?? 'https://www.gstatic.com/generate_204'
const ROUNDS = Number(process.argv[3] ?? 6)

/**
 * 定位 dsh-http-proxy。
 *
 * 插件是通过 junction 装进 profile 的，Node 按链接的**真实路径**解析模块，
 * 所以从本脚本所在目录 import 不到 dsh 安装目录里的包；这里按 npm 全局根
 * 反查，和插件运行时用的是同一份实现。
 * @returns 模块，或 undefined。
 */
async function loadHttpProxy() {
  try {
    const loaded = await import('@deepseek-ai/dsh-http-proxy')
    if (typeof loaded?.installProxyFromEnvironment === 'function') return loaded
  } catch {
    // 落到全局安装目录。
  }
  const candidates = []
  try {
    candidates.push(execFileSync('npm', ['root', '-g'], { encoding: 'utf8', windowsHide: true }).trim())
  } catch {
    // npm 不可用就用常见位置。
  }
  candidates.push(
    join(process.env.APPDATA ?? '', 'npm', 'node_modules'),
    join(process.env.LOCALAPPDATA ?? '', 'pnpm', 'global', '5', 'node_modules'),
  )
  for (const root of candidates) {
    if (root === '') continue
    const bin = join(root, '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    if (!existsSync(bin)) continue
    try {
      const require = createRequire(pathToFileURL(bin))
      const manifest = require.resolve('@deepseek-ai/dsh-http-proxy/package.json')
      const loaded = await import(pathToFileURL(join(dirname(manifest), 'lib', 'index.js')).href)
      if (typeof loaded?.installProxyFromEnvironment === 'function') return loaded
    } catch {
      // 换下一个候选。
    }
  }
  return undefined
}

if (!existsSync(CONFIG)) {
  console.error(`找不到 ${CONFIG} —— 先在设置里点一次「开启」`)
  process.exit(1)
}

const config = readFileSync(CONFIG, 'utf8')
const mixedPort = Number(/^mixed-port:\s*(\d+)/m.exec(config)?.[1])
const controllerPort = Number(/^external-controller:\s*127\.0\.0\.1:(\d+)/m.exec(config)?.[1])
const secret = /^secret:\s*(\S+)/m.exec(config)?.[1]

if (!Number.isInteger(mixedPort)) {
  console.error('配置里读不到 mixed-port')
  process.exit(1)
}

/** 当前分组选中的节点。 */
async function currentSelection() {
  try {
    const response = await fetch(`http://127.0.0.1:${controllerPort}/proxies`, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(10000),
    })
    const payload = await response.json()
    const picked = []
    for (const [name, value] of Object.entries(payload.proxies ?? {})) {
      if (Array.isArray(value.all) && typeof value.now === 'string') picked.push(`${name} → ${value.now}`)
    }
    return picked
  } catch {
    return []
  }
}

/**
 * 量一轮：用 dsh-http-proxy 的公开 API 换掉全局 dispatcher，或保持直连。
 *
 * 这和插件「开启 / 关闭」走的是同一条路径，所以量出来的就是真实行为。
 * @param proxy 代理 URL，null 表示直连。
 * @returns 统计结果。
 */
async function measure(proxy) {
  let dispose = null
  if (proxy !== null) {
    dispose = await httpProxy.installProxyFromEnvironment(
      { get: (key) => (key === 'https_proxy' || key === 'http_proxy' ? { value: proxy } : undefined) },
      () => {},
    )
  }
  const times = []
  let failed = 0
  for (let i = 0; i < ROUNDS; i += 1) {
    const started = Date.now()
    try {
      const response = await fetch(TARGET, {
        headers: { Connection: 'close' },
        signal: AbortSignal.timeout(30000),
      })
      const body = await response.arrayBuffer()
      if (response.ok && body.byteLength > 0) times.push(Date.now() - started)
      else failed += 1
    } catch {
      failed += 1
    }
  }
  if (dispose !== null) await dispose()
  const avg = times.length === 0 ? null : Math.round(times.reduce((a, b) => a + b, 0) / times.length)
  const min = times.length === 0 ? null : Math.min(...times)
  const max = times.length === 0 ? null : Math.max(...times)
  return { ok: times.length, failed, avg, min, max, times }
}

const httpProxy = await loadHttpProxy()
if (httpProxy === undefined) {
  console.error('定位不到 @deepseek-ai/dsh-http-proxy —— 无法切换 dispatcher')
  process.exit(1)
}

console.log('='.repeat(72))
console.log('直连 vs 走代理')
console.log('='.repeat(72))
console.log(`目标: ${TARGET}`)
console.log(`轮数: ${ROUNDS}（每轮新建连接并读完整 body）`)
console.log(`代理: http://127.0.0.1:${mixedPort}`)
const selection = await currentSelection()
if (selection.length > 0) console.log(`选中: ${selection.join('   ')}`)
console.log('')

const direct = await measure(null)
console.log(`  直连    ${direct.ok}/${ROUNDS} 成功   平均 ${direct.avg ?? '-'} ms   最快 ${direct.min ?? '-'}   最慢 ${direct.max ?? '-'}`)
console.log(`          [${direct.times.join(', ')}]`)

const proxied = await measure(`http://127.0.0.1:${mixedPort}`)
console.log(`  走代理  ${proxied.ok}/${ROUNDS} 成功   平均 ${proxied.avg ?? '-'} ms   最快 ${proxied.min ?? '-'}   最慢 ${proxied.max ?? '-'}`)
console.log(`          [${proxied.times.join(', ')}]`)

console.log('')
const spread = (r) => (r.ok === 0 ? null : (r.max / r.min).toFixed(1))
console.log('='.repeat(72))
console.log(`成功率   直连 ${direct.ok}/${ROUNDS}   走代理 ${proxied.ok}/${ROUNDS}`)
console.log(`波动     直连 ${spread(direct) ?? '-'}x   走代理 ${spread(proxied) ?? '-'}x`)
if (direct.avg !== null && proxied.avg !== null) {
  const delta = proxied.avg - direct.avg
  console.log(
    `平均差   ${delta > 0 ? '+' : ''}${delta} ms（${delta > 0 ? '代理更慢' : '代理更快'}）`,
  )
}
console.log('='.repeat(72))
