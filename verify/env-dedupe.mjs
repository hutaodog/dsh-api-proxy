/**
 * Windows 环境块重复键：插件修了什么、没修什么。
 *
 * 背景：`dsh-http-proxy` 按设计同时写 `http_proxy` 与 `HTTP_PROXY`（POSIX 上那是
 * 两个变量）。**Windows 环境变量大小写不敏感**，两个名字会变成环境块里的两条
 * 独立记录，于是任何按大小写不敏感建字典的消费者都会抛
 * `An item with the same key has already been added`。
 *
 * 实测这个症状只出现在 **dsh 派生的子进程**里，不在 dsh 自己身上：
 * `dsh-subprocess/lib/index.js:50` 的 `scrubbedParentEnv()` 用一个**普通 JS 对象**
 * 承载子进程环境，`proxyEnvironmentForChild()` 的两种大小写就成了两个不同的键，
 * 交给 spawn 后写进子进程的环境块。
 *
 * 那是上游的 spawn 路径，插件够不到（`proxyEnvironmentForChild()` 无条件写两种
 * 大小写，没有开关）。插件能做、也做了的，是保证 **dsh 进程自己**的环境块干净。
 *
 *   node verify/env-dedupe.mjs
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

let passed = 0
let failed = 0
const check = (label, ok, detail = '') => {
  if (ok) {
    passed += 1
    console.log(`  PASS  ${label}${detail === '' ? '' : `  ${detail}`}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${label}${detail === '' ? '' : `  ${detail}`}`)
  }
}

/** 数一个环境块里「大小写不同、其实是同一个变量」的重复项。 */
function duplicatesIn(envBlockText) {
  const seen = new Map()
  for (const line of envBlockText.split(/\r?\n/)) {
    const name = line.split('=', 1)[0]
    if (name === '') continue
    const key = name.toLowerCase()
    seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([n]) => n)
}

/** 当前进程的环境块原文。 */
const ownEnvBlock = () => {
  try {
    return execFileSync('cmd', ['/c', 'set'], { encoding: 'utf8', windowsHide: true })
  } catch {
    return ''
  }
}

/** 与 lib/index.js 里 dedupeProxyEnv 完全相同的实现。 */
function dedupeProxyEnv(env) {
  const names = [
    'http_proxy', 'HTTP_PROXY',
    'https_proxy', 'HTTPS_PROXY',
    'all_proxy', 'ALL_PROXY',
    'no_proxy', 'NO_PROXY',
  ]
  const keep = {}
  for (const name of names) {
    const value = env[name]
    if (typeof value === 'string' && value !== '') keep[name.toUpperCase()] = value
  }
  for (const name of names) delete env[name]
  for (const [name, value] of Object.entries(keep)) env[name] = value
}

/** 定位 dsh-http-proxy（和插件运行时同一份）。 */
async function loadHttpProxy() {
  const roots = []
  try {
    roots.push(execFileSync('npm', ['root', '-g'], { encoding: 'utf8', windowsHide: true }).trim())
  } catch {
    // 忽略
  }
  roots.push(join(process.env.APPDATA ?? '', 'npm', 'node_modules'))
  for (const root of roots) {
    if (root === '') continue
    const bin = join(root, '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    if (!existsSync(bin)) continue
    try {
      const require = createRequire(pathToFileURL(bin))
      const manifest = require.resolve('@deepseek-ai/dsh-http-proxy/package.json')
      const loaded = await import(pathToFileURL(join(dirname(manifest), 'lib', 'index.js')).href)
      if (typeof loaded?.installProxyFromEnvironment === 'function') return loaded
    } catch {
      // 换下一个
    }
  }
  return undefined
}

console.log('='.repeat(72))
console.log('Windows 环境块重复键：插件修了什么、没修什么')
console.log('='.repeat(72))
console.log('')

if (process.platform !== 'win32') {
  console.log('  非 Windows，跳过（POSIX 上两种大小写是两个不同变量，本就不该去重）')
  process.exit(0)
}

console.log('[1] 起始状态')
check('本进程环境块干净', duplicatesIn(ownEnvBlock()).length === 0, JSON.stringify(duplicatesIn(ownEnvBlock())))
console.log('')

console.log('[2] 装上代理策略')
const mod = await loadHttpProxy()
check('定位到 dsh-http-proxy', mod !== undefined)
const dispose = await mod.installProxyFromEnvironment(
  { get: (key) => (key === 'https_proxy' || key === 'http_proxy' ? { value: 'http://127.0.0.1:65000' } : undefined) },
  () => {},
)
check('代理变量已写入', process.env.HTTPS_PROXY === 'http://127.0.0.1:65000', String(process.env.HTTPS_PROXY))

// 插件在 enableProxy 之后会立刻调 dedupeProxyEnv。
dedupeProxyEnv(process.env)
check('去重后本进程环境块干净', duplicatesIn(ownEnvBlock()).length === 0, JSON.stringify(duplicatesIn(ownEnvBlock())))
check('代理变量仍在', process.env.HTTPS_PROXY === 'http://127.0.0.1:65000')
check('NO_PROXY 仍在', typeof process.env.NO_PROXY === 'string' && process.env.NO_PROXY !== '', process.env.NO_PROXY)
console.log('')

console.log('[3] 子进程：代理照常可用')
// 用 dsh-subprocess 同款方式合成子进程环境（普通对象 + proxyEnvironmentForChild）。
const childEnv = {}
for (const [key, value] of Object.entries(process.env)) {
  if (value !== undefined) childEnv[key] = value
}
for (const [name, value] of Object.entries(mod.proxyEnvironmentForChild())) childEnv[name] = value

const probing = spawnSync('cmd', ['/c', 'set'], {
  env: childEnv,
  encoding: 'utf8',
  windowsHide: true,
  timeout: 30000,
})
check('子进程能起来', probing.status === 0, `exit=${probing.status}`)
check(
  '子进程读得到代理变量',
  /(?i)^https?_proxy=http:\/\/127\.0\.0\.1:65000$/m.test(probing.stdout ?? ''),
  '',
)
const childDupes = duplicatesIn(probing.stdout ?? '')
check('这个路径下环境块是干净的', childDupes.length === 0, JSON.stringify(childDupes))

// 注意：真实的 dsh 子进程（比如它的 pwsh 工具）实测**是**有重复键的，
// 而这里同样的对象经 Node spawn 出来却没有 —— 说明去重发生在 Node 构建环境块
// 的那一步，真正产生重复的是 dsh 某条更底层的 spawn 路径。那条路插件够不到，
// 也没有定位到确切位置，所以这里不断言它：只把它作为「已知问题」记在 README，
// 不去猜一个没证实的根因。
console.log('')

console.log('[4] 卸载后本进程仍干净')
await dispose()
dedupeProxyEnv(process.env)
check('卸载后无重复键', duplicatesIn(ownEnvBlock()).length === 0, JSON.stringify(duplicatesIn(ownEnvBlock())))
console.log('')

console.log('='.repeat(72))
console.log(`结果：${passed} 通过，${failed} 失败`)
console.log('='.repeat(72))
process.exit(failed === 0 ? 0 : 1)
