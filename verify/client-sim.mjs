/**
 * dsh-api-proxy 客户端侧离线验证。
 *
 * 在 Node 里搭一个最小的 `window.__ModuleLoader__` + react + fetch 环境，
 * 把 lib/client.js 真跑起来：捕获插槽注册 → 渲染设置页 → 断言界面内容 →
 * 点按钮 → 断言它调了正确的宿主接口。
 *
 *   node verify/client-sim.mjs
 */

let passed = 0
let failed = 0

function check(label, ok, detail = '') {
  if (ok) {
    passed += 1
    console.log(`  PASS  ${label}${detail === '' ? '' : `  ${detail}`}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${label}${detail === '' ? '' : `  ${detail}`}`)
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/* ------------------------------------------------------------------ *
 * 假 fetch：把宿主的两条路由换成固定响应
 * ------------------------------------------------------------------ */

let statusPayload = null
const actionCalls = []

globalThis.fetch = async (url, init = {}) => {
  const target = String(url)
  if (target === '/dsh-api-proxy/status') {
    return { ok: true, status: 200, json: async () => statusPayload, text: async () => JSON.stringify(statusPayload) }
  }
  if (target === '/dsh-api-proxy/action') {
    const body = JSON.parse(init.body)
    actionCalls.push(body)
    const result = { ok: true, ...statusPayload }
    if (body.action === 'delay') {
      result.delays = { '🇯🇵东京-E(通用)': 93, '🇺🇸美国-A(通用)': 240, '🇭🇰香港-B(流量)': 0 }
    }
    if (body.action === 'active') result.selection = { '🚀 节点选择': '🇺🇸美国-A(通用)' }
    return { ok: true, status: 200, json: async () => result, text: async () => JSON.stringify(result) }
  }
  throw new Error(`未预期的 fetch：${target}`)
}

/* ------------------------------------------------------------------ *
 * 假 document
 * ------------------------------------------------------------------ */

const styleTags = []
globalThis.document = {
  querySelector: () => null,
  createElement: () => ({ setAttribute() {}, textContent: '', appendChild() {} }),
  head: { appendChild: (tag) => styleTags.push(tag) },
}

/* ------------------------------------------------------------------ *
 * 极简 react：createElement + 可用的 hooks 运行时
 * ------------------------------------------------------------------ */

/** 当前正在渲染的 hook 运行时。 */
let active = null

const react = {
  Fragment: Symbol('Fragment'),
  /** 模块顶层用 `class ... extends react.Component` 声明渲染边界，这里必须有。 */
  Component: class Component {
    constructor(props) {
      this.props = props === undefined ? {} : props
      this.state = {}
    }
    setState() {}
  },
  createElement(type, props, ...children) {
    return { type, props: props === null || props === undefined ? {} : props, children: children.flat(Infinity) }
  },
  useState(initial) {
    return active.useState(initial)
  },
  useEffect(fn, deps) {
    return active.useEffect(fn, deps)
  },
  useCallback(fn, deps) {
    return active.useCallback(fn, deps)
  },
  useMemo(fn, deps) {
    return active.useMemo(fn, deps)
  },
  useRef(value) {
    return active.useRef(value)
  },
  useSyncExternalStore(subscribe, getSnapshot) {
    return active.useSyncExternalStore(subscribe, getSnapshot)
  },
}

/**
 * 一个够用的 hook 运行时：支持重复渲染，effect 只在依赖变化时重跑。
 * @returns 运行时对象。
 */
function createRuntime() {
  const hooks = []
  let cursor = 0
  let pending = []
  let dirty = false

  const sameDeps = (a, b) =>
    Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => Object.is(value, b[i]))

  return {
    useState(initial) {
      const index = cursor
      cursor += 1
      if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial
      return [
        hooks[index],
        (next) => {
          hooks[index] = typeof next === 'function' ? next(hooks[index]) : next
          dirty = true
        },
      ]
    },
    useEffect(fn, deps) {
      const index = cursor
      cursor += 1
      const previous = hooks[index]
      if (previous === undefined || !sameDeps(previous, deps)) {
        hooks[index] = deps
        pending.push(fn)
      }
    },
    useCallback(fn, deps) {
      const index = cursor
      cursor += 1
      const previous = hooks[index]
      if (previous === undefined || !sameDeps(previous.deps, deps)) hooks[index] = { fn, deps }
      return hooks[index].fn
    },
    useMemo(fn, deps) {
      const index = cursor
      cursor += 1
      const previous = hooks[index]
      if (previous === undefined || !sameDeps(previous.deps, deps)) hooks[index] = { value: fn(), deps }
      return hooks[index].value
    },
    useRef(value) {
      const index = cursor
      cursor += 1
      if (!(index in hooks)) hooks[index] = { current: value }
      return hooks[index]
    },
    useSyncExternalStore(subscribe, getSnapshot) {
      const index = cursor
      cursor += 1
      if (hooks[index] === undefined) {
        hooks[index] = getSnapshot()
        subscribe(() => {
          hooks[index] = getSnapshot()
          dirty = true
        })
      }
      const next = getSnapshot()
      if (next !== hooks[index]) hooks[index] = next
      return hooks[index]
    },
    render(Component, props) {
      cursor = 0
      pending = []
      active = this
      const tree = Component(props)
      active = null
      return { tree, effects: pending }
    },
    clearDirty() {
      dirty = false
    },
  }
}

/* ------------------------------------------------------------------ *
 * 加载客户端模块
 * ------------------------------------------------------------------ */

console.log('='.repeat(72))
console.log('dsh-api-proxy 客户端侧离线验证')
console.log('='.repeat(72))
console.log('')

console.log('[1] 模块加载与插槽注册')

let captured = null
globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      captured = definition
    },
  },
}

