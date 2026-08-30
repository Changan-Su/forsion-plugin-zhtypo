/**
 * 中文排版 zhtypo 插件自检:宿主同款 new Function('ctx', src) 求值 main.js
 * + DOM 垫片 + 假 PM 工具箱 + 内存 vault + 冻钟 + setTimeout 记账。
 *
 * 覆盖 SPEC 第 7 节全部 30 项:
 *   7.A 静态纪律 6 项(无 import/export、禁 innerHTML/setInterval/裸 new Date()/写死白字、
 *       禁 prosemirror/@milkdown 直引、禁挂文档根、ASI 陷阱、禁块寻址 API 与块字典字段)
 *   7.B 20260814 的 8 项(贡献点齐全 / disposer / 纯函数向量 / XSS / 数据契约 / 旧宿主 /
 *       词表两侧键相等 / 切英文重渲 + zh→en→zh 往返 + 不重挂)
 *   7.C 20260821 的 2 项(v4 路由自检 / 活动页写保护)
 *   7.D 本插件特有 14 项(豁免区 17 子类正反断言 / 不裁剪 / 前置校验 / 批量原子性 / 降序 /
 *       putPlan 三分支与 marks 交集 / 标题闸二 / 空区间不画装饰 / 字数上限 / 单井号双分支 /
 *       忽略清单 / 同名冲突 / 读失败不折叠 / apply 兜底 / 合成期不介入 / 视图销号)
 *
 * 跑法:node check.mjs(零依赖)。红了就是插件装不上或会改坏用户文件,别推。
 */
process.env.TZ = 'Asia/Shanghai'
import { readFileSync } from 'node:fs'
import { strict as assert } from 'node:assert'

const src = readFileSync(new URL('./main.js', import.meta.url), 'utf8')

let passed = 0
let failed = 0
function ok(name, cond, detail) {
  if (cond) {
    passed++
    console.log('PASS  ' + name)
  } else {
    failed++
    console.log('FAIL  ' + name + (detail === undefined ? '' : '  | ' + String(detail).slice(0, 240)))
  }
}
function eq(name, actual, expected) {
  let same = true
  try {
    assert.deepStrictEqual(actual, expected)
  } catch (e) {
    same = false
  }
  ok(name, same, 'got=' + JSON.stringify(actual) + ' want=' + JSON.stringify(expected))
}