await import('../lib/client.js')
check('调用了 __ModuleLoader__.load', captured !== null)
check('模块 id 正确', captured?.id === 'dsh-api-proxy', String(captured?.id))

const moduleExports = captured.factory((specifier) => {
  if (specifier === 'react') return react
  throw new Error(`未预期的 require：${specifier}`)
})
check('导出 apply', typeof moduleExports.apply === 'function')
check('导出 inject', Array.isArray(moduleExports.inject))
check(
  'inject 不含两代设置服务',
  !moduleExports.inject.includes('settingsScope') && !moduleExports.inject.includes('configForms'),
  JSON.stringify(moduleExports.inject),
)

const registrations = []
const boundNamespaces = []

/**
 * 假的绑定作用域。
 *
 * **必须是类实例**：真实的 `SettingsScopeBinder.bind()` 返回
 * `new SettingsScopeController(...)`，`subscribe` / `getSnapshot` 是原型方法。
 * 界面若把它们裸传给 `useSyncExternalStore`，`this` 就丢了 —— 真机症状是
 * 设置页整块空白、只剩导航项。用对象字面量（箭头函数属性）做假对象会让
 * 这个 bug 溜过去，所以这里刻意用类，方法写成原型方法。
 */
class FakeSettingsScope {
  constructor(namespace, decode) {
    this.namespace = namespace
    this.decode = decode
    this.listeners = new Set()
    this.doc = { subscriptionUrl: 'https://example.invalid/sub', apiDomains: 'api.example.com' }
    this.cached = null
  }

  /** 契约：稳定引用，直到下一次变化。 */
  getSnapshot() {
    if (this.cached === null) {
      this.cached = { status: 'ready', value: this.decode(this.doc), writable: true, mode: 'settings' }
    }
    return this.cached
  }

  subscribe(listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  set(field, value) {
    this.doc = { ...this.doc, [field]: value }
    this.cached = null
    for (const listener of [...this.listeners]) listener()
    return Promise.resolve(true)
  }

  unset(field) {
    delete this.doc[field]
    this.cached = null
    return Promise.resolve(true)
  }
}

const mockCtx = {
  slots: {
    inject(name, callback) {
      callback()
    },
    register(definition, Component) {
      registrations.push({ definition, Component })
      return () => {}
    },
  },
  inject(services, callback) {
    if (services.includes('settingsScope')) {
      callback({
        settingsScope: {
          bind({ namespace, decode }) {
            boundNamespaces.push(namespace)
            return new FakeSettingsScope(namespace, decode)
          },
        },
      })
    }
  },
  effect: (callback) => callback(),
}

moduleExports.apply(mockCtx)
check('注册了 settings.section 插槽', registrations.length === 1)
check('插槽 id 是 api-proxy', registrations[0]?.definition?.id === 'api-proxy', String(registrations[0]?.definition?.id))
check('绑定了设置命名空间', boundNamespaces.includes('api-proxy'), JSON.stringify(boundNamespaces))
check('注入了样式', styleTags.length > 0)
console.log('')

/* ------------------------------------------------------------------ *
 * 渲染工具
 * ------------------------------------------------------------------ */

/** 把渲染树摊平成文本，便于断言。 */
function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  return node.children.map(textOf).join(' ')
}