// ══ 7.A 静态纪律 ══════════════════════════════════════════════════════════
ok('A1 无顶层 import/export', !/^\s*(import|export)\s/m.test(src))
ok('A2a 禁 innerHTML', !/innerHTML/.test(src))
ok('A2b 禁 setInterval', !/setInterval/.test(src))
ok('A2c 禁裸 new Date()', !/new Date\(\)/.test(src))
ok('A2d 禁写死白字 color:#fff', !/color:\s*#fff/i.test(src))
ok('A3a 禁 from "prosemirror"', !/from ['"]prosemirror/.test(src))
ok('A3b 禁 @milkdown', !/@milkdown/.test(src))
ok('A4 浮层禁挂文档根 document.body.appendChild', !/document\.body\.appendChild/.test(src))
{
  const lines = src.split('\n')
  const asi = [...lines.keys()].filter((i) => {
    if (!/^\s*[([]/.test(lines[i])) return false
    let p = i - 1
    while (p >= 0 && !lines[p].trim()) p--
    return p >= 0 && /[)\]'"`\w]\s*$/.test(lines[p])
  }).map((i) => i + 1)
  ok('A5 无 ASI 陷阱行', asi.length === 0, '第 ' + asi.join(',') + ' 行')
}
for (const bad of ['insertBlockAfter', 'deleteBlock', 'setFmExtra', 'mountBlocks', 'requestFocus']) {
  ok('A6 源码不出现块寻址 API ' + bad, src.indexOf(bad) < 0)
}
ok('A6 源码不读 page 的块字典字段', !/\.blocks\b/.test(src) && !/\.order\b/.test(src))
ok('A6 源码不调 insertMarkdown(本插件走 PM 事务,更严格)', src.indexOf('insertMarkdown') < 0)

// ══ 垫片 ══════════════════════════════════════════════════════════════════
const byId = new Map()
function mkText(v) {
  const n = { tag: '#text', children: [], attrs: {} }
  let s = String(v)
  Object.defineProperty(n, 'textContent', { get: () => s, set: (x) => { s = String(x) } })
  return n
}
function mkEl(tag) {
  const el = {
    tag: String(tag), children: [], attrs: {}, listeners: {}, parentElement: null, isConnected: true,
    className: '', disabled: false, value: '', scrollTop: 0,
    style: { setProperty() {}, removeProperty() {} },
    focus() {}, blur() {},
    setAttribute(k, v) { el.attrs[k] = String(v) },
    getAttribute(k) { return k in el.attrs ? el.attrs[k] : null },
    removeAttribute(k) { delete el.attrs[k] },
    addEventListener(t, f) { const a = el.listeners[t] || (el.listeners[t] = []); a.push(f) },
    removeEventListener() {},
    closest() { return null },
    scrollIntoView() {},
    getBoundingClientRect: () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 10, height: 10 }),
    remove() {
      const p = el.parentElement
      if (p) p.children = p.children.filter((x) => x !== el)
      el.parentElement = null
      el.isConnected = false
    },
  }
  el.classList = {
    add: (...cs) => { const s = new Set(el.className.split(/\s+/).filter(Boolean)); cs.forEach((c) => s.add(c)); el.className = [...s].join(' ') },
    remove: (...cs) => { el.className = el.className.split(/\s+/).filter((c) => c && !cs.includes(c)).join(' ') },
    contains: (c) => el.className.split(/\s+/).includes(c),
  }
  let own = ''
  el.appendChild = (c) => {
    el.children.push(c)
    if (c && typeof c === 'object') c.parentElement = el
    return c
  }
  Object.defineProperty(el, 'textContent', {
    get: () => own + el.children.map((c) => (c && c.textContent) || '').join(''),
    set: (v) => { el.children.length = 0; own = String(v) },
  })
  Object.defineProperty(el, 'id', {
    get: () => el._id || '',
    set: (v) => { el._id = String(v); if (v) byId.set(String(v), el) },
  })
  return el
}
globalThis.document = {
  head: mkEl('head'),
  body: mkEl('body'),
  documentElement: mkEl('html'),
  createElement: mkEl,
  createTextNode: mkText,
  createDocumentFragment: () => mkEl('#frag'),
  getElementById: (id) => (byId.has(String(id)) ? byId.get(String(id)) : null),
  addEventListener() {},
  removeEventListener() {},
}
globalThis.window = { innerWidth: 1280, innerHeight: 800, addEventListener() {}, removeEventListener() {} }
const _ls = new Map()
globalThis.localStorage = {
  getItem: (k) => (_ls.has(k) ? _ls.get(k) : null),
  setItem: (k, v) => _ls.set(k, String(v)),
  removeItem: (k) => _ls.delete(k),
}
const findAll = (node, pred) => {
  const out = []
  const walk = (n) => { for (const c of (n.children || [])) { if (pred(c)) out.push(c); walk(c) } }
  walk(node)
  return out
}

// ── 冻钟(2026-08-21 12:34 上海) ──
const NOW = Date.parse('2026-08-21T04:34:00.000Z')
Date.now = () => NOW

// ── setTimeout 记账(disposer 断言用) ──
const pendingTimers = new Set()
const realST = globalThis.setTimeout
const realCT = globalThis.clearTimeout
globalThis.setTimeout = (fn, ms) => {
  const id = realST(() => { pendingTimers.delete(id); fn() }, ms)
  pendingTimers.add(id)
  return id
}
globalThis.clearTimeout = (id) => { pendingTimers.delete(id); return realCT(id) }

// ── console.error 记账 ──
let errCount = 0
const realErr = console.error
console.error = (...a) => { errCount++; void a }

// ══ 假 ProseMirror 工具箱 ══════════════════════════════════════════════════
class FakePlugin {
  constructor(spec) { this.spec = spec; this.props = spec.props || {}; this.key = spec.key }
}
class FakePluginKey {
  constructor(name) { this.name = name }
  getState(state) { return state && state.zh ? state.zh : null }
}
const deco = { inline: 0, calls: [] }
const pm = {
  Plugin: FakePlugin,
  PluginKey: FakePluginKey,
  Selection: class {},
  TextSelection: { near: (r) => ({ near: true, r }) },
  NodeSelection: class {},
  Decoration: {
    inline: (a, z, attrs) => { deco.inline++; deco.calls.push([a, z, attrs]); return { a, z, attrs } },
    widget: () => ({}), node: () => ({}),
  },
  DecorationSet: { create: (doc, list) => ({ doc, list }), empty: { empty: true } },
  Slice: class {}, Fragment: class {},
  keymap: () => new FakePlugin({}), InputRule: class {}, inputRules: () => new FakePlugin({}),
}

// ── 假文档(逐字对齐偏移:块 i 起点 pos,正文起点 base = pos + 1) ──
function mkTextNode(text, marks) { return { isText: true, text, marks: marks || [], nodeSize: text.length } }
function mkLeaf(name, size) { return { isText: false, type: { name, spec: {} }, nodeSize: size || 1, marks: [] } }
function mkBlock(children, name, spec) {
  const kids = children.map((c) => (typeof c === 'string' ? mkTextNode(c) : c))
  const size = kids.reduce((a, k) => a + k.nodeSize, 0) + 2
  return {
    isTextblock: true,
    type: { name: name || 'paragraph', spec: spec || {} },
    nodeSize: size,
    kids,
    forEach(cb) { let off = 0; for (const k of kids) { cb(k, off); off += k.nodeSize } },
  }
}
function mkDoc(blocks) {
  const bs = blocks.map((b) => (typeof b === 'string' ? mkBlock([b]) : b))
  const placed = []
  let pos = 0
  for (const b of bs) { placed.push({ node: b, pos }); pos += b.nodeSize }
  return {
    placed,
    content: { size: pos },
    descendants(fn) { for (const p of placed) fn(p.node, p.pos) },
    textBetween(a, z) {
      let out = ''
      for (const p of placed) {
        let off = p.pos + 1
        for (const k of p.node.kids) {
          if (k.isText) {
            const e = off + k.nodeSize
            const from = Math.max(a, off)
            const to = Math.min(z, e)
            if (to > from) out += k.text.slice(from - off, to - off)
          }
          off += k.nodeSize
        }
      }
      return out
    },
    resolve: () => ({}),
  }
}
const PARA_TYPE = { name: 'paragraph' } // 假 schema 里的「不是 heading」哨兵
/** `opts.allowHeading === false` 模拟**容器不允许 heading**(列表项的 content 规格是
 *  `paragraph block*`)—— 真 prosemirror 的 setBlockType 在这种块上是**静默跳过**:不抛、不报,
 *  而同一个 tr 上的 delete 照样生效。这是评审 Finding 1 的形状,以前的假 tr 看不见它。 */
function mkTr(doc, opts) {
  const calls = []
  const allowHeading = !opts || opts.allowHeading !== false
  let became = null
  const trDoc = Object.create(doc)
  trDoc.resolve = (pos) => {
    const base = typeof doc.resolve === 'function' ? doc.resolve(pos) : {}
    return base && base.parent ? base : Object.assign({}, base, { parent: { type: became || PARA_TYPE } })
  }
  const tr = {
    doc: trDoc, calls, docChanged: false, meta: null,
    delete(a, z) { calls.push(['delete', a, z]); return tr },
    insertText(s, a, z) { calls.push(['insertText', s, a, z]); return tr },
    replaceWith(a, z, n) { calls.push(['replaceWith', a, z, n]); return tr },
    setBlockType(a, z, ty, at) { calls.push(['setBlockType', a, z, ty, at]); if (allowHeading) became = ty; return tr },
    setSelection(s) { calls.push(['setSelection', s]); return tr },
    setMeta(k, v) { tr.meta = { k, v }; return tr },
    getMeta(k) { return tr.meta && tr.meta.k === k ? tr.meta.v : null },
    mapping: { map: (p) => p, maps: [] },
  }
  return tr
}
const schemaTextCalls = []
function mkSchema(withHeading) {
  const s = {
    nodes: withHeading === false ? {} : { heading: { spec: { attrs: { level: {} } } } },
    text: (str, marks) => { schemaTextCalls.push({ str, marks }); return { isText: true, text: str, marks: marks || [] } },
  }
  return s
}
function mkView(doc, schema, opts) {
  const dispatched = []
  const view = {
    composing: false,
    dispatched,
    dom: {
      isConnected: true,
      addEventListener() {}, removeEventListener() {},
      compareDocumentPosition: () => 0,
      scrollIntoView() {},
      closest: () => null,
    },
    hasFocus: () => true,
    focus() {},
    coordsAtPos: () => ({ left: 10, bottom: 20 }),
    dispatch(tr) { dispatched.push(tr) },
  }
  view.state = {
    doc,
    schema: schema || mkSchema(true),
    selection: { $from: { parent: { isTextblock: true }, start: () => 1 } },
    get tr() { return mkTr(doc, opts) },
  }
  return view
}
/** 纯文本假 view:doc 直接由一个字符串支撑,base 从 0 起,plan 测试用起来最省事。 */
function mkTextView(full, schema, opts) {
  const doc = {
    content: { size: full.length },
    textBetween: (a, z) => full.slice(a, z),
    resolve: () => ({}),
    descendants() {},
  }
  return mkView(doc, schema, opts)
}

// ══ mock ctx ══════════════════════════════════════════════════════════════
const V = new Map()
const writes = []
let readFails = false
const nullReads = new Set()
let locale = 'zh'
const localeSubs = new Set()
const reg = { views: [], commands: [], slash: [], settings: [], status: [], editorExts: [], notices: [], activity: [] }
const appCalls = { getPage: 0, getActivePage: 0, subscribePage: 0 }
let dataBlob = null
let activePage = 'notes/写作稿.md'
let pageSnapshot = null

function makeCtx() {
  return {
    app: {
      getActivePage: () => { appCalls.getActivePage++; return activePage },
      getPage: () => { appCalls.getPage++; return pageSnapshot },
      subscribePage: (cb) => { appCalls.subscribePage++; void cb; return () => {} },
      readFile: async (p) => {
        if (readFails) throw new Error('EBUSY (mock)')
        if (nullReads.has(p)) return null
        return V.has(p) ? V.get(p) : null
      },
      writeFile: async (p, txt) => { V.set(p, String(txt)); writes.push(p) },
      // 只读枚举面(真宿主 ctx.app 上这两个方法恒在,pluginStore.ts:207-208);nullReads 里的路径
      // 模拟「文件在库里、但这一刻 readFile 给 null」——宿主对读失败的真实形态。
      listPages: async () => Array.from(V.keys()).filter((x) => /\.md$/i.test(x) && !x.split('/').pop().startsWith('.')),
      listFiles: async () => Array.from(V.keys()).filter((x) => !/\.md$/i.test(x) && !x.split('/').pop().startsWith('.')),
      workFolder: () => '中文排版',
      notify() {},
    },
    registerView: (v) => reg.views.push(v),
    registerCommand: (c) => reg.commands.push(c),
    registerSlashItem: (s) => reg.slash.push(s),
    registerSetting: (s) => reg.settings.push(s),
    registerStatusItem: (s) => { reg.status.push(s); return { update(p) { s.text = p.text; s.title = p.title }, dispose() {} } },
    registerEditorExtension: (f, o) => reg.editorExts.push({ f, o }),
    openView() {},
    notify: (m, o) => reg.notices.push({ m, o }),
    getLocale: () => locale,
    subscribeLocale: (cb) => { localeSubs.add(cb); return () => localeSubs.delete(cb) },
    loadData: async () => dataBlob,
    saveData: async (v) => { dataBlob = JSON.parse(JSON.stringify(v)) },
    activity: { log: (e, d) => reg.activity.push({ e, d }) },
    achievements: { registerSeries() {}, track() {} },
  }
}
function setLocale(l) {
  locale = l
  for (const cb of Array.from(localeSubs)) cb(l)
}

const ctx = makeCtx()
globalThis.__ZHTYPO_TEST__ = {}
let dispose
try {
  dispose = new Function('ctx', src)(ctx)
  ok('main.js 在宿主装载方式下求值通过', true)
} catch (e) {
  ok('main.js 在宿主装载方式下求值通过', false, String(e && e.stack ? e.stack : e))
  console.error = realErr
  process.exit(1)
}
const T = globalThis.__ZHTYPO_TEST__
await T.ready

// ══ 7.B-7 贡献点齐全 ══════════════════════════════════════════════════════
ok('B7 注册 report 视图', !!reg.views.find((v) => v.id === 'report' && typeof v.mount === 'function' && v.singleton === true))
for (const id of ['zhtypo-open', 'zhtypo-check', 'zhtypo-fix-note']) {
  ok('B7 注册命令 ' + id, !!reg.commands.find((c) => c.id === id && typeof c.run === 'function'))
}
ok('B7 注册斜杠项 zhtypo-report', !!reg.slash.find((s) => s.id === 'zhtypo-report' && typeof s.run === 'function'))
{
  const want = ['ruleSpace', 'rulePunct', 'ruleQuote', 'ruleDup', 'ruleHeading', 'ruleTrailing', 'headingSingleHash', 'maxBlockChars', 'workFolder']
  const got = reg.settings.map((s) => s.key)
  ok('B7 9 个设置项一个不少', want.every((k) => got.includes(k)) && want.length === 9, JSON.stringify(got))
  const mx = reg.settings.find((s) => s.key === 'maxBlockChars')
  ok('B7 maxBlockChars 是 number 且 default 20000 / min 2000 / max 200000',
    mx && mx.type === 'number' && mx.default === 20000 && mx.min === 2000 && mx.max === 200000)
}
ok('B7 注册状态栏项 hits', !!reg.status.find((s) => s.id === 'hits' && typeof s.onClick === 'function'))
ok('B7 编辑器扩展只注册 1 次', reg.editorExts.length === 1, String(reg.editorExts.length))
ok('B7 编辑器扩展 priority 不是 high', reg.editorExts[0] && reg.editorExts[0].o && reg.editorExts[0].o.priority !== 'high')
ok('B7 斜杠项 run() 返回空串(一个字都不插)', reg.slash[0].run() === '')

// ══ 7.B-13 词表两侧键集合相等 ══════════════════════════════════════════════
{
  const zh = Object.keys(T.MSG.zh).sort()
  const en = Object.keys(T.MSG.en).sort()
  const missEn = zh.filter((k) => !(k in T.MSG.en))
  const missZh = en.filter((k) => !(k in T.MSG.zh))
  ok('B13 zh→en 无漏翻', missEn.length === 0, missEn.join(','))
  ok('B13 en→zh 无多余', missZh.length === 0, missZh.join(','))
  ok('B13 SPEC 点名的键全在', ['title', 'statusHits', 'fixedN', 'hitsSummary', 'lineCol', 'listSep', 'srcLive', 'srcStale', 'reportIsActive'].every((k) => k in T.MSG.zh))
  ok('B13 英文侧列表分隔符不是中文顿号', T.MSG.en.listSep === ', ')
  ok('B13 英文侧复数不硬拼', /\(s\)/.test(T.MSG.en.fixedN))
}
// t() 单趟正则:用户数据里带 {n} 不许被当占位符二次吃掉
{
  const s = T.t('fixedN', { n: '{n}' })
  ok('B13 t() 单趟替换(值里的 {n} 不再被吃)', s.indexOf('{n}') >= 0)
  ok('B13 t() 未知键原样留着', T.t('hitsSummary', { n: 1 }).indexOf('{m}') >= 0)
}

// ══ 7.B-9 / 7.D 纯函数已知向量 ════════════════════════════════════════════
const S = (text, o) => T.scanText(text, o || {})
// §5.4 ruleSpace
{
  const h = T.ruleSpace('这是Forsion桌面端')
  eq('D9 space 这是Forsion桌面端 → 2 hit', h.map((x) => [x.from, x.to, x.fix.from]), [[1, 3, 2], [8, 10, 9]])
  eq('D9 space 已有空格 → 0', T.ruleSpace('这是 Forsion 桌面端').length, 0)
  eq('D9 space 版本2.0发布 → 2', T.ruleSpace('版本2.0发布').map((x) => [x.from, x.to]), [[1, 3], [4, 6]])
  eq('D9 space 行内代码 → 0', S('这是`Forsion`桌面').length, 0)
  eq('D9 space URL 里的中英交界 → 0', S('见 https://forsion.app/文档 一节').length, 0)
  eq('D9 space 纯中文 → 0', T.ruleSpace('一二三四五').length, 0)
  eq('D9 space 纯英文 → 0', T.ruleSpace('ABC DEF').length, 0)
  const f = T.ruleSpace('这是Forsion桌面端')[0].fix
  ok('D9 space 的 fix 是纯插入(from === to,expect 空串)', f.from === f.to && f.expect === '' && f.insert === ' ')
}
// §5.5 rulePunct
{
  const a = T.rulePunct('你好,世界。今天?')
  eq('D9 punct 你好,世界。今天? → 2 hit(i=2 / i=8)', a.map((x) => [x.from, x.fix.insert]), [[2, '，'], [8, '？']])
  const b = T.rulePunct('他说「你好」,她说“再见”')
  eq('D9 punct 前一个字是」也要认(宽类)', b.map((x) => x.from), [6])
  eq('D9 punct 文件叫笔记.md → 0', T.rulePunct('文件叫笔记.md').length, 0)
  eq('D9 punct 会议时间11:30开始 → 0', T.rulePunct('会议时间11:30开始').length, 0)
  const c = T.rulePunct('Use Forsion，it is good')
  eq('D9 punct 英文句子里的全角 → 1(i=11)', c.map((x) => [x.from, x.fix.insert]), [[11, ',']])
  eq('D9 punct Forsion，扶桑 → 0(本行有中文)', T.rulePunct('Forsion，扶桑').length, 0)
  const d = T.rulePunct('这是一句话.然后呢')
  eq('D9 punct 这是一句话.然后呢 → 1(i=5)', d.map((x) => [x.from, x.fix.insert]), [[5, '。']])
  eq('D9 punct 围栏里的 x,y → 0', S('```\n代码块里的 x,y\n```').length, 0)
}
// §5.6 ruleQuote
{
  const t1 = '他说「你好」,她说“再见”'
  const q1 = T.ruleQuote(t1, T.quoteStats(t1))
  ok('D9 quote 混用 → 2 hit 且 fix 恒 null', q1.length === 2 && q1.every((x) => x.fix === null), JSON.stringify(q1.map((x) => x.from)))
  const t2 = '他说「你好」,她说「再见」'
  eq('D9 quote 只有直角引号 → 0', T.ruleQuote(t2, T.quoteStats(t2)).length, 0)
  const t3 = '他说“你好”,她说“再见”'
  eq('D9 quote 只有弯引号 → 0', T.ruleQuote(t3, T.quoteStats(t3)).length, 0)
  eq('D9 quoteStats 计数', T.quoteStats(t1), { corner: 2, curly: 2 })
}
// §5.7 ruleDup
{
  const a = T.ruleDup('这的的确很重要')
  eq('D9 dup 这的的确很重要 → 1 hit {1,3}', a.map((x) => [x.from, x.to, x.fix.from, x.fix.to]), [[1, 3, 2, 3]])
  eq('D9 dup 我看看这个 → 0(合法叠词不在名单)', T.ruleDup('我看看这个').length, 0)
  eq('D9 dup 他是是学生 → 1', T.ruleDup('他是是学生').length, 1)
  eq('D9 dup 慢慢地走 → 0', T.ruleDup('慢慢地走').length, 0)
  eq('D9 dup 的的的 → 1(不重叠扫描)', T.ruleDup('的的的').map((x) => [x.from, x.to]), [[0, 2]])
}
// §5.8 ruleHeading
{
  const o = { singleHash: false }
  const a = T.ruleHeading('##小节标题', o)
  ok('D9 heading ##小节标题 → 1 hit,level 2', a.length === 1 && a[0].headingLevel === 2)
  eq('D9 heading #今日待办 → 0(当标签放过)', T.ruleHeading('#今日待办', o).length, 0)
  const c = T.ruleHeading('#我的 标题', o)
  ok('D9 heading #我的 标题 → 1 hit,level 1', c.length === 1 && c[0].headingLevel === 1)
  eq('D9 heading # 正常标题 → 0', T.ruleHeading('# 正常标题', o).length, 0)
  eq('D9 heading 正文里的 #标签 → 0(不在行首)', T.ruleHeading('正文里的 #标签', o).length, 0)
  eq('D9 heading #######七级 → 0', T.ruleHeading('#######七级', o).length, 0)
  eq('D24 headingSingleHash=true 时 #今日待办 → 1', T.ruleHeading('#今日待办', { singleHash: true }).length, 1)
  eq('D24 headingSingleHash=false 时 #今日待办 → 0', T.ruleHeading('#今日待办', { singleHash: false }).length, 0)
}
// §5.9 ruleTrailing
{
  eq('D9 trailing 两个空格 + 非空下一行 → 0(硬换行)', T.ruleTrailing('第一行  \n第二行').length, 0)
  eq('D9 trailing 三个空格 → 1 {3,6}', T.ruleTrailing('第一行   \n第二行').map((x) => [x.from, x.to]), [[3, 6]])
  eq('D9 trailing 下一行是空行 → 1 {3,5}', T.ruleTrailing('第一行  \n\n第二行').map((x) => [x.from, x.to]), [[3, 5]])
  eq('D9 trailing 最后一行 → 1 {4,6}', T.ruleTrailing('最后一行  ').map((x) => [x.from, x.to]), [[4, 6]])
  eq('D9 trailing 含 tab → 1 {3,5}', T.ruleTrailing('第一行 \t\n第二行').map((x) => [x.from, x.to]), [[3, 5]])
}
// §5.10 三个小函数
{
  eq('D9 lineColOf 均 1 起', T.lineColOf('a\nbc', 3), { line: 2, col: 2 })
  eq('D9 lineColOf 首字符', T.lineColOf('abc', 0), { line: 1, col: 1 })
  const c = T.contextOf('前面一句\n这是Forsion桌面', 6, 8, 24)
  ok('D9 contextOf 不跨换行', c.before.indexOf('\n') < 0 && c.before === '这' && c.hit === '是F', JSON.stringify(c))
  const c2 = T.contextOf('这是Forsion桌面\n后面一句', 1, 3, 24)
  ok('D9 contextOf 后文也不跨换行', c2.after === 'orsion桌面' && c2.tailEllipsis === false, JSON.stringify(c2))
  const c3 = T.contextOf('x'.repeat(60) + '这是Forsion', 61, 63, 24)
  ok('D9 contextOf 半径外加省略号', c3.headEllipsis === true && c3.before.length === 24, JSON.stringify(c3))
  const hit = T.ruleSpace('这是Forsion桌面')[0]
  ok('D9 contextKey = 规则 + 前 8 字 + 命中原文', T.contextKey('这是Forsion桌面', hit) === 'space 这 是F', T.contextKey('这是Forsion桌面', hit))
}

// ══ 7.D-17 豁免区逐类正反断言 ══════════════════════════════════════════════
const P = '这是Forsion桌面,行尾'
eq('D17 基准:裸 payload 必然 3 处命中', S(P).length, 3)
const exemptCases = [
  ['ⓐ ``` 围栏(闭合)', '```\n' + P + '\n```', '```\n```\n' + P],
  ['ⓑ ~~~ 围栏(闭合)', '~~~\n' + P + '\n~~~', '~~~\n~~~\n' + P],
  ['ⓒ 未闭合 ```(到 EOF)', '```\n' + P, P + '\n```'],
  ['ⓓ ~~~ 里嵌 ```(内层不当围栏)', '~~~\n```\n' + P + '\n```\n~~~', '~~~\n~~~\n```\n```\n' + P],
  ['ⓔ 行内代码', '`' + P + '`', '`x` ' + P],
  ['ⓕ 未闭合行内反引号(到行尾)', '`' + P, '`' + P + '\n' + P],
  ['ⓖ $x$ 行内公式', '$' + P + '$', '$x$ ' + P],
  ['ⓗ $$…$$ 多行公式', '$$\n' + P + '\n$$', '$$\nx\n$$\n' + P],
  ['ⓘ 未闭合 $$', '$$\n' + P, P + '\n$$\nx'],
  ['ⓙ URL', 'https://forsion.app/这是Forsion桌面端', '路径/这是Forsion桌面端'],
  ['ⓛ [[wikilink]]', '[[' + P + ']]', '[[x]] ' + P],
  ['ⓜ HTML 标签', '<span class="' + P + '">', '<span> ' + P],
  ['ⓝ HTML 注释', '<!-- ' + P + ' -->', '<!-- x --> ' + P],
  ['ⓞ 未闭合 <!--', '<!-- ' + P, P + '\n<!-- x'],
  ['ⓟ frontmatter', '---\n' + P + '\n---\n', '---\n---\n' + P],
  ['ⓠ 未闭合 frontmatter', '---\n' + P, P + '\n---\nx'],
]
for (const c of exemptCases) {
  eq('D17 ' + c[0] + ' 豁免区内 0 命中', S(c[1]).length, 0)
  ok('D17 ' + c[0] + ' 反向:豁免区外照常命中', S(c[2]).length > 0, JSON.stringify(S(c[2]).map((h) => h.rule)))
}
{
  // ⓙ 反向:URL 之外的同样文本照常命中
  eq('D17 ⓙ 反向:URL 之外照常命中', S('见 https://x.app/a 这是Forsion桌面端').length, 2)
  // ⓚ [显示](路径):路径豁免、显示不豁免
  const link = '[' + P + '](' + P + ')'
  const hits = S(link)
  eq('D17 ⓚ 链接:显示部分照常命中(3 处)', hits.length, 3)
  ok('D17 ⓚ 链接:路径部分一处不报', hits.every((h) => h.to <= 14), JSON.stringify(hits.map((h) => [h.rule, h.from, h.to])))
}
// D18 沾边就整条丢,不裁剪
{
  const ranges = [{ from: 5, to: 10, kind: 'x' }]
  ok('D18 跨越豁免边界的区间整条判豁免', T.isExempt(ranges, 8, 12) === true && T.isExempt(ranges, 0, 6) === true)
  ok('D18 完全在豁免区外不判豁免', T.isExempt(ranges, 10, 12) === false && T.isExempt(ranges, 0, 5) === false)
  const r2 = T.exemptRanges('`abc` 普通 `de`')
  ok('D18 exemptRanges 结果已排序且互不重叠', r2.every((r, i) => i === 0 || r2[i - 1].to <= r.from))
}
// D23 单块字数上限
{
  const big = '这是Forsion桌面'.repeat(400)
  eq('D23 超上限 → 返回空数组,不抛', S(big, { maxChars: 100 }).length, 0)
  ok('D23 上限内照常命中', S(big, { maxChars: big.length + 1 }).length > 0)
}
// D25 忽略清单生效 / 换上下文不误伤
{
  const text = '这是Forsion桌面'
  const base = S(text)
  const key = T.contextKey(text, base[0])
  const ign = new Set([key])
  eq('D25 忽略后少一条', S(text, { ignored: ign }).length, base.length - 1)
  const other = '另外说一句这是Forsion桌面'
  eq('D25 换一处上下文的同样文本仍然命中', S(other, { ignored: ign }).length, S(other).length)
}

// ══ 7.D-19/20/21/21b/21c PM 改动路径 ══════════════════════════════════════
{
  const full = 'abc这是Forsion桌面def'
  const view = mkTextView(full)
  const plan = { from: 4, to: 6, insert: 'XY', expect: full.slice(4, 6) }
  eq('D19 expect 对得上 → ok', T.applyPlan(view, 0, plan), 'ok')
  eq('D19 dispatch 发了一次', view.dispatched.length, 1)
  const v2 = mkTextView(full)
  eq('D19 expect 对不上 → stale', T.applyPlan(v2, 0, { from: 4, to: 6, insert: 'XY', expect: '不一样' }), 'stale')
  eq('D19 stale 时 dispatch 次数 0', v2.dispatched.length, 0)
  const v3 = mkTextView(full)
  eq('D19 区间越界 → stale', T.applyPlan(v3, 0, { from: 0, to: full.length + 5, insert: '', expect: '' }), 'stale')
  eq('D19 越界时 dispatch 次数 0', v3.dispatched.length, 0)
}
{
  const full = '0123456789abcdefghij'
  const v = mkTextView(full)
  const items = [
    { base: 0, plan: { from: 1, to: 2, insert: 'A', expect: '1' } },
    { base: 0, plan: { from: 5, to: 6, insert: 'B', expect: '不对' } },
    { base: 0, plan: { from: 9, to: 10, insert: 'C', expect: '9' } },
  ]
  eq('D20 三条里第二条 stale → 整批放弃', T.applyPlans(v, items), 'stale')
  eq('D20 一次都没 dispatch(不修一半)', v.dispatched.length, 0)
  const v2 = mkTextView(full)
  const good = [
    { base: 0, plan: { from: 3, to: 4, insert: 'A', expect: '3' } },
    { base: 0, plan: { from: 10, to: 11, insert: 'B', expect: 'a' } },
  ]
  eq('D21 全部通过 → ok', T.applyPlans(v2, good), 'ok')
  eq('D21 只发一个事务(一次 Cmd+Z 全撤销)', v2.dispatched.length, 1)
  const order = v2.dispatched[0].calls.filter((c) => c[0] === 'insertText').map((c) => c[2])
  eq('D21 降序应用:先 10 后 3', order, [10, 3])
}
// D21b putPlan 三分支 + marks 交集
{
  const mkMark = (n) => { const m = { name: n }; m.isInSet = (set) => (set || []).indexOf(m) >= 0; return m }
  const strong = mkMark('strong')
  const mkResolveTr = (before, after) => {
    const tr = mkTr({ resolve: () => ({ nodeBefore: { marks: before }, nodeAfter: { marks: after } }) })
    return tr
  }
  const sch = mkSchema(true)
  const t1 = mkTr({ resolve: () => ({}) })
  T.putPlan(t1, sch, 3, 6, '')
  eq('D21b insert 为空 → 只调 delete', t1.calls.map((c) => c[0]), ['delete'])
  const t2 = mkTr({ resolve: () => ({}) })
  T.putPlan(t2, sch, 3, 6, 'x')
  eq('D21b 区间替换 → 只调 insertText,不调 replaceWith', t2.calls.map((c) => c[0]), ['insertText'])
  schemaTextCalls.length = 0
  const t3 = mkResolveTr([strong], [])
  T.putPlan(t3, sch, 4, 4, ' ')
  eq('D21b 纯插入 → 只调 replaceWith', t3.calls.map((c) => c[0]), ['replaceWith'])
  eq('D21b 一侧有 strong 一侧没有 → marks 交集为空(空格不许被吸进星号里)', schemaTextCalls[0].marks, [])
  schemaTextCalls.length = 0
  const t4 = mkResolveTr([strong], [strong])
  T.putPlan(t4, sch, 4, 4, ' ')
  eq('D21b 两侧都是 strong → 交集是 strong(整段加粗不许被劈成两段)', schemaTextCalls[0].marks.map((m) => m.name), ['strong'])
}
// D21c 标题闸二
{
  const bad = '第一行\n#第二行'
  const hBad = T.ruleHeading(bad, { singleHash: true })
  ok('D21c 段落含硬换行时 ruleHeading 照样报 1 条', hBad.length === 1, JSON.stringify(hBad))
  ok('D21c 但 headingFixable === false(不给一键修)', T.headingFixable(hBad[0], bad) === false)
  const good = '##小节标题'
  const hGood = T.ruleHeading(good, { singleHash: false })
  ok('D21c 单行且 from === 0 → headingFixable === true', T.headingFixable(hGood[0], good) === true)
  const vb = mkTextView(bad)
  eq('D21c 不可修时批量路径改 0 条', T.applyHeadingFixes(vb, [{ base: 0, hit: hBad[0], blockText: bad }]), 0)
  eq('D21c 不可修时 setBlockType 调用次数 0', vb.dispatched.length, 0)
  const vg = mkTextView(good)
  eq('D21c 可修时改 1 条', T.applyHeadingFixes(vg, [{ base: 0, hit: hGood[0], blockText: good }]), 1)
  const calls = vg.dispatched[0].calls.map((c) => c[0])
  eq('D21c 可修时先 delete 再 setBlockType', calls, ['delete', 'setBlockType'])
  const at = vg.dispatched[0].calls.find((c) => c[0] === 'setBlockType')
  eq('D21c setBlockType 的 level = # 的个数', at[4], { level: 2 })
  const vNo = mkTextView(good, mkSchema(false))
  eq('D21c schema 没有 heading(能力闸一)→ 一条都不改', T.applyHeadingFixes(vNo, [{ base: 0, hit: hGood[0], blockText: good }]), 0)
  // [回归 2026-08-21 · 评审 Finding 1] 容器不允许 heading(列表项 content = `paragraph block*`)时,
  //   setBlockType 是**静默跳过**,而同一个 tr 上的 delete 照样生效 —— `- ##重点` 会变成 `- 重点`:
  //   `#` 没了、块没变成标题,插件还报「已修正 1 处」。现在验收不过就整条事务作废。
  const vList = mkTextView(good, mkSchema(true), { allowHeading: false })
  eq('R-F1 容器不允许 heading → 一条都不算修', T.applyHeadingFixes(vList, [{ base: 0, hit: hGood[0], blockText: good }]), 0)
  eq('R-F1 而且整条事务不许 dispatch(那次 delete 会把用户的 # 删掉)', vList.dispatched.length, 0)
}
// D22 空区间不画装饰
{
  deco.inline = 0
  const doc = mkDoc(['abc'])
  const sections = [{ base: 1, hits: [{ rule: 'space', from: 1, to: 1 }, { rule: 'dup', from: 0, to: 2 }] }]
  T.buildDecorations(pm, doc, sections)
  eq('D22 from === to 的空区间不画 inline 装饰', deco.inline, 1)
  eq('D22 画出来那一条是非空的那个', deco.calls[deco.calls.length - 1].slice(0, 2), [1, 3])
}

// ══ 7.C-15 v4 路由自检(四相位页表面 mock) ═════════════════════════════════
{
  let pageCalls = 0
  const guardCounts = { blocks: 0, order: 0 }
  const mkV4 = () => {
    pageCalls++
    const o = { token: 'tok-' + pageCalls, path: 'notes/v4.md', status: 'ready', text: '这是Forsion桌面\n\n第二段是Forsion', model: 'text', fmExtra: '' }
    Object.defineProperty(o, 'blocks', { get() { guardCounts.blocks++; throw new Error('v4 页不许读块字典') }, enumerable: false })
    Object.defineProperty(o, 'order', { get() { guardCounts.order++; throw new Error('v4 页不许读顺序表') }, enumerable: false })
    return o
  }
  const mutators = { insertMarkdown: 0, insertBlockAfter: 0, deleteBlock: 0, setFmExtra: 0, mountBlocks: 0, undo: 0, requestFocus: 0 }
  for (const k of Object.keys(mutators)) ctx.app[k] = () => { mutators[k]++; return null }
  // 相位一:空页
  pageSnapshot = { token: 'tok-0', path: null, status: 'idle', text: '', model: 'text', blocks: {}, order: [], fmExtra: '' }
  activePage = null
  eq('C15 空页 → 报告是 none 模式', T.analyze().mode, 'none')
  // 相位二:v4 页(blocks/order 是抛异常的 getter)
  ctx.app.getPage = mkV4
  activePage = 'notes/v4.md'
  const rep = T.analyze()
  eq('C15 v4 页 → 只读快照模式', rep.mode, 'snapshot')
  eq('C15 全程没碰 blocks / order 那两个 getter', [guardCounts.blocks, guardCounts.order], [0, 0])
  ok('C15 报告内容确实来自 pg.text(盘古之白报出来了)',
    rep.entries.filter((e) => e.rule === 'space').length === 3
      && rep.whole === '这是Forsion桌面\n\n第二段是Forsion',
    JSON.stringify(rep.entries.map((e) => [e.rule, e.from])))
  const md = T.reportMarkdown(rep, 'v4', NOW)
  ok('C15 报告 markdown 里有盘古之白一节', md.indexOf('## 盘古之白') >= 0)
  ok('C15 报告 markdown 标题是钉死中文常量', md.indexOf('# 排版体检:v4') === 0)
  // 相位三:令牌每次自增(不缓存快照)
  const before = pageCalls
  T.analyze()
  ok('C15 每次体检重新取页(令牌自增)', pageCalls > before)
  // 相位四:陈旧令牌 —— 本插件根本不提交任何块写入,一次都不调
  eq('C15 块寻址 API 与 insertMarkdown 调用次数全为 0', Object.keys(mutators).map((k) => mutators[k]), [0, 0, 0, 0, 0, 0, 0])
  for (const k of Object.keys(mutators)) delete ctx.app[k]
  ctx.app.getPage = () => { appCalls.getPage++; return pageSnapshot }
}

// ══ 7.B-10 XSS ════════════════════════════════════════════════════════════
let viewEl = null
let viewDispose = null
{
  const evil = '<img src=x onerror=alert(1)>这是Forsion桌面"><script>alert(2)</script>'
  pageSnapshot = { token: 'tk', path: 'notes/坏文本.md', status: 'ready', text: evil, model: 'text', blocks: {}, order: [], fmExtra: '' }
  activePage = 'notes/坏文本.md'
  const v = reg.views.find((x) => x.id === 'report')
  viewEl = mkEl('div')
  viewDispose = v.mount(viewEl)
  const imgs = findAll(viewEl, (n) => String(n.tag).toLowerCase() === 'img')
  const scripts = findAll(viewEl, (n) => String(n.tag).toLowerCase() === 'script')
  ok('B10 渲染树里没有 img 元素', imgs.length === 0)
  ok('B10 渲染树里没有 script 元素', scripts.length === 0)
  const attrInjected = findAll(viewEl, (n) => n.attrs && Object.keys(n.attrs).some((k) => /^on/i.test(k)))
  ok('B10 没有任何 on* 属性被注入', attrInjected.length === 0)
  const txt = viewEl.textContent
  ok('B10 onerror 处理器原样当文本出现(没被当属性解析)', txt.indexOf('onerror=alert(1)>') >= 0, txt.slice(0, 200))
  ok('B10 script 标签原样当文本出现', txt.indexOf('<script>') >= 0, txt.slice(0, 200))
}

// ══ 7.B-14 双语:切英文重渲 / zh→en→zh 往返 / 不重挂 ══════════════════════
{
  const mount0 = T.mountCountRef()
  const zh1 = viewEl.textContent
  ok('B14 中文界面出现中文规则名', zh1.indexOf('盘古之白') >= 0, zh1.slice(0, 120))
  setLocale('en')
  const en1 = viewEl.textContent
  ok('B14 切英文后界面文案真的变了', en1 !== zh1)
  ok('B14 英文界面出现英文串', en1.indexOf('Pangu spacing') >= 0, en1.slice(0, 160))
  ok('B14 英文界面没有残留的中文规则名', en1.indexOf('盘古之白') < 0)
  setLocale('zh')
  const zh2 = viewEl.textContent
  ok('B14ⓐ zh→en→zh 往返后逐字相同', zh2 === zh1, 'zh1=' + zh1.slice(0, 80) + ' | zh2=' + zh2.slice(0, 80))
  ok('B14ⓑ 切语言不重挂视图(mount 只调了一次)', T.mountCountRef() === mount0, String(T.mountCountRef()) + ' vs ' + String(mount0))
}
// 只读快照模式下:修正按钮全部禁用
{
  const btns = findAll(viewEl, (n) => n.tag === 'button')
  const fixBtns = btns.filter((b) => b.textContent === T.t('btnFix'))
  ok('B14 只读快照下行内「修正」全部禁用', fixBtns.length > 0 && fixBtns.every((b) => b.disabled === true), String(fixBtns.length))
  ok('B14 只读快照徽标画出来了', viewEl.textContent.indexOf(T.t('srcStale')) >= 0)
}

// ══ 7.B-11 数据契约往返 + FIFO 上限 ═══════════════════════════════════════
{
  T.addIgnore('space 这 是F')
  await Promise.resolve()
  await Promise.resolve()
  ok('B11 saveData 写出 version 1 的忽略清单', dataBlob && dataBlob.version === 1 && dataBlob.ignoredTexts.indexOf('space 这 是F') >= 0, JSON.stringify(dataBlob))
  const round = JSON.parse(JSON.stringify(T.ignoreDataObj()))
  ok('B11 忽略清单 JSON 往返字段不丢', round.version === 1 && Array.isArray(round.ignoredTexts) && typeof round.updatedAt === 'number')
  for (let i = 0; i < 520; i++) T.addIgnore('space k' + i + ' x')
  await Promise.resolve()
  const list = T.ignoredListRef()
  ok('B11 忽略清单 500 条上限', list.length === 500, String(list.length))
  ok('B11 FIFO:最旧的被丢掉', list.indexOf('space 这 是F') < 0 && list.indexOf('space k519 x') >= 0)
  ok('B11 淘汰同时把 Set 里的键也删掉', T.ignoredSetRef().has('space 这 是F') === false && T.ignoredSetRef().size === 500)
  // sidecar JSON 序列化 → 解析 → 字段齐全
  const rep = T.analyze()
  const car = JSON.parse(JSON.stringify(T.sidecarObject(rep, NOW)))
  ok('B11 sidecar 字段齐全', car.version === 1 && car.plugin === 'zhtypo' && car.pluginVersion === '1.0.1'
    && typeof car.note === 'string' && car.generatedAt === NOW && car.settings && Array.isArray(car.hits)
    && typeof car._note === 'string', JSON.stringify(Object.keys(car)))
  if (car.hits.length) {
    const h = car.hits[0]
    ok('B11 sidecar 每条命中带 rule/line/col/from/to/sample/context', ['rule', 'line', 'col', 'from', 'to', 'sample', 'context'].every((k) => k in h), JSON.stringify(h))
  }
  ok('B11 sidecar 的 _note 明说 from/to 只作证据', /never/i.test(car._note))
  // 清空忽略清单,免得污染后面的断言
  T.ignoredSetRef().clear()
  T.ignoredListRef().length = 0
}

// ══ 7.D-26/27 + 7.C-16 导出产物 ═══════════════════════════════════════════
const STAMP = T.stampOf(NOW)
{
  V.clear()
  writes.length = 0
  activePage = 'notes/写作稿.md'
  const p1 = '中文排版/排版体检/稿子_' + STAMP + '.md'
  const c1 = '中文排版/排版体检/.稿子_' + STAMP + '.json'
  eq('D26 第一次导出成功', await T.exportReport('稿子', '# A\n', { version: 1 }, NOW), 'ok')
  ok('D26 markdown 与 sidecar 都落盘了', V.get(p1) === '# A\n' && V.has(c1), JSON.stringify([...V.keys()]))
  ok('D26 sidecar 是点开头的隐藏文件', c1.slice(c1.lastIndexOf('/') + 1).charAt(0) === '.')
  eq('D26 第二次同名导出也成功', await T.exportReport('稿子', '# B\n', { version: 1 }, NOW), 'ok')
  ok('D26 第一份内容逐字节不变', V.get(p1) === '# A\n', String(V.get(p1)))
  ok('D26 第二份落到 -2 后缀', V.get('中文排版/排版体检/稿子_' + STAMP + '-2.md') === '# B\n', JSON.stringify([...V.keys()]))
}
{
  // D27 读失败 ≠ 文件不存在
  const wBefore = writes.length
  const nBefore = reg.notices.length
  readFails = true
  eq('D27 readFile 抛错 → readfail', await T.exportReport('读不动', '# X\n', { version: 1 }, NOW), 'readfail')
  readFails = false
  eq('D27 一个字节都没写', writes.length, wBefore)
  const notice = reg.notices.slice(nBefore).find((n) => n.o && n.o.level === 'error')
  ok('D27 发了 error 级 notify', !!notice, JSON.stringify(reg.notices.slice(nBefore)))
  ok('D27 提示文案说清了「已中止导出」', notice && String(notice.m).indexOf('已中止导出') >= 0, notice && notice.m)
  ok('D27 没有留下任何「已导出」的 activity 记录', !reg.activity.slice(-3).some((a) => a.e === 'export' && String(a.d && a.d.path).indexOf('读不动') >= 0))

  // [回归 2026-08-21 · 评审 Finding 3] 宿主的读失败形态是 **return null** 而不是 throw
  //   (真源 electron/amadeus/ipc.ts:981-988)。D27 保的是 throw 那一档 —— 生产宿主上走不到。
  //   这一条保真正会发生的那一档:文件在库里、readFile 给 null ⇒ 读失败 ⇒ 中止,不许无声覆写。
  const keepPath = '中文排版/排版体检/读null_' + STAMP + '.md'
  V.set(keepPath, '# 用户上一次导出的报告\n几百行\n')
  nullReads.add(keepPath)
  const w2 = writes.length
  eq('R-F3 null 形态的读失败同样必须中止导出', await T.exportReport('读null', '# 新报告\n', { version: 1 }, NOW), 'readfail')
  eq('R-F3 一个字节都没写', writes.length, w2)
  ok('R-F3 用户上一次的报告逐字节不变', V.get(keepPath) === '# 用户上一次导出的报告\n几百行\n', String(V.get(keepPath)))
  nullReads.delete(keepPath)
  // 反向:真的不存在时照常导出(别拒过头)
  eq('R-F3 反向:真空位仍照常导出', await T.exportReport('读null2', '# 新报告\n', { version: 1 }, NOW), 'ok')
}
{
  // C16 活动页写保护
  const target = '中文排版/排版体检/正开着_' + STAMP + '.md'
  activePage = target
  const wBefore = writes.length
  const aBefore = reg.activity.length
  const nBefore = reg.notices.length
  eq('C16 路径撞上活动页 → blocked', await T.exportReport('正开着', '# Y\n', { version: 1 }, NOW), 'blocked')
  eq('C16 writeFile 调用次数 0', writes.length, wBefore)
  const warn = reg.notices.slice(nBefore).find((n) => n.o && n.o.level === 'warning')
  ok('C16 发了 warning 级 notify', !!warn, JSON.stringify(reg.notices.slice(nBefore)))
  ok('C16 提示说清了「关掉它再试一次」', warn && String(warn.m).indexOf('关掉它再试一次') >= 0)
  ok('C16 activity 记了 export-blocked', reg.activity.slice(aBefore).some((a) => a.e === 'export-blocked'), JSON.stringify(reg.activity.slice(aBefore)))
  ok('C16 绝不改名悄悄绕过(没有任何 正开着 的产物落盘)', ![...V.keys()].some((k) => k.indexOf('正开着') >= 0), JSON.stringify([...V.keys()]))
  activePage = 'notes/别的.md'
  eq('C16 改回不同路径 → 同一次导出能成功', await T.exportReport('正开着', '# Y\n', { version: 1 }, NOW), 'ok')
  ok('C16 这一次真的落盘了', V.get(target) === '# Y\n')
  // guardWrite 的路径归一:反斜杠 / 首尾斜杠不影响判定
  activePage = '/中文排版/排版体检/正开着_' + STAMP + '.md'
  eq('C16 guardWrite 路径归一(首尾斜杠)', T.guardWrite(target), 'blocked')
  activePage = 'notes/别的.md'
  eq('C16 不相干路径放行', T.guardWrite(target), 'ok')
}
{
  // 产物路径与文件名规则
  eq('导出文件名去目录去后缀', T.noteBaseOf('a/b/我的笔记.md'), '我的笔记')
  eq('导出文件名把非法字符换成 -', T.noteBaseOf('a/b/x:y*z?.md'), 'x-y-z-')
  eq('空文件名钉死中文常量 未命名', T.noteBaseOf(''), '未命名')
  eq('工作文件夹回退中文常量', T.workFolder(), '中文排版')
  eq('stamp 形状 YYYY-MM-DD-HHmm', /^\d{4}-\d{2}-\d{2}-\d{4}$/.test(STAMP), true)
}

// ══ 7.D-28 state.apply 兜底 + 只吼第一声 ══════════════════════════════════
{
  const before = errCount
  const bad = { size: 1, has: () => { throw new Error('boom') } }
  eq('D28 扫描器抛错 → 返回空命中,不向外抛', T.safeScan('这是Forsion桌面', { ignored: bad }).length, 0)
  eq('D28 console.error 吼了第一声', errCount - before, 1)
  T.safeScan('这是Forsion桌面', { ignored: bad })
  eq('D28 第二次同样输入不再吼', errCount - before, 1)
  // state.apply 自带 try/catch:doc 遍历抛错也不许炸出去
  const [decorP] = T.editorFactory(pm)
  const doc = mkDoc(['这是Forsion桌面'])
  const st0 = decorP.spec.state.init({}, { doc })
  const boom = { content: { size: 5 }, descendants() { throw new Error('doc boom') }, textBetween: () => '', resolve: () => ({}) }
  const tr = mkTr(boom)
  tr.docChanged = true
  let threw = false
  let out = null
  try {
    out = decorP.spec.state.apply(tr, st0, { doc }, { doc: boom })
  } catch (e) {
    threw = true
  }
  ok('D28 state.apply 不向外抛', threw === false)
  ok('D28 兜底时保留上一轮结果', out === st0)
  eq('D28 已经吼过就不再吼', errCount - before, 1)
}

// ══ 7.D-29 合成期不介入 ═══════════════════════════════════════════════════
{
  const [decorP] = T.editorFactory(pm)
  const doc = mkDoc(['这是Forsion桌面', '第二段Forsion'])
  const st0 = decorP.spec.state.init({}, { doc })
  ok('D29 初次扫描拿到命中', st0.sections.length === 2 && st0.sections[0].hits.length > 0)
  const state0 = { doc, zh: st0 }
  const d1 = decorP.spec.props.decorations(state0)
  const v = mkView(doc)
  decorP.spec.view(v)
  v.composing = true
  const d2 = decorP.spec.props.decorations(state0)
  ok('D29 合成期 decorations 返回同一个对象引用', d2 === d1)
  // 合成期用户真的在敲字:两段文本都变了
  const doc2 = mkDoc(['这是Forsion桌面吧', '第二段Forsion了'])
  const scansBefore = T.STATS.scans
  const tr = mkTr(doc2)
  tr.docChanged = true
  const st1 = decorP.spec.state.apply(tr, st0, { doc }, { doc: doc2 })
  eq('D29 合成期 apply 一次都没重扫', T.STATS.scans, scansBefore)
  ok('D29 合成期把段落攒进 dirty(只映射不重扫)', st1.dirty.size === 2 && st1.pending === 2, JSON.stringify([st1.dirty.size, st1.pending]))
  // 合成结束后 dirty 会被扫掉
  v.composing = false
  const tr2 = mkTr(doc2)
  tr2.setMeta('zhtypoMeta', { rescan: 'dirty' })
  const st2 = decorP.spec.state.apply(tr2, st1, { doc: doc2 }, { doc: doc2 })
  ok('D29 合成结束后 dirty 清空', st2.dirty.size === 0 && st2.pending === 0, JSON.stringify([st2.dirty.size, st2.pending]))
  ok('D29 重扫后命中回来了', st2.sections[0].hits.length > 0)
  ok('D29 合成期这一轮真的重扫过了(扫描计数涨了)', T.STATS.scans > scansBefore)
  // 非合成期文本没变 → 复用不重扫
  const scans2 = T.STATS.scans
  const tr3 = mkTr(doc2)
  tr3.docChanged = true
  decorP.spec.state.apply(tr3, st2, { doc: doc2 }, { doc: doc2 })
  eq('D29 文本没变的段落只映射不重扫', T.STATS.scans, scans2)
}
// 结构层:code_block 整块跳过 / code mark 等长换空格 / 硬换行 1:1
{
  const cb = mkBlock(['这是Forsion桌面'], 'code_block', { code: true })
  const units = T.collectUnits(mkDoc([cb, '这是Forsion桌面']))
  eq('PM 层 code_block 整块跳过', units.length, 1)
  const codeMark = { type: { name: 'code' } }
  const blk = mkBlock([mkTextNode('看这个'), mkTextNode('a,b', [codeMark]), mkTextNode('这是Forsion')])
  const bt = T.blockTextOf(blk)
  eq('PM 层 code mark 等长换空格(偏移 1:1)', bt.text, '看这个   这是Forsion')
  eq('PM 层 code mark 区间进 extraExempt', bt.extra, [[3, 6]])
  const brBlk = mkBlock([mkTextNode('第一行'), mkLeaf('hard_break', 1), mkTextNode('#第二行')])
  eq('PM 层硬换行映射成 \\n(偏移 1:1)', T.blockTextOf(brBlk).text, '第一行\n#第二行')
  const imgBlk = mkBlock([mkTextNode('这是'), mkLeaf('image', 1), mkTextNode('Forsion')])
  const it = T.blockTextOf(imgBlk).text
  ok('PM 层其它叶子换成对象替换符(不造假命中)', it.length === 10 && T.ruleSpace(it).length === 0, JSON.stringify(it))
}

// ══ 7.D-30 视图注册表销号 ═════════════════════════════════════════════════
{
  for (const v of Array.from(T.liveViews)) T.liveViews.delete(v)
  T.hitCounts.clear()
  const [, trackP] = T.editorFactory(pm)
  const doc = mkDoc(['这是Forsion桌面'])
  const v1 = mkView(doc)
  const v2 = mkView(doc)
  const h1 = trackP.spec.view(v1)
  const h2 = trackP.spec.view(v2)
  eq('D30 两个假 view 都进注册表', T.liveViews.size, 2)
  T.hitCounts.set(v1, 3)
  h1.destroy()
  eq('D30 destroy 其一 → liveViews 只剩 1', T.liveViews.size, 1)
  ok('D30 hitCounts 对应项已删', T.hitCounts.has(v1) === false)
  ok('D30 lastView 不是它就不动', T.lastViewRef() === v2)
  h2.destroy()
  ok('D30 lastView 是它则置 null', T.lastViewRef() === null)
  eq('D30 全部销号后注册表为空', T.liveViews.size, 0)
}

// ══ 7.R-F2 [回归 2026-08-21] 改动范围只许落在「与焦点同一篇」════════════════
// registerEditorExtension 是全局注册,**每个编辑器实例**都会进 liveViews。分屏把两篇笔记
// 同时摆出来时,「一键全修」以前会把用户根本没点的那一篇也改掉,报告也会把两篇缝进同一个
// whole 却只署一个路径(评审 Finding 2)。v4 载体下一篇 = 一个编辑器 → 只认焦点那一个。
{
  for (const v of Array.from(T.liveViews)) T.liveViews.delete(v)
  T.hitCounts.clear()
  const [, trackP] = T.editorFactory(pm)
  const prevSnap = pageSnapshot
  pageSnapshot = { token: 1, path: 'notes/甲文.md', status: 'ready', text: '甲文里的Alpha段落', model: 'text', blocks: {}, order: [], fmExtra: '' }
  const vA = mkView(mkDoc(['甲文里的Alpha段落']))
  const vB = mkView(mkDoc(['乙文里的Beta段落']))
  vA.hasFocus = () => true   // 用户点过甲文
  vB.hasFocus = () => false
  const hA = trackP.spec.view(vA)
  const hB = trackP.spec.view(vB)
  eq('R-F2 两个编辑器都活着', T.liveViews.size, 2)
  eq('R-F2 v4 载体下只取焦点那一个', T.orderedViews().length, 1)
  ok('R-F2 取到的正是焦点那个(甲文)', T.orderedViews()[0] === vA)
  // 谁都没被点过 → 宁可什么都不做,也别猜(fixWholeNote 会提示「请先点一下正文」)
  const prevLast = T.lastViewRef()
  void prevLast
  hA.destroy() // lastView === vA → 置 null
  const hA2 = trackP.spec.view(Object.assign(mkView(mkDoc(['甲文里的Alpha段落'])), { hasFocus: () => false }))
  eq('R-F2 两个都没焦点 → 一个都不改(不许猜)', T.orderedViews().length, 0)
  hA2.destroy(); hB.destroy()
  // v3 标记页:一篇 = 很多个小编辑器,维持全取
  pageSnapshot = { token: 2, path: 'notes/老页.md', status: 'ready', text: 'x', model: 'blocks', blocks: { b1: 'x' }, order: ['b1'], fmExtra: '' }
  const v1 = Object.assign(mkView(mkDoc(['这是Forsion桌面'])), { hasFocus: () => true })
  const v2 = Object.assign(mkView(mkDoc(['这是Forsion桌面'])), { hasFocus: () => false })
  const g1 = trackP.spec.view(v1)
  const g2 = trackP.spec.view(v2)
  eq('R-F2 v3 载体维持全取(一篇本来就是很多个编辑器)', T.orderedViews().length, 2)
  g1.destroy(); g2.destroy()
  pageSnapshot = prevSnap
}

// ══ 7.B-12 旧宿主(07-18 之后的 API 全删) ═════════════════════════════════
{
  const oldReg = { views: [], commands: [], slash: [], settings: [], status: [], editorExts: [] }
  const oldCtx = {
    app: {
      getActivePage: () => null,
      readFile: async () => null,
      writeFile: async () => {},
      notify() {},
    },
    registerView: (v) => oldReg.views.push(v),
    registerCommand: (c) => oldReg.commands.push(c),
    registerSlashItem: (s) => oldReg.slash.push(s),
    registerSetting: (s) => oldReg.settings.push(s),
    registerTheme() {},
    registerPanel() {},
    registerFileType() {},
    registerEmbedRenderer() {},
    registerFileCreator() {},
    registerPropertyType() {},
    openView() {},
    achievements: { registerSeries() {}, track() {} },
  }
  globalThis.__ZHTYPO_TEST__ = {}
  let oldDispose = null
  let threw = null
  try {
    oldDispose = new Function('ctx', src)(oldCtx)
  } catch (e) {
    threw = e
  }
  ok('B12 旧宿主下 setup 不抛', threw === null, String(threw && threw.stack ? threw.stack : threw))
  ok('B12 旧宿主下仍返回 disposer', typeof oldDispose === 'function')
  const OT = globalThis.__ZHTYPO_TEST__
  ok('B12 旧宿主界面回退中文', OT.L() === 'zh' && OT.t('btnFix') === '修正')
  ok('B12 旧宿主状态栏不挂', oldReg.status.length === 0)
  ok('B12 旧宿主没有编辑器扩展接缝时不注册', oldReg.editorExts.length === 0)
  ok('B12 旧宿主 workFolder 回退中文常量', OT.workFolder() === '中文排版')
  ok('B12 旧宿主照旧注册 report 视图与三条命令', oldReg.views.length === 1 && oldReg.commands.length === 3)
  const el = mkEl('div')
  const d = oldReg.views[0].mount(el)
  ok('B12 旧宿主下报告视图挂得起来且有中文空态', el.textContent.indexOf('先在编辑器里打开一篇笔记') >= 0, el.textContent)
  if (typeof d === 'function') d()
  if (typeof oldDispose === 'function') oldDispose()
  globalThis.__ZHTYPO_TEST__ = T
}

// ══ 7.B-8 disposer ════════════════════════════════════════════════════════
{
  if (typeof viewDispose === 'function') viewDispose()
  ok('B8 disposer 是函数', typeof dispose === 'function')
  let threw = null
  try {
    dispose()
  } catch (e) {
    threw = e
  }
  ok('B8 disposer 执行不抛', threw === null, String(threw))
  ok('B8 disposer 执行后定时器全清', pendingTimers.size === 0, String(pendingTimers.size))
  ok('B8 disposer 摘掉了注入的 <style>', document.getElementById('zhtypo-styles') === null || document.getElementById('zhtypo-styles').isConnected === false)
  ok('B8 disposer 退订了语言订阅', localeSubs.size === 0, String(localeSubs.size))
}

console.error = realErr
console.log('')
console.log(passed + '/' + (passed + failed) + ' 通过')
if (failed) {
  console.log('失败 ' + failed + ' 项')
  process.exit(1)
}