/** 递归找出所有满足条件的节点。 */
function findAll(node, predicate, found = []) {
  if (node === null || node === undefined || typeof node !== 'object') return found
  if (Array.isArray(node)) {
    for (const entry of node) findAll(entry, predicate, found)
    return found
  }
  if (predicate(node)) found.push(node)
  for (const child of node.children) findAll(child, predicate, found)
  return found
}

/** 按文本找按钮。 */
function findButton(tree, label) {
  return findAll(tree, (node) => node.type === 'button' && textOf(node).includes(label))[0]
}

/**
 * 渲染到稳定：跑 effect → 等异步 → 重渲染，重复几轮。
 *
 * 首帧的 effect 必须也跑掉 —— 组件的状态全靠它去拉，丢了就永远停在初始态。
 * @returns 最后一帧的渲染结果。
 */
async function renderAndSettle(runtime, Component, props, rounds = 6) {
  let rendered = runtime.render(Component, props)
  for (let i = 0; i < rounds; i += 1) {
    for (const effect of rendered.effects) effect()
    await sleep(60)
    runtime.clearDirty()
    rendered = runtime.render(Component, props)
  }
  return rendered
}

/** 构造一个「核心运行中 + 代理已挂」的状态。 */
function makeStatus(overrides = {}) {
  return {
    ok: true,
    settings: { enabled: true, subscriptionUrl: 'https://example.invalid/sub', apiDomains: 'api.example.com' },
    core: { state: 'running', error: null, version: 'Mihomo Meta v1.19.32', path: 'C:/x/mihomo.exe', installed: true },
    proxy: { installed: true, port: 11172, url: 'http://127.0.0.1:11172' },
    subscription: {
      nodeCount: 45,
      fetchedAt: '2026-10-15T05:00:00.000Z',
      userinfo: { upload: 15147766106, download: 140834748648, total: 519691042816, expire: 1793983603 },
    },
    groups: [
      { name: '🚀 节点选择', type: 'select', members: ['🇯🇵东京-E(通用)', '🇺🇸美国-A(通用)', '🇭🇰香港-B(流量)'] },
      { name: '♻️ 自动选择', type: 'url-test', members: ['🇯🇵东京-E(通用)', '🇺🇸美国-A(通用)'] },
    ],
    proxies: [
      { name: '🇯🇵东京-E(通用)', type: 'vless' },
      { name: '🇺🇸美国-A(通用)', type: 'tuic' },
      { name: '🇭🇰香港-B(流量)', type: 'hysteria2' },
    ],
    lastMessage: null,
    ...overrides,
  }
}

/* ------------------------------------------------------------------ *
 * 渲染
 * ------------------------------------------------------------------ */

console.log('[2] 渲染设置页（核心运行中）')
statusPayload = makeStatus()
const runtime = createRuntime()

// 从插槽定义里取作用域（模拟 harness 渲染时注入）。
const definition = registrations[0].definition
const injectedProps = definition.inject()
check('插槽注入了 scope', injectedProps.scope !== undefined)
check('注入的 scope 是被适配过的真实实例', boundNamespaces.includes('api-proxy'))

// 入口组件只负责包渲染边界并把 scope 传下去，本身不调 hook。
const entryTree = runtime.render(registrations[0].Component, injectedProps).tree
check('插槽入口不抛错', entryTree !== undefined)
const innerElement = entryTree.children[0]
check(
  '入口把 scope 传给了设置组件',
  typeof innerElement?.type === 'function' && innerElement.props.scope !== undefined,
)
check(
  '作用域是类实例（原型方法，裸传会丢 this）',
  Object.getPrototypeOf(innerElement.props.scope) !== Object.prototype,
)

// 真正的设置组件单独渲染 —— 它的 props 里那个 scope 正是上面适配出来的实例。
const Section = innerElement.type
const sectionProps = innerElement.props

let rendered = await renderAndSettle(runtime, Section, sectionProps)
const text = textOf(rendered.tree)

check('渲染没有抛错', rendered.tree !== undefined)
check('显示「代理已挂上」', text.includes('代理已挂上'))
check('显示核心版本', text.includes('v1.19.32'))
check('显示代理地址', text.includes('http://127.0.0.1:11172'))
check('显示订阅用量', text.includes('已用') && text.includes('GB'))
// 到期时间按本地时区显示（机场的到期时刻以本地时间为准）：
// unix 1793983603 = 2026-11-06 16:46 UTC = 2026-11-07 00:46 UTC+8。
const expireLocal = new Date(1793983603 * 1000)
const expireText = `${expireLocal.getFullYear()}-${String(expireLocal.getMonth() + 1).padStart(2, '0')}-${String(
  expireLocal.getDate(),
).padStart(2, '0')}`
check('显示到期日', text.includes(expireText), `期望 ${expireText}`)
check('显示节点数量', text.includes('45 个节点'))
check('列出节点', text.includes('🇯🇵东京-E(通用)') && text.includes('🇺🇸美国-A(通用)'))
check('显示节点协议', text.includes('vless') || text.includes('tuic'))
check('显示当前选中节点', text.includes('🇺🇸美国-A(通用)'))
check('显示分流域名', text.includes('api.example.com'))
check('说明其余直连', text.includes('一律直连'))
console.log('')

console.log('[3] 交互：测速')
const measureButton = findButton(rendered.tree, '测速')
check('找到「测速」按钮', measureButton !== undefined)
actionCalls.length = 0
measureButton.props.onClick()
await sleep(300)
const delayCall = actionCalls.find((call) => call.action === 'delay')
check('点了测速会调 delay 接口', delayCall !== undefined, JSON.stringify(delayCall))
check('delay 带了分组', typeof delayCall?.group === 'string' && delayCall.group !== '', String(delayCall?.group))
check('delay 带了测速地址', typeof delayCall?.url === 'string' && delayCall.url.startsWith('http'), String(delayCall?.url))

rendered = await renderAndSettle(runtime, Section, sectionProps)
const afterDelay = textOf(rendered.tree)
check('界面显示延迟数字', afterDelay.includes('93 ms'))
check('超时节点显示为超时', afterDelay.includes('超时'))
console.log('')

console.log('[4] 交互：锁定最快节点')
const pickButton = findButton(rendered.tree, '测速并锁定最快')
check('找到「测速并锁定最快」按钮', pickButton !== undefined)
actionCalls.length = 0
pickButton.props.onClick()
await sleep(400)
const selectCall = actionCalls.find((call) => call.action === 'select')
check('会自动切到最快节点', selectCall !== undefined, JSON.stringify(selectCall))
check('切的是 93ms 那个节点', selectCall?.node === '🇯🇵东京-E(通用)', String(selectCall?.node))
console.log('')

console.log('[5] 交互：关闭开关')
rendered = await renderAndSettle(runtime, Section, sectionProps)
const offButton = findButton(rendered.tree, '关闭')
check('找到「关闭」按钮', offButton !== undefined)
actionCalls.length = 0
offButton.props.onClick()
await sleep(300)
check('点了关闭会调 disable 接口', actionCalls.some((call) => call.action === 'disable'))
console.log('')

console.log('[6] 核心未装时的界面')
statusPayload = makeStatus({
  core: { state: 'stopped', error: null, version: null, path: 'C:/x/mihomo.exe', installed: false },
  proxy: { installed: false, port: null, url: null },
  subscription: null,
  groups: [],
  proxies: [],
})
const runtime2 = createRuntime()
const rendered2 = await renderAndSettle(runtime2, Section, sectionProps)
const text2 = textOf(rendered2.tree)
check('显示「直连中」', text2.includes('直连中'))
check('提示下载核心', text2.includes('下载核心'))
check('没有节点区块时不崩', !text2.includes('这个分组没有成员'))
check('开启按钮可用', findButton(rendered2.tree, '开启') !== undefined)
console.log('')

console.log('[7] 兜底：scope 缺席时也不该整块空白')
const noScopeTree = runtime2.render(registrations[0].Component, {}).tree
const fallbackInner = noScopeTree.children[0]
check('入口在 scope 缺席时仍给出组件', fallbackInner !== undefined && fallbackInner.props.scope !== undefined)
console.log('')

console.log('='.repeat(72))
console.log(`结果：${passed} 通过，${failed} 失败`)
console.log('='.repeat(72))
process.exit(failed === 0 ? 0 : 1)
