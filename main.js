/**
 * 中文排版 zhtypo —— Forsion 桌面插件(裸 setup(ctx) 体,宿主 new Function('ctx', code) 装载)。
 *
 * 一支荧光笔,不是自动修改器:中英之间该有的空格、全角半角混用的标点、重复词、标题 # 后缺的空格,
 * 在打字的当下就在行内画波浪线;点一下弹小浮层,「修正 / 忽略这一处 / 关掉这条规则」三个按钮。
 * 默认永远只画线,一个字都不动 —— 改动一律由用户点出来,并且都进笔记自己的撤销栈。
 *
 * 数据流向:纯本地规则匹配,不联网、不调 AI、不枚举全库,你的文字不出这台机器。
 * 写保护:对笔记内容的全部改动走 ProseMirror 事务(坐在编辑器权威状态上,没有「读快照→整篇写回」
 *         那个 800ms 陈旧窗口);唯一会写进笔记库的文件是用户主动点「导出报告」时的两份产物,
 *         同名绝不覆写,且路径撞上活动页时拒绝导出(guardWrite)。
 * 安全:一切用户文本进 DOM 只走 createElement + textContent(全文件不含 HTML 字符串注入面)。
 * 兼容:07-18 之后的 ctx 面一律可选链;没有编辑器扩展接缝的旧宿主会明确提示,只留只读报告。
 * 双语:MSG.zh / MSG.en 两侧键集合相等;subscribeLocale 触发就地重画(视图不重挂)。
 *      会落盘的默认名(中文排版 / 排版体检 / 未命名)一律钉死中文常量,不取 t()。
 * 时间:「现在」一律 Date.now();全文件无周期定时器(轮询一律 setTimeout 自排程)。
 */
const PLUGIN_ID = 'zhtypo'
const PLUGIN_VERSION = '1.0.2'
const STYLE_ID = 'zhtypo-styles'
const LAYER_CLASS = 'zhtypo-layer'
// 会落盘的中文常量:英文界面下建出来的文件名必须与中文界面逐字相同。
const WF_FALLBACK = '中文排版'
const REPORT_DIR = '排版体检'
const UNTITLED = '未命名'
// 初次全量扫描的预算(超预算的段落进 pending,由 idle 循环续扫)。
const INIT_BUDGET_MS = 12
const INIT_MAX_BLOCKS = 400
const BATCH_MAX = 60
const STATUS_THROTTLE_MS = 300
const SETTINGS_POLL_MS = 1500
const IGNORE_MAX = 500
const OBJ_CHAR = '￼'

// ── 共用常量(钉死) ────────────────────────────────────────────────────────
// pangu.js 的 CJK 口径(**刻意不含** 中日韩标点块 —— 。、「」和英文之间不加空格)。
const CJK_CLASS = '\\u2e80-\\u2eff\\u2f00-\\u2fdf\\u3040-\\u309f\\u30a0-\\u30fa\\u30fc-\\u30ff'
  + '\\u3100-\\u312f\\u3200-\\u32ff\\u3400-\\u4dbf\\u4e00-\\u9fff\\uf900-\\ufaff'
const RE_CJK = new RegExp('[' + CJK_CLASS + ']')
// 宽类:**只给 rulePunct 判「前一个字是不是中文」**。多含中日韩标点(。、」)与全角形,
// 否则「他说「你好」,她说…」里那个半角逗号前面是 」,窄类不认,漏报。
const RE_CJK_CTX = new RegExp('[' + CJK_CLASS + '\\u3000-\\u303f\\uff00-\\uffef]')
const ANS = /[A-Za-z0-9]/
const PUNCT_H2F = { ',': '，', '.': '。', '!': '！', '?': '？', ':': '：', ';': '；' }
const PUNCT_F2H = { '，': ',', '。': '.', '！': '!', '？': '?', '：': ':', '；': ';' }
// 白名单,不是「相邻同字」通则 —— 中文合法叠词太多(看看、慢慢、常常、渐渐、星星、妈妈…),
// 通则等于制造几百个误报。名单只增不删,加词前先自问「这个叠法有没有合法用法」。
const DUP_WORDS = ['的的', '了了', '是是', '在在', '和和', '或或', '把把', '被被', '与与', '而而', '就就', '都都']
const RULE_ORDER = ['space', 'punct', 'quote', 'dup', 'heading', 'trailing']
// 报告 markdown 里的分组名:会落盘 → 钉死中文,不取 t()。
const RULE_LABEL_ZH = {
  space: '盘古之白', punct: '标点混用', quote: '引号不一致',
  dup: '重复词', heading: '标题缺空格', trailing: '行尾空格',
}
const DEFAULTS = {
  ruleSpace: true, rulePunct: true, ruleQuote: true, ruleDup: true, ruleHeading: true, ruleTrailing: true,
  headingSingleHash: false, maxBlockChars: 20000,
}

// ── 中英双语词表(zh / en 两侧键集合必须完全相等,check.mjs 有断言) ──────────
// 翻的只有界面文案。**用户数据与一切路径绝不随语言变**:工作文件夹「中文排版」、子夹「排版体检」、
// 兜底名「未命名」、报告 markdown 的分组标题、localStorage 键 —— 路径跟着语言走 = 同一个库冒出两套。
// 占位符一律 {name} 形式,替换必须**单趟**正则(逐个 split/join 会把先替进去的值再吃一遍)。
const MSG = {
  zh: {
    title: '中文排版',
    group: '插件',
    viewTitle: '排版体检',
    slashLabel: '中文排版体检',
    slashHint: '扫一遍当前笔记的排版问题',
    cmdOpen: '中文排版:打开体检报告',
    cmdCheck: '中文排版:修当前段落',
    cmdFixNote: '中文排版:体检当前笔记',
    statusTitle: '中文排版体检',
    statusClean: '排版 ✓',
    statusHits: '排版 {n}',
    ruleSpace: '盘古之白',
    rulePunct: '标点混用',
    ruleQuote: '引号不一致',
    ruleDup: '重复词',
    ruleHeading: '标题缺空格',
    ruleTrailing: '行尾空格',
    msgSpace: '中英文之间建议加一个空格',
    msgPunctH2F: '中文句子里用了半角标点',
    msgPunctF2H: '英文句子里用了全角标点',
    msgQuote: '这一篇里两种引号混用了',
    msgDup: '这里有一个重复的词',
    msgHeading: '标题的 # 后面缺一个空格',
    msgTrailing: '行尾有多余的空格',
    setSpace: '盘古之白(中英之间加空格)',
    setPunct: '标点混用(半角/全角)',
    setQuote: '引号不一致(只提示,不自动改)',
    setDup: '重复词(的的、是是…)',
    setHeading: '标题 # 后缺空格',
    setTrailing: '行尾多余空格',
    setSingleHash: '单个 # 且行内无空格也当标题',
    setSingleHashDesc: '打开后「#今日待办」这类会被当成缺空格的标题;它和标签长得一模一样,默认关闭',
    setMaxChars: '单段字数上限',
    setMaxCharsDesc: '超过这个字数的段落跳过不检查,免得长文打字掉帧',
    setWorkFolder: '工作文件夹',
    setWorkFolderDesc: '导出的体检报告落在 <工作文件夹>/排版体检/ 里;子文件夹名固定,不随界面语言变',
    btnFix: '修正',
    btnIgnore: '忽略这一处',
    btnDisableRule: '关闭这条规则',
    btnRecheck: '重新体检',
    btnFixAll: '一键全修',
    btnExport: '导出报告',
    srcLive: '实时',
    srcStale: '只读快照(≤0.8 秒前)',
    emptyClean: '这篇没查出排版问题',
    emptyNoNote: '先在编辑器里打开一篇笔记',
    needEditor: '请先把光标放进一篇笔记',
    notInText: '光标不在正文段落里',
    stale: '文档已变化,已重新体检',
    nothingToFix: '这里没有可自动修正的问题',
    errReadListed: '这份文件在库里,但这一刻读不回来',
    fixedN: '已修正 {n} 处',
    hitsSummary: '命中 {n} 处 · 可自动修正 {m} 处',
    exportOk: '体检报告已保存到 {path}',
    exportReadFail: '读取失败,已中止导出,未改动任何文件',
    exportTooMany: '同一分钟内已导出 9 份,请稍后再试',
    exportPartial: '报告已保存,机器数据未能写入',
    reportIsActive: '这份报告正在编辑器里打开着,已取消导出。关掉它再试一次。',
    needNewerHost: '当前 Forsion 版本没有编辑器扩展接缝,行内波浪线不可用;体检报告仍可只读使用。',
    headingNoFix: '这一段里还有别的行,标题要自己断行之后再改',
    oversizeBlock: '有 {n} 个超长段落已跳过检查',
    lineCol: '第 {line} 行第 {col} 列',
    listSep: '、',
  },
  en: {
    title: 'zhtypo',
    group: 'Plugins',
    viewTitle: 'Typography Report',
    slashLabel: 'Chinese typography check',
    slashHint: 'Scan this note for typography issues',
    cmdOpen: 'zhtypo: Open report',
    cmdCheck: 'zhtypo: Fix current paragraph',
    cmdFixNote: 'zhtypo: Check this note',
    statusTitle: 'Chinese typography check',
    statusClean: 'Typo ✓',
    statusHits: 'Typo {n}',
    ruleSpace: 'Pangu spacing',
    rulePunct: 'Mixed punctuation',
    ruleQuote: 'Inconsistent quotes',
    ruleDup: 'Repeated word',
    ruleHeading: 'Heading needs a space',
    ruleTrailing: 'Trailing spaces',
    msgSpace: 'Add a space between Chinese and Latin text',
    msgPunctH2F: 'Half-width punctuation inside a Chinese sentence',
    msgPunctF2H: 'Full-width punctuation inside a Latin sentence',
    msgQuote: 'This note mixes two styles of quotation marks',
    msgDup: 'A word is repeated here',
    msgHeading: 'A heading needs a space after #',
    msgTrailing: 'Trailing whitespace at end of line',
    setSpace: 'Pangu spacing (space between Chinese and Latin)',
    setPunct: 'Mixed punctuation (half / full width)',
    setQuote: 'Inconsistent quotes (flagged only, never auto-fixed)',
    setDup: 'Repeated words',
    setHeading: 'Missing space after #',
    setTrailing: 'Trailing whitespace',
    setSingleHash: 'Treat a lone # without spaces as a heading',
    setSingleHashDesc: 'When on, lines like "#todo" are reported as headings missing a space. They look exactly like tags, so this is off by default.',
    setMaxChars: 'Max characters per paragraph',
    setMaxCharsDesc: 'Paragraphs longer than this are skipped, so typing in long notes stays smooth.',
    setWorkFolder: 'Work folder',
    setWorkFolderDesc: 'Exported reports land in <work folder>/排版体检/. The subfolder name is fixed and does not follow the interface language.',
    btnFix: 'Fix',
    btnIgnore: 'Ignore this one',
    btnDisableRule: 'Turn this rule off',
    btnRecheck: 'Re-check',
    btnFixAll: 'Fix all',
    btnExport: 'Export report',
    srcLive: 'live',
    srcStale: 'read-only snapshot (up to 0.8s old)',
    emptyClean: 'No typography issues found in this note',
    emptyNoNote: 'Open a note in the editor first',
    needEditor: 'Put the caret inside a note first',
    notInText: 'The caret is not inside a text paragraph',
    stale: 'The document changed, so it was checked again',
    nothingToFix: 'Nothing here can be fixed automatically',
    errReadListed: 'The file is in the vault but cannot be read right now',
    fixedN: 'Fixed {n} issue(s)',
    hitsSummary: '{n} issue(s) · {m} fixable automatically',
    exportOk: 'Report saved to {path}',
    exportReadFail: 'Could not read the target file, so the export was cancelled. Nothing was written.',
    exportTooMany: 'Nine reports already exported within this minute — try again shortly.',
    exportPartial: 'The report was saved, but the machine-readable sidecar could not be written.',
    reportIsActive: 'That report is open in the editor right now, so the export was cancelled. Close it and try again.',
    needNewerHost: 'This Forsion build has no editor-extension seam, so inline squiggles are unavailable. The read-only report still works.',
    headingNoFix: 'This paragraph holds more than one line — split it yourself before turning it into a heading',
    oversizeBlock: '{n} oversized paragraph(s) were skipped',
    lineCol: 'line {line}, col {col}',
    listSep: ', ',
  },
}

const L = () => (ctx.getLocale ? ctx.getLocale() : 'zh')
function t(k, vars) {
  const d = MSG[L()] || MSG.zh
  const s = d[k] != null ? d[k] : (MSG.zh[k] != null ? MSG.zh[k] : k)
  if (!vars) return s
  // ⚠️必须单趟正则:逐个 split/join 会让先替进去的值被后面的轮次再吃一遍。
  return s.replace(/\{(\w+)\}/g, (m, key) => (key in vars ? String(vars[key]) : m))
}

// ── 设置读取(宿主写 localStorage plugin.zhtypo.<key>,用时现读,没有变更通知) ──
function rawSetting(key) {
  try {
    return localStorage.getItem('plugin.' + PLUGIN_ID + '.' + key)
  } catch (e) {
    return null
  }
}
function getBool(key, dflt) {
  const v = rawSetting(key)
  if (v == null || v === '') return dflt
  if (v === 'true' || v === '1') return true
  if (v === 'false' || v === '0') return false
  return dflt
}
function getNum(key, dflt, min, max) {
  const v = Number(rawSetting(key))
  if (!Number.isFinite(v)) return dflt
  return Math.min(max, Math.max(min, Math.round(v)))
}
function workFolder() {
  const f = ctx.app && ctx.app.workFolder ? ctx.app.workFolder() : ''
  return f || WF_FALLBACK
}

// ══ 纯函数(经文末 __ZHTYPO_TEST__ 暴露给 check.mjs;只吃字符串、吐普通对象) ══

function lineBounds(text) {
  const out = []
  let start = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      out.push({ start, end: i })
      start = i + 1
    }
  }
  out.push({ start, end: text.length })
  return out
}
function lineOf(lines, offset) {
  let lo = 0
  let hi = lines.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (lines[mid].start <= offset) lo = mid
    else hi = mid - 1
  }
  return lines[lo]
}

/** 均 1 起。lineColOf('a\nbc', 3) → {line:2, col:2} */
function lineColOf(text, offset) {
  const off = Math.max(0, Math.min(Number(offset) || 0, text.length))
  let line = 1
  let last = 0
  for (let i = 0; i < off; i++) {
    if (text[i] === '\n') {
      line++
      last = i + 1
    }
  }
  return { line, col: off - last + 1 }
}

/** 上下文切片不跨 \n(遇换行就停,省得糊成一坨)。 */
function contextOf(text, from, to, radius) {
  const r = typeof radius === 'number' ? radius : 24
  let s = from
  let steps = 0
  while (s > 0 && steps < r && text[s - 1] !== '\n') {
    s--
    steps++
  }
  const headEllipsis = s > 0 && text[s - 1] !== '\n'
  let e = to
  steps = 0
  while (e < text.length && steps < r && text[e] !== '\n') {
    e++
    steps++
  }
  const tailEllipsis = e < text.length && text[e] !== '\n'
  return {
    before: text.slice(s, from),
    hit: text.slice(from, to),
    after: text.slice(to, e),
    headEllipsis,
    tailEllipsis,
  }
}

/** 忽略清单的键:规则 + 前 8 个字 + 命中原文。比裸 sample 精确,又不至于换个位置就失效。 */
function contextKey(text, hit) {
  const c = contextOf(text, hit.from, hit.to, 8)
  return hit.rule + ' ' + c.before + ' ' + hit.sample
}

function mergeRanges(list) {
  const arr = list.filter((r) => r && r.to > r.from).slice().sort((a, b) => (a.from - b.from) || (a.to - b.to))
  const out = []
  for (const r of arr) {
    const last = out.length ? out[out.length - 1] : null
    if (last && r.from <= last.to) {
      if (r.to > last.to) last.to = r.to
    } else {
      out.push({ from: r.from, to: r.to, kind: r.kind || 'x' })
    }
  }
  return out
}

/**
 * 豁免区 —— 本插件的正确性核心。返回已排序、已合并、互不重叠的区间。
 * 计算顺序钉死(先算的赢):frontmatter → fence → 其余只在非 fence/非 frontmatter 区里算。
 * kind 只是调试字段:**任何 kind 的效力完全相同 —— 一个字都不许提示、不许改。**
 */
function exemptRanges(text) {
  const len = text.length
  const out = []
  const lines = lineBounds(text)
  const contentOf = (i) => text.slice(lines[i].start, lines[i].end)
  const lineEndWithNl = (i) => (i + 1 < lines.length ? lines[i + 1].start : len)

  // 1. frontmatter:仅当 text 以 '---\n' 开头
  let firstBody = 0
  if (text.startsWith('---\n')) {
    let close = -1
    for (let i = 1; i < lines.length; i++) {
      const c = contentOf(i).replace(/[ \t]+$/, '')
      if (c === '---' || c === '...') {
        close = i
        break
      }
    }
    const to = close < 0 ? len : lineEndWithNl(close)
    out.push({ from: 0, to, kind: 'frontmatter' })
    firstBody = close < 0 ? lines.length : close + 1
  }

  // 2. fence:逐行开栅/闭栅。栅内的另一种栅字符只是内容。未闭合 → 到 EOF。
  let i = firstBody
  while (i < lines.length) {
    const c = contentOf(i)
    const m = /^ {0,3}(`{3,}|~{3,})/.exec(c)
    if (!m) {
      i++
      continue
    }
    const ch = m[1].charAt(0)
    const n = m[1].length
    const from = lines[i].start
    const closer = new RegExp('^ {0,3}[' + ch + ']{' + n + ',}[ \\t]*$')
    let j = i + 1
    let to = len
    let closed = false
    for (; j < lines.length; j++) {
      if (closer.test(contentOf(j))) {
        to = lineEndWithNl(j)
        closed = true
        break
      }
    }
    out.push({ from, to, kind: 'fence' })
    i = closed ? j + 1 : lines.length
  }

  // 3. 其余规则只在**非 fence、非 frontmatter** 的段里算
  const blocked = mergeRanges(out.slice())
  const segs = []
  let cur = 0
  for (const b of blocked) {
    if (b.from > cur) segs.push([cur, b.from])
    cur = Math.max(cur, b.to)
  }
  if (cur < len) segs.push([cur, len])

  for (const seg of segs) {
    const s = seg[0]
    const e = seg[1]
    const sub = text.slice(s, e)
    scanSegment(sub, s, e, out)
  }
  return mergeRanges(out)
}

function scanSegment(sub, s, e, out) {
  // htmlComment(未闭合 → 到段尾)
  let idx = 0
  for (;;) {
    const p = sub.indexOf('<!--', idx)
    if (p < 0) break
    const q = sub.indexOf('-->', p + 4)
    if (q < 0) {
      out.push({ from: s + p, to: e, kind: 'htmlComment' })
      break
    }
    out.push({ from: s + p, to: s + q + 3, kind: 'htmlComment' })
    idx = q + 3
  }
  // mathBlock $$…$$(未闭合 → 到段尾)
  idx = 0
  for (;;) {
    const p = sub.indexOf('$$', idx)
    if (p < 0) break
    const q = sub.indexOf('$$', p + 2)
    if (q < 0) {
      out.push({ from: s + p, to: e, kind: 'mathBlock' })
      break
    }
    out.push({ from: s + p, to: s + q + 2, kind: 'mathBlock' })
    idx = q + 2
  }
  // 行内代码:反引号跑,同一行内找同长度闭合跑;找不到 → 豁免到行尾
  const subLines = lineBounds(sub)
  for (const ln of subLines) {
    let k = ln.start
    while (k < ln.end) {
      if (sub.charAt(k) !== '`') {
        k++
        continue
      }
      let n = 0
      while (k + n < ln.end && sub.charAt(k + n) === '`') n++
      let j = k + n
      let found = -1
      while (j < ln.end) {
        if (sub.charAt(j) === '`') {
          let m2 = 0
          while (j + m2 < ln.end && sub.charAt(j + m2) === '`') m2++
          if (m2 === n) {
            found = j
            break
          }
          j += m2
        } else {
          j++
        }
      }
      if (found >= 0) {
        out.push({ from: s + k, to: s + found + n, kind: 'code' })
        k = found + n
      } else {
        out.push({ from: s + k, to: s + ln.end, kind: 'code' })
        k = ln.end
      }
    }
  }
  pushMatches(sub, s, out, /(?<![\\$])\$(?!\s)[^\n$]+?(?<!\s)\$(?!\$)/g, 'mathInline')
  pushMatches(sub, s, out, /\[\[[^\]\n]*\]\]/g, 'wikilink')
  pushMatches(sub, s, out, /\]\(([^)\n]*)\)/g, 'linkTarget')
  pushMatches(sub, s, out, /[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s<>()[\]{}「」『』“”‘’,。;:!?、]+/g, 'url')
  pushMatches(sub, s, out, /<\/?[A-Za-z][^>\n]*>/g, 'htmlTag')
}
function pushMatches(sub, base, out, re, kind) {
  re.lastIndex = 0
  let m = re.exec(sub)
  while (m) {
    if (m[0].length > 0) out.push({ from: base + m.index, to: base + m.index + m[0].length, kind })
    if (re.lastIndex === m.index) re.lastIndex++
    m = re.exec(sub)
  }
}

/** 区间有任何重叠即豁免。**沾上一点就整条丢掉,不做裁剪**(裁剪出来的半截 hit 会给出错误的修法)。 */
function isExempt(ranges, from, to) {
  if (!ranges || !ranges.length) return false
  let lo = 0
  let hi = ranges.length - 1
  let start = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (ranges[mid].to <= from) {
      lo = mid + 1
      start = lo
    } else {
      hi = mid - 1
    }
  }
  for (let i = start; i < ranges.length; i++) {
    const r = ranges[i]
    if (r.from >= to) break
    if (r.from < to && r.to > from) return true
  }
  return false
}

function mkHit(rule, from, to, text, msgKey, fix) {
  return { rule, from, to, sample: text.slice(from, to), msgKey, fix }
}
function sortHits(hits) {
  return hits
    .map((h, i) => ({ h, i }))
    .sort((a, b) => (a.h.from - b.h.from) || (RULE_ORDER.indexOf(a.h.rule) - RULE_ORDER.indexOf(b.h.rule)) || (a.i - b.i))
    .map((x) => x.h)
}

/** 盘古之白:CJK↔[A-Za-z0-9] 相邻且中间无空格 → 纯插入一个空格。 */
function ruleSpace(text) {
  const out = []
  for (let i = 0; i + 1 < text.length; i++) {
    const a = text.charAt(i)
    const b = text.charAt(i + 1)
    const need = (RE_CJK.test(a) && ANS.test(b)) || (ANS.test(a) && RE_CJK.test(b))
    if (!need) continue
    out.push(mkHit('space', i, i + 2, text, 'msgSpace', { from: i + 1, to: i + 1, insert: ' ', expect: '' }))
  }
  return out
}

/**
 * 标点混用。方向 A:中文句子里的半角(前一个字用**宽类**判);
 * 方向 B:英文句子里的全角(「本行是不是中文句子」必须用**窄类** —— ，自己在全角块里,
 * 拿宽类去测会把它自己测进去,规则恒不触发)。
 */
function rulePunct(text) {
  const out = []
  const lines = lineBounds(text)
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i)
    if (PUNCT_H2F[c]) {
      const prev = i > 0 ? text.charAt(i - 1) : ''
      if (!prev || !RE_CJK_CTX.test(prev)) continue
      if (c === '.') {
        // `.` 的额外闸:给 笔记.md / v1.2 这类留活路
        const next = i + 1 < text.length ? text.charAt(i + 1) : ''
        const okDot = !next || /\s/.test(next) || RE_CJK_CTX.test(next)
        if (!okDot) continue
      }
      out.push(mkHit('punct', i, i + 1, text, 'msgPunctH2F', { from: i, to: i + 1, insert: PUNCT_H2F[c], expect: c }))
      continue
    }
    if (PUNCT_F2H[c]) {
      const ln = lineOf(lines, i)
      if (RE_CJK.test(text.slice(ln.start, ln.end))) continue
      out.push(mkHit('punct', i, i + 1, text, 'msgPunctF2H', { from: i, to: i + 1, insert: PUNCT_F2H[c], expect: c }))
    }
  }
  return out
}

function quotePositions(text) {
  const corner = []
  const curly = []
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i)
    if (c === '「' || c === '」') corner.push(i)
    else if (c === '“' || c === '”') curly.push(i)
  }
  return { corner, curly }
}
function quoteStats(text) {
  const p = quotePositions(text)
  return { corner: p.corner.length, curly: p.curly.length }
}
/** 少数派那一族(相等时取 curly)每个字符一条;**fix 恒 null:只提示,不自动改**。 */
function ruleQuote(text, stats) {
  if (!stats || !(stats.corner > 0 && stats.curly > 0)) return []
  const fam = stats.curly <= stats.corner ? 'curly' : 'corner'
  const p = quotePositions(text)
  return p[fam].map((i) => mkHit('quote', i, i + 1, text, 'msgQuote', null))
}

function ruleDup(text) {
  const out = []
  for (const w of DUP_WORDS) {
    let i = text.indexOf(w)
    while (i >= 0) {
      out.push(mkHit('dup', i, i + 2, text, 'msgDup', { from: i + 1, to: i + 2, insert: '', expect: w.charAt(1) }))
      i = text.indexOf(w, i + 2)
    }
  }
  return out
}

function ruleHeading(text, opts) {
  const singleHash = !!(opts && opts.singleHash)
  const out = []
  for (const ln of lineBounds(text)) {
    const s = text.slice(ln.start, ln.end)
    const m = /^(#{1,6})([^\s#])/.exec(s)
    if (!m) continue
    const n = m[1].length
    if (n === 1 && !singleHash && !/\s/.test(s.slice(1))) continue
    const h = mkHit('heading', ln.start, ln.start + n + 1, text, 'msgHeading', {
      from: ln.start, to: ln.start + n, insert: '', expect: '#'.repeat(n),
    })
    h.headingLevel = n
    out.push(h)
  }
  return out
}

function ruleTrailing(text) {
  const out = []
  const lines = lineBounds(text)
  for (let li = 0; li < lines.length; li++) {
    const ln = lines[li]
    const s = text.slice(ln.start, ln.end)
    const m = /[ \t]+$/.exec(s)
    if (!m) continue
    const run = m[0]
    const runStart = ln.start + m.index
    const runEnd = ln.start + s.length
    const isLast = li === lines.length - 1
    if (run === '  ' && !isLast) {
      const nx = text.slice(lines[li + 1].start, lines[li + 1].end)
      if (nx.trim().length > 0) continue // markdown 硬换行,放过
    }
    out.push(mkHit('trailing', runStart, runEnd, text, 'msgTrailing', { from: runStart, to: runEnd, insert: '', expect: run }))
  }
  return out
}

function collectHits(text, ranges, opts, stats) {
  const r = opts.rules || {}
  let hits = []
  if (r.space !== false) hits = hits.concat(ruleSpace(text))
  if (r.punct !== false) hits = hits.concat(rulePunct(text))
  if (r.dup !== false) hits = hits.concat(ruleDup(text))
  if (r.heading !== false) hits = hits.concat(ruleHeading(text, { singleHash: !!opts.headingSingleHash }))
  if (r.trailing !== false) hits = hits.concat(ruleTrailing(text))
  if (stats && r.quote !== false) hits = hits.concat(ruleQuote(text, stats))
  hits = hits.filter((h) => h.to > h.from && !isExempt(ranges, h.from, h.to))
  const ign = opts.ignored
  if (ign && ign.size) hits = hits.filter((h) => !ign.has(contextKey(text, h)))
  return sortHits(hits)
}

/** 永远返回新数组,永不改入参。 */
function scanText(text, opts) {
  const o = opts || {}
  const maxChars = typeof o.maxChars === 'number' ? o.maxChars : DEFAULTS.maxBlockChars
  if (typeof text !== 'string' || text.length > maxChars) return []
  const extra = (o.extraExempt || []).map((r) => ({ from: r[0], to: r[1], kind: 'struct' }))
  const ranges = mergeRanges(exemptRanges(text).concat(extra))
  return collectHits(text, ranges, {
    rules: o.rules || {},
    headingSingleHash: !!o.headingSingleHash,
    ignored: o.ignored,
  }, o.quoteStats || null)
}

// 扫描器在 state.apply 里解析任意用户文本;宿主对 state.apply **刻意不包 try/catch**,
// 那里抛一次 = 之后每个事务都在同一处炸 = 编辑器当场废掉。兜底:吞异常、当作没有命中,
// console.error 只吼第一声(scanFailed),下一个事务照常再试。
const STATS = { scans: 0 }
let scanFailed = false
function safeScan(text, opts) {
  try {
    STATS.scans++
    return scanText(text, opts)
  } catch (e) {
    if (!scanFailed) {
      scanFailed = true
      console.error('[zhtypo] 扫描失败,本轮当作无命中', e)
    }
    return []
  }
}

// ══ PM 适配层(唯一的不纯部分;check 不直测的那半归真机门禁) ══════════════

/** 逐字对齐偏移(1:1 是硬要求)。code mark 等长换空格并进 extraExempt;link mark 整段进 extraExempt。 */
function blockTextOf(node) {
  let text = ''
  const extra = []
  node.forEach((child) => {
    const start = text.length
    if (child.isText) {
      const s = child.text || ''
      const marks = child.marks || []
      let isCode = false
      let isLink = false
      for (const mk of marks) {
        const nm = mk && mk.type ? mk.type.name : ''
        if (nm === 'code' || nm === 'inlineCode') isCode = true
        if (nm === 'link' || nm === 'linkText') isLink = true
      }
      if (isCode) {
        text += ' '.repeat(s.length)
        extra.push([start, start + s.length])
      } else {
        text += s
        if (isLink) extra.push([start, start + s.length])
      }
      return
    }
    const nm = child.type && child.type.name ? child.type.name : ''
    const size = child.nodeSize || 1
    if (nm === 'hardbreak' || nm === 'hard_break' || nm === 'break') text += '\n'.repeat(size)
    else text += OBJ_CHAR.repeat(size)
  })
  return { text, extra }
}

/** doc → [{base, text, extra, pos}];code_block 整块跳过。 */
function collectUnits(doc) {
  const out = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    const spec = node.type && node.type.spec ? node.type.spec : {}
    const name = node.type && node.type.name ? node.type.name : ''
    if (spec.code === true || name === 'code_block' || name === 'codeBlock') return false
    const bt = blockTextOf(node)
    out.push({ base: pos + 1, pos, text: bt.text, extra: bt.extra })
    return false
  })
  return out
}

function scanUnit(unit, opts) {
  const text = unit.text
  if (text.length > opts.maxChars) {
    return {
      base: unit.base, pos: unit.pos, text, extra: unit.extra, ranges: [],
      baseHits: [], qpos: { corner: [], curly: [] }, hits: [], stale: false, oversize: true,
    }
  }
  let ranges = []
  let baseHits = []
  let qpos = { corner: [], curly: [] }
  try {
    STATS.scans++
    const extra = (unit.extra || []).map((r) => ({ from: r[0], to: r[1], kind: 'struct' }))
    ranges = mergeRanges(exemptRanges(text).concat(extra))
    baseHits = collectHits(text, ranges, opts, null)
    const p = quotePositions(text)
    qpos = {
      corner: p.corner.filter((i) => !isExempt(ranges, i, i + 1)),
      curly: p.curly.filter((i) => !isExempt(ranges, i, i + 1)),
    }
  } catch (e) {
    if (!scanFailed) {
      scanFailed = true
      console.error('[zhtypo] 扫描失败,本轮当作无命中', e)
    }
    ranges = []
    baseHits = []
    qpos = { corner: [], curly: [] }
  }
  return { base: unit.base, pos: unit.pos, text, extra: unit.extra, ranges, baseHits, qpos, hits: baseHits, stale: false, oversize: false }
}

/** 引号规则要整篇统计 → 逐段存 qpos,这一趟只按总数挑少数派,O(引号数)。 */
function quotePass(sections, opts) {
  const r = opts.rules || {}
  let corner = 0
  let curly = 0
  for (const s of sections) {
    corner += s.qpos.corner.length
    curly += s.qpos.curly.length
  }
  const on = r.quote !== false && corner > 0 && curly > 0
  const fam = curly <= corner ? 'curly' : 'corner'
  for (const s of sections) {
    if (s.stale || s.oversize) continue
    if (!on) {
      s.hits = s.baseHits
      continue
    }
    let add = s.qpos[fam].map((i) => mkHit('quote', i, i + 1, s.text, 'msgQuote', null))
    const ign = opts.ignored
    if (ign && ign.size) add = add.filter((h) => !ign.has(contextKey(s.text, h)))
    s.hits = add.length ? sortHits(s.baseHits.concat(add)) : s.baseHits
  }
  return sections
}

function dirtyOf(sections) {
  const d = new Set()
  for (let i = 0; i < sections.length; i++) if (sections[i].stale) d.add(i)
  return d
}

function buildDecorations(pm, doc, sections) {
  const decos = []
  for (const s of sections) {
    for (const h of s.hits) {
      const a = s.base + h.from
      const z = s.base + h.to
      // ⚠️ from === to 的空区间不画:PM 的 InlineType 要求 from < to,零宽会被静默丢掉。
      if (z <= a) continue
      decos.push(pm.Decoration.inline(a, z, { class: 'zhtypo-hit zhtypo-' + h.rule }))
    }
  }
  return pm.DecorationSet.create(doc, decos)
}

/** 只往 tr 上打,不 dispatch —— 单条与批量共用**同一个**落笔点。 */
function putPlan(tr, schema, a, z, insert) {
  if (!insert) {
    tr.delete(a, z)
    return
  }
  if (a < z) {
    tr.insertText(insert, a, z) // 区间替换:继承区间自己的 marks = 对的
    return
  }
  // ⚠️纯插入(盘古之白那个空格)必须取两侧 marks 的**交集**:
  //   · tr.insertText 会继承左边那个字的 marks → `**粗体**text` 插出来的空格带 strong,
  //     序列化成 `**粗体 **text`,CommonMark 不再认它是强调 —— 往返当场破。
  //   · 一律不带 marks 同样错 → 整段加粗时插一个裸空格,把一段强调劈成两段。
  const $a = tr.doc.resolve(a)
  const before = ($a.nodeBefore && $a.nodeBefore.marks) || []
  const after = ($a.nodeAfter && $a.nodeAfter.marks) || []
  const common = before.filter((m) => m.isInSet(after))
  tr.replaceWith(a, a, schema.text(insert, common))
}

/** 前置校验:装饰上的位置是「上一次扫描那一刻」的。对不上 → 不改、不重试、不猜。 */
function applyPlan(view, base, plan) {
  const a = base + plan.from
  const z = base + plan.to
  if (a < 0 || z > view.state.doc.content.size || z < a) return 'stale'
  if (view.state.doc.textBetween(a, z, '\n', OBJ_CHAR) !== plan.expect) return 'stale'
  const tr = view.state.tr
  putPlan(tr, view.state.schema, a, z, plan.insert)
  view.dispatch(tr)
  return 'ok'
}

/** 批量:先把**全部** plan 对着原始 doc 校验一遍,任一条 stale → **整批放弃**(不修一半)。 */
function applyPlans(view, items) {
  const size = view.state.doc.content.size
  const sorted = items.slice().sort((x, y) => (y.base + y.plan.from) - (x.base + x.plan.from))
  for (const it of sorted) {
    const a = it.base + it.plan.from
    const z = it.base + it.plan.to
    if (a < 0 || z > size || z < a) return 'stale'
    if (view.state.doc.textBetween(a, z, '\n', OBJ_CHAR) !== it.plan.expect) return 'stale'
  }
  if (!sorted.length) return 'empty'
  const tr = view.state.tr
  for (const it of sorted) putPlan(tr, view.state.schema, it.base + it.plan.from, it.base + it.plan.to, it.plan.insert)
  view.dispatch(tr)
  return 'ok'
}

/**
 * 标题修正的**闸二(适用性)**:setBlockType 改的是整个段落,而 ruleHeading 按行首匹配。
 * 段落正文含硬换行时(`第一行\n#第二行`)一键修会把 `第一行` 一起变标题;
 * 反过来 `#标题\n后续正文` 会把后面几行全吸进标题。**两种都是当场改坏用户文档。**
 * 所以:命中照报,但不给一键修,让用户自己去断行。
 */
function headingFixable(hit, blockText) {
  if (!hit || hit.rule !== 'heading') return false
  return hit.from === 0 && String(blockText || '').indexOf('\n') < 0
}
function headingCapable(view) {
  const H = view.state.schema.nodes ? view.state.schema.nodes.heading : null
  return !!H && !!H.spec && !!H.spec.attrs && ('level' in H.spec.attrs)
}
/** items: [{base, hit, blockText}];每段一个独立事务,按位置降序。返回真正改掉的条数。 */
function applyHeadingFixes(view, items) {
  if (!headingCapable(view)) return 0
  const H = view.state.schema.nodes.heading
  const usable = items.filter((it) => headingFixable(it.hit, it.blockText))
  usable.sort((a, b) => b.base - a.base)
  let n = 0
  for (const it of usable) {
    const level = it.hit.headingLevel || 1
    const a = it.base
    const z = it.base + level
    if (z > view.state.doc.content.size) continue
    if (view.state.doc.textBetween(a, z, '\n', OBJ_CHAR) !== '#'.repeat(level)) continue
    const tr = view.state.tr
    tr.delete(a, z)
    // ⚠️位置必须落在段落**内部**(base = pos + 1):setBlockType 走 nodesBetween,
    //   传节点起点 pos 时 `pos < to` 不成立,那个段落根本不会被访问到。
    const at = tr.mapping.map(a)
    tr.setBlockType(at, at, H, { level })
    // ⚠️ setBlockType 对 canChangeType 为 false 的块是**静默跳过**(不抛不报),而上面那次 delete
    //    已经打在同一个 tr 上 —— 列表项的 content 规格是 `paragraph block*`
    //    (宿主 commonmark preset 的 list_item content 规格),第一个子节点恒不许换成 heading。
    //    于是 `- ##重点` 会变成 `- 重点`:`#` 没了、块也没变成标题,插件还报「已修正 1 处」。
    //    delete 与 setBlockType 本来就在同一个 tr 里,验收不过就整条丢掉 = 原子回滚。
    let converted = false
    try { converted = tr.doc.resolve(at).parent.type === H } catch { converted = false }
    if (!converted) continue
    view.dispatch(tr)
    n++
  }
  return n
}

// ══ 忽略清单(ctx.loadData / saveData,不进 localStorage) ══════════════════
let ignoredList = []
let ignoredSet = new Set()
let ignoreLoaded = false
function ignoreDataObj() {
  return { version: 1, ignoredTexts: ignoredList.slice(), updatedAt: Date.now() }
}
const ready = Promise.resolve(ctx.loadData ? ctx.loadData() : null)
  .then((v) => {
    // 坏 JSON / null → 空清单。这是插件自己的偏好,不是用户文件,不违反「读失败 ≠ 不存在」。
    if (v && Array.isArray(v.ignoredTexts)) {
      ignoredList = v.ignoredTexts.filter((x) => typeof x === 'string').slice(-IGNORE_MAX)
      ignoredSet = new Set(ignoredList)
    }
    ignoreLoaded = true
  })
  .catch(() => {
    ignoreLoaded = true
  })

function addIgnore(key) {
  if (!key || ignoredSet.has(key)) return
  ignoredList.push(key)
  ignoredSet.add(key)
  while (ignoredList.length > IGNORE_MAX) {
    const drop = ignoredList.shift()
    ignoredSet.delete(drop)
  }
  bumpGen()
  if (!ctx.saveData) return // 旧宿主:内存里活一次会话,不报错、不藏按钮
  Promise.resolve(ctx.saveData(ignoreDataObj())).catch(() => {
    ctx.notify?.(t('exportPartial'), { level: 'warning', title: t('title') })
  })
}

// ══ 设置轮询 + 版本号(gen 变了 → 全量重扫) ════════════════════════════════
const SETTING_KEYS = ['ruleSpace', 'rulePunct', 'ruleQuote', 'ruleDup', 'ruleHeading', 'ruleTrailing', 'headingSingleHash', 'maxBlockChars', 'workFolder']
let GEN = 1
const timers = new Set()
let disposed = false
function later(fn, ms) {
  const id = setTimeout(() => {
    timers.delete(id)
    if (!disposed) fn()
  }, ms)
  timers.add(id)
  return id
}
function clearTimers() {
  for (const id of Array.from(timers)) clearTimeout(id)
  timers.clear()
}
function currentScanOpts() {
  return {
    rules: {
      space: getBool('ruleSpace', DEFAULTS.ruleSpace),
      punct: getBool('rulePunct', DEFAULTS.rulePunct),
      quote: getBool('ruleQuote', DEFAULTS.ruleQuote),
      dup: getBool('ruleDup', DEFAULTS.ruleDup),
      heading: getBool('ruleHeading', DEFAULTS.ruleHeading),
      trailing: getBool('ruleTrailing', DEFAULTS.ruleTrailing),
    },
    headingSingleHash: getBool('headingSingleHash', DEFAULTS.headingSingleHash),
    maxChars: getNum('maxBlockChars', DEFAULTS.maxBlockChars, 2000, 200000),
    ignored: ignoredSet,
  }
}
function settingSignature() {
  return SETTING_KEYS.map((k) => String(rawSetting(k))).join('') + '' + ignoredList.length
}
let lastSig = settingSignature()
function bumpGen() {
  GEN++
  lastSig = settingSignature()
  for (const v of liveViewList()) {
    try {
      v.dispatch(v.state.tr.setMeta('zhtypoMeta', { gen: GEN }))
    } catch (e) {
      /* 视图正在拆 */
    }
  }
  refreshStatus()
}
function pollSettings() {
  const sig = settingSignature()
  if (sig !== lastSig) {
    lastSig = sig
    bumpGen()
  }
  later(pollSettings, SETTINGS_POLL_MS)
}
later(pollSettings, SETTINGS_POLL_MS)

// ══ 编辑器注册表(工厂外只允许这三个:全部以 view 为键、destroy() 里销号) ══
const liveViews = new Set()
let lastView = null
const hitCounts = new Map()

function liveViewList() {
  return Array.from(liveViews).filter((v) => v && v.dom && v.dom.isConnected)
}
function currentView() {
  return lastView && lastView.dom && lastView.dom.isConnected ? lastView : null
}
/** 把 live views 收敛到**与当前焦点同一篇笔记**的那一组。
 *  `registerEditorExtension` 是全局注册,**每个编辑器实例**都会进 liveViews(types.ts 明写)。
 *  分屏把两篇笔记同时摆出来时,「一键全修」会把用户根本没点的那一篇也改掉,报告也会把两篇
 *  缝进同一个 `whole` 却只署一个路径(评审 Finding 2)。
 *  判据按载体分:
 *   - v4/统一载体(普通笔记的默认形态):**一篇 = 一个编辑器** → 只认焦点那一个。
 *   - v3 标记页:一篇 = 很多个小编辑器 → 维持原样(全取),这一档的跨篇风险记在 README 已知取舍里。 */
function scopedViews() {
  const all = liveViewList()
  if (all.length <= 1) return all
  let model = 'blocks'
  try { const pg = ctx.app.getPage ? ctx.app.getPage() : null; model = (pg && pg.model) || 'blocks' } catch { model = 'blocks' }
  if (model !== 'text') return all
  const cur = currentView()
  return cur ? [cur] : [] // 没有焦点就宁可什么都不做,也别跨篇改
}
function orderedViews() {
  const arr = scopedViews()
  arr.sort((a, b) => {
    try {
      const rel = a.dom.compareDocumentPosition(b.dom)
      if (rel & 4) return -1
      if (rel & 2) return 1
    } catch (e) {
      /* 不可比就保持原序 */
    }
    return 0
  })
  return arr
}

// ══ 编辑器扩展(唯一一次注册,priority 'normal';不实现 handleTextInput/handleKeyDown) ══
function editorFactory(pm) {
  const KEY = new pm.PluginKey('ZHTYPO_DECOR')
  const TKEY = new pm.PluginKey('ZHTYPO_TRACK')
  // per-editor 状态**必须住在工厂调用产生的闭包里**(两个编辑器不许互相覆盖)。
  let viewRef = null
  let lastSet = null
  let lastDoc = null
  let lastSecs = null
  let lastGen = -1
  let idleId = 0

  function fullScan(doc, opts, gen) {
    const raw = collectUnits(doc)
    const sections = []
    const t0 = Date.now()
    let pending = 0
    for (let i = 0; i < raw.length; i++) {
      const over = i >= INIT_MAX_BLOCKS || (Date.now() - t0) > INIT_BUDGET_MS
      if (over) {
        sections.push({
          base: raw[i].base, pos: raw[i].pos, text: raw[i].text, extra: raw[i].extra, ranges: [],
          baseHits: [], qpos: { corner: [], curly: [] }, hits: [], stale: true, oversize: false,
        })
        pending++
      } else {
        sections.push(scanUnit(raw[i], opts))
      }
    }
    quotePass(sections, opts)
    return { sections, dirty: dirtyOf(sections), pending, gen }
  }

  function continueScan(prev, opts, budget) {
    const sections = prev.sections.slice()
    let done = 0
    let pending = 0
    for (let i = 0; i < sections.length; i++) {
      if (!sections[i].stale) continue
      if (done >= budget) {
        pending++
        continue
      }
      sections[i] = scanUnit(sections[i], opts)
      done++
    }
    quotePass(sections, opts)
    return { sections, dirty: dirtyOf(sections), pending, gen: prev.gen }
  }

  function applyDoc(tr, prev, newState, opts) {
    const raw = collectUnits(newState.doc)
    const byBase = new Map()
    for (const sec of prev.sections) {
      let nb = sec.base
      try {
        nb = tr.mapping.map(sec.base)
      } catch (e) {
        nb = sec.base
      }
      if (!byBase.has(nb)) byBase.set(nb, [])
      byBase.get(nb).push(sec)
    }
    const composing = !!(viewRef && viewRef.composing)
    const sections = []
    let pending = 0
    for (const r of raw) {
      const cands = byBase.get(r.base)
      const old = cands && cands.length ? cands.shift() : null
      if (old && old.text === r.text && !old.stale) {
        const reused = Object.assign({}, old, { base: r.base, pos: r.pos, extra: r.extra })
        sections.push(reused)
        continue
      }
      if (composing) {
        // ⚠️合成期绝不介入:只把段落攒进 dirty,一个字都不重扫。
        sections.push({
          base: r.base, pos: r.pos, text: r.text, extra: r.extra,
          ranges: old ? old.ranges : [], baseHits: old ? old.baseHits : [],
          qpos: old ? old.qpos : { corner: [], curly: [] }, hits: old ? old.hits : [],
          stale: true, oversize: false,
        })
        pending++
        continue
      }
      sections.push(scanUnit(r, opts))
    }
    if (!composing) quotePass(sections, opts)
    return { sections, dirty: dirtyOf(sections), pending, gen: prev.gen }
  }

  const decor = new pm.Plugin({
    key: KEY,
    state: {
      init: (config, state) => {
        try {
          return fullScan(state.doc, currentScanOpts(), GEN)
        } catch (e) {
          if (!scanFailed) {
            scanFailed = true
            console.error('[zhtypo] 初次扫描失败', e)
          }
          return { sections: [], dirty: new Set(), pending: 0, gen: GEN }
        }
      },
      // ⚠️宿主对 props.* 包了 try/catch,对 state.apply **刻意不包** —— 这里必须自带。
      apply: (tr, prev, oldState, newState) => {
        try {
          const opts = currentScanOpts()
          const meta = tr.getMeta ? tr.getMeta('zhtypoMeta') : null
          if (meta) {
            if (meta.gen != null) return fullScan(newState.doc, opts, meta.gen)
            if (meta.rescan === 'all') return fullScan(newState.doc, opts, prev.gen)
            if (meta.batch) return continueScan(prev, opts, BATCH_MAX)
            if (meta.rescan === 'dirty') return continueScan(prev, opts, Infinity)
            return prev
          }
          if (!tr.docChanged) return prev
          return applyDoc(tr, prev, newState, opts)
        } catch (e) {
          if (!scanFailed) {
            scanFailed = true
            console.error('[zhtypo] 增量扫描失败,保留上一轮结果', e)
          }
          return prev
        }
      },
    },
    props: {
      decorations: (state) => {
        try {
          const st = KEY.getState(state)
          if (!st) return pm.DecorationSet.empty
          // 合成期返回上一次那份,一帧都不重建
          if (viewRef && viewRef.composing && lastSet) return lastSet
          if (lastSet && lastDoc === state.doc && lastSecs === st.sections && lastGen === st.gen) return lastSet
          lastSet = buildDecorations(pm, state.doc, st.sections)
          lastDoc = state.doc
          lastSecs = st.sections
          lastGen = st.gen
          return lastSet
        } catch (e) {
          return pm.DecorationSet.empty
        }
      },
      // 打开浮层,**然后 return false** —— 光标照常落到点击处,一个交互都不抢。
      handleClick: (view, pos) => {
        try {
          const st = KEY.getState(view.state)
          if (st) {
            for (const s of st.sections) {
              for (const h of s.hits) {
                if (pos >= s.base + h.from && pos <= s.base + h.to) {
                  openPopup(view, s, h)
                  return false
                }
              }
            }
          }
          closePopup()
        } catch (e) {
          /* 浮层不是关键路径 */
        }
        return false
      },
    },
    view: (v) => {
      viewRef = v
      const kick = () => {
        const st = KEY.getState(v.state)
        if (!st) return
        const n = st.sections.reduce((a, s) => a + s.hits.length, 0)
        if (hitCounts.get(v) !== n) {
          hitCounts.set(v, n)
          refreshStatus()
        }
        if (st.pending > 0 && !v.composing && !idleId) {
          idleId = scheduleIdle(() => {
            idleId = 0
            try {
              v.dispatch(v.state.tr.setMeta('zhtypoMeta', { batch: true }))
            } catch (e) {
              /* 视图正在拆 */
            }
          })
        }
        if (st.pending === 0 && st.dirty.size > 0 && !v.composing) {
          try {
            v.dispatch(v.state.tr.setMeta('zhtypoMeta', { rescan: 'dirty' }))
          } catch (e) {
            /* 视图正在拆 */
          }
        }
      }
      kick()
      return {
        update: () => {
          kick()
        },
        destroy: () => {
          if (idleId) cancelIdle(idleId)
          idleId = 0
          viewRef = null
          lastSet = null
          lastDoc = null
          lastSecs = null
          closePopupFor(v)
        },
      }
    },
  })

  const track = new pm.Plugin({
    key: TKEY,
    view: (v) => {
      liveViews.add(v)
      if (v.hasFocus && v.hasFocus()) lastView = v
      const onFocus = () => {
        lastView = v
      }
      v.dom.addEventListener('focus', onFocus, true)
      refreshStatus()
      return {
        destroy: () => {
          v.dom.removeEventListener('focus', onFocus, true)
          liveViews.delete(v)
          hitCounts.delete(v)
          if (lastView === v) lastView = null
          refreshStatus()
        },
      }
    },
  })

  return [decor, track]
}

function scheduleIdle(fn) {
  if (typeof requestIdleCallback === 'function') return { ric: requestIdleCallback(fn) }
  return { to: later(fn, 16) }
}
function cancelIdle(h) {
  if (!h) return
  if (h.ric != null && typeof cancelIdleCallback === 'function') cancelIdleCallback(h.ric)
  if (h.to != null) {
    clearTimeout(h.to)
    timers.delete(h.to)
  }
}

// ══ 浮层(挂插件自己的 .zhtypo-layer,绝不挂裸文档根) ══════════════════════
let popup = null
function closePopup() {
  if (!popup) return
  try {
    if (popup.offDoc) popup.offDoc()
    if (popup.layer && popup.layer.remove) popup.layer.remove()
  } catch (e) {
    /* 已经拆了 */
  }
  popup = null
}
function closePopupFor(view) {
  if (popup && popup.view === view) closePopup()
}
function openPopup(view, section, hit) {
  closePopup()
  if (typeof document === 'undefined' || !document.createElement) return
  const host = (view.dom && view.dom.closest ? view.dom.closest('.am-app') : null) || document.body
  const layer = document.createElement('div')
  layer.className = LAYER_CLASS
  const box = document.createElement('div')
  box.className = 'zhtypo-pop'
  const msg = document.createElement('div')
  msg.className = 'zhtypo-pop-msg'
  msg.textContent = t(hit.msgKey)
  box.appendChild(msg)
  const sample = document.createElement('div')
  sample.className = 'zhtypo-pop-sample'
  sample.textContent = hit.sample
  box.appendChild(sample)
  const row = document.createElement('div')
  row.className = 'zhtypo-pop-row'
  if (hit.fix) {
    const isHeading = hit.rule === 'heading'
    const canFix = !isHeading || (headingFixable(hit, section.text) && headingCapable(view))
    if (canFix) {
      const b = mkButton(t('btnFix'), 'primary', () => {
        closePopup()
        fixSingle(view, section, hit)
      })
      row.appendChild(b)
    } else if (isHeading) {
      const note = document.createElement('div')
      note.className = 'zhtypo-pop-note'
      note.textContent = t('headingNoFix')
      box.appendChild(note)
    }
  }
  row.appendChild(mkButton(t('btnIgnore'), '', () => {
    closePopup()
    addIgnore(contextKey(section.text, hit))
    ctx.activity?.log('ignore', { rule: hit.rule })
  }))
  row.appendChild(mkButton(t('btnDisableRule'), '', () => {
    closePopup()
    disableRule(hit.rule)
  }))
  box.appendChild(row)
  layer.appendChild(box)
  host.appendChild(layer)
  try {
    const c = view.coordsAtPos(section.base + hit.from)
    const w = 260
    const left = Math.max(8, Math.min((c.left || 0), (window.innerWidth || 1280) - w - 8))
    const top = Math.max(8, Math.min((c.bottom || 0) + 6, (window.innerHeight || 800) - 130))
    box.style.left = left + 'px'
    box.style.top = top + 'px'
  } catch (e) {
    box.style.left = '24px'
    box.style.top = '80px'
  }
  const onDocDown = (ev) => {
    let n = ev && ev.target
    while (n) {
      if (n === box) return
      n = n.parentElement
    }
    closePopup()
  }
  const onKey = (ev) => {
    if (ev && ev.key === 'Escape') closePopup()
  }
  const onScroll = () => closePopup()
  document.addEventListener('mousedown', onDocDown, true)
  document.addEventListener('keydown', onKey, true)
  view.dom.addEventListener('scroll', onScroll, true)
  popup = {
    layer,
    view,
    offDoc: () => {
      document.removeEventListener('mousedown', onDocDown, true)
      document.removeEventListener('keydown', onKey, true)
      view.dom.removeEventListener('scroll', onScroll, true)
    },
  }
}
function mkButton(label, cls, onClick) {
  const b = document.createElement('button')
  b.className = 'zhtypo-btn' + (cls ? ' ' + cls : '')
  b.textContent = label
  b.addEventListener('click', onClick)
  return b
}
function disableRule(rule) {
  const key = 'rule' + rule.charAt(0).toUpperCase() + rule.slice(1)
  try {
    localStorage.setItem('plugin.' + PLUGIN_ID + '.' + key, 'false')
  } catch (e) {
    /* 隐私模式 */
  }
  lastSig = settingSignature()
  bumpGen()
  ctx.activity?.log('check', { disabled: rule })
}

// ══ 改动入口(全部走 PM 事务;stale 一律重扫不猜) ══════════════════════════
function rescanAll() {
  for (const v of liveViewList()) {
    try {
      v.dispatch(v.state.tr.setMeta('zhtypoMeta', { rescan: 'all' }))
    } catch (e) {
      /* 视图正在拆 */
    }
  }
  refreshStatus()
}
function onStale() {
  ctx.notify?.(t('stale'), { level: 'warning', title: t('title') })
  rescanAll()
}
function fixSingle(view, section, hit) {
  if (!hit.fix) return
  if (hit.rule === 'heading') {
    const n = applyHeadingFixes(view, [{ base: section.base, hit, blockText: section.text }])
    if (!n) {
      ctx.notify?.(t('headingNoFix'), { level: 'warning', title: t('title') })
      return
    }
    ctx.notify?.(t('fixedN', { n: 1 }), { level: 'success', title: t('title') })
    ctx.activity?.log('fix', { rule: 'heading', n: 1 })
    return
  }
  const r = applyPlan(view, section.base, hit.fix)
  if (r === 'stale') {
    onStale()
    return
  }
  ctx.notify?.(t('fixedN', { n: 1 }), { level: 'success', title: t('title') })
  ctx.activity?.log('fix', { rule: hit.rule, n: 1 })
}

function sectionsOf(view) {
  const opts = currentScanOpts()
  const raw = collectUnits(view.state.doc)
  const sections = raw.map((u) => scanUnit(u, opts))
  quotePass(sections, opts)
  return sections
}

/** 一个段落里所有可修项 → **一个事务**(一次 Cmd+Z 全撤销);标题另起独立事务。 */
function fixOneParagraph() {
  const view = currentView()
  if (!view) {
    ctx.notify?.(t('needEditor'), { level: 'warning', title: t('title') })
    return
  }
  const $from = view.state.selection.$from
  if (!$from.parent || !$from.parent.isTextblock) {
    ctx.notify?.(t('notInText'), { level: 'warning', title: t('title') })
    return
  }
  const base = $from.start()
  const sections = sectionsOf(view).filter((s) => s.base === base)
  if (!sections.length) {
    ctx.notify?.(t('nothingToFix'), { level: 'info', title: t('title') })
    return
  }
  const n = fixSections(view, sections)
  if (n === 'stale') return
  if (!n) {
    ctx.notify?.(t('nothingToFix'), { level: 'info', title: t('title') })
    return
  }
  ctx.notify?.(t('fixedN', { n }), { level: 'success', title: t('title') })
  ctx.activity?.log('fix-paragraph', { n })
}

function fixSections(view, sections) {
  const textItems = []
  const headItems = []
  for (const s of sections) {
    for (const h of s.hits) {
      if (!h.fix) continue
      if (h.rule === 'heading') {
        if (headingFixable(h, s.text)) headItems.push({ base: s.base, hit: h, blockText: s.text })
        continue
      }
      textItems.push({ base: s.base, plan: h.fix })
    }
  }
  let n = 0
  if (textItems.length) {
    const r = applyPlans(view, textItems)
    if (r === 'stale') {
      onStale()
      return 'stale'
    }
    if (r === 'ok') n += textItems.length
  }
  if (headItems.length) n += applyHeadingFixes(view, headItems)
  return n
}

function fixWholeNote() {
  const views = orderedViews()
  if (!views.length) {
    ctx.notify?.(t('needEditor'), { level: 'warning', title: t('title') })
    return
  }
  let n = 0
  for (const v of views) {
    const r = fixSections(v, sectionsOf(v))
    if (r === 'stale') return
    n += r
  }
  rescanAll()
  if (!n) {
    ctx.notify?.(t('nothingToFix'), { level: 'info', title: t('title') })
    return
  }
  ctx.notify?.(t('fixedN', { n }), { level: 'success', title: t('title') })
  ctx.activity?.log('fix-all', { n })
}

// ══ 体检报告的数据面 ══════════════════════════════════════════════════════
function activePagePath() {
  try {
    const p = ctx.app.getActivePage ? ctx.app.getActivePage() : null
    if (p) return p
  } catch (e) {
    /* 无库 */
  }
  try {
    const pg = ctx.app.getPage ? ctx.app.getPage() : null
    return pg && pg.path ? pg.path : null
  } catch (e) {
    return null
  }
}
function snapshotText() {
  // ⚠️唯一允许读页面快照的地方:只读、只用于生成报告清单,永不写回。
  // 正文只认 pg.text(v4 载体的唯一正文来源;v3 宿主上它同样成立)。
  try {
    const pg = ctx.app.getPage ? ctx.app.getPage() : null
    if (!pg) return ''
    return typeof pg.text === 'string' ? pg.text : ''
  } catch (e) {
    return ''
  }
}

/** 统一取材:有活的编辑器 → 实时权威;没有 → 只读快照。 */
function gatherUnits() {
  const views = orderedViews()
  if (views.length) {
    const units = []
    for (const v of views) {
      for (const u of collectUnits(v.state.doc)) units.push({ view: v, base: u.base, pos: u.pos, text: u.text, extra: u.extra })
    }
    return { mode: 'live', units }
  }
  const text = snapshotText()
  if (!text) return { mode: 'none', units: [] }
  return { mode: 'snapshot', units: [{ view: null, base: 0, pos: 0, text, extra: [] }] }
}

function analyze() {
  const opts = currentScanOpts()
  const g = gatherUnits()
  const notePath = activePagePath()
  const sections = g.units.map((u) => {
    const s = scanUnit(u, opts)
    s.view = u.view
    return s
  })
  quotePass(sections, opts)
  let whole = ''
  const entries = []
  let oversize = 0
  for (const s of sections) {
    if (whole) whole += '\n\n'
    const off = whole.length
    whole += s.text
    if (s.oversize) oversize++
    for (const h of s.hits) {
      entries.push({
        rule: h.rule,
        msgKey: h.msgKey,
        sample: h.sample,
        from: off + h.from,
        to: off + h.to,
        fixable: h.fix != null && (h.rule !== 'heading' || headingFixable(h, s.text)),
        section: s,
        hit: h,
      })
    }
  }
  const fixable = entries.filter((e) => e.fixable).length
  return { mode: g.mode, notePath, whole, entries, sections, oversize, fixable }
}

// ══ 报告产物(唯一的 writeFile 路径) ══════════════════════════════════════
function pad2(n) {
  return (n < 10 ? '0' : '') + n
}
function stampOf(ms) {
  const d = new Date(ms)
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + '-' + pad2(d.getHours()) + pad2(d.getMinutes())
}
function humanTime(ms) {
  const d = new Date(ms)
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes())
}
function noteBaseOf(path) {
  const p = String(path || '')
  const file = p.slice(p.lastIndexOf('/') + 1).replace(/\.md$/i, '')
  const safe = file.replace(/[/\\:*?"<>|]/g, '-').trim()
  return safe || UNTITLED
}
function norm(p) {
  return String(p == null ? '' : p).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
}
/** 交付闸:路径撞上活动页 → 拒绝 + 说清楚。**不排队、不改名重试、绝不覆写。** */
function guardWrite(path) {
  let active = null
  try {
    active = ctx.app.getActivePage ? ctx.app.getActivePage() : null
  } catch (e) {
    active = null
  }
  if (active && norm(active) === norm(path)) {
    ctx.notify?.(t('reportIsActive'), { level: 'warning', title: t('title') })
    ctx.activity?.log('export-blocked', { path })
    return 'blocked'
  }
  return 'ok'
}
/** 三态:成功 / 明确不存在 / 读失败。**读失败绝不折叠成 missing。** */
async function tryRead(path) {
  let v = null
  try { v = await ctx.app.readFile(path) } catch (e) { return { kind: 'error', error: e } }
  if (v != null) return { kind: 'exists', text: v }
  // ⚠️ 宿主 readFile 的**读失败形态是 return null,不是 throw**(真源 electron/amadeus/ipc.ts:981-988)——
  //    只接 throw 的话上面那句「三态绝不折叠」在真宿主上是死代码,一次读失败就会无声覆写
  //    用户上一次导出的报告。只读枚举面不经文件内容,读不了的文件照样枚举得到。
  //    `.md` 走 listPages、其余走 listFiles;缺席 / 抛错 / 空数组 = 判不了,退回 missing。
  const fn = /\.md$/i.test(String(path)) ? ctx.app.listPages : ctx.app.listFiles
  if (typeof fn !== 'function') return { kind: 'missing' }
  let xs = null
  try { xs = await fn.call(ctx.app) } catch { xs = null }
  if (Array.isArray(xs) && xs.length && xs.indexOf(path) >= 0) return { kind: 'error', error: new Error(t('errReadListed')) }
  return { kind: 'missing' }
}

function reportMarkdown(rep, noteBase, now) {
  const groups = {}
  for (const e of rep.entries) {
    if (!groups[e.rule]) groups[e.rule] = []
    groups[e.rule].push(e)
  }
  const lines = []
  lines.push('# 排版体检:' + noteBase)
  lines.push('')
  lines.push('- 笔记:`' + (rep.notePath || UNTITLED) + '`')
  lines.push('- 时间:' + humanTime(now))
  lines.push('- 命中:' + rep.entries.length + ' 处(可自动修正 ' + rep.fixable + ' 处)')
  lines.push('- 规则版本:zhtypo ' + PLUGIN_VERSION)
  lines.push('')
  for (const rule of RULE_ORDER) {
    const list = groups[rule]
    if (!list || !list.length) continue
    lines.push('## ' + RULE_LABEL_ZH[rule] + '(' + list.length + ')')
    lines.push('')
    for (const e of list) {
      const lc = lineColOf(rep.whole, e.from)
      const c = contextOf(rep.whole, e.from, e.to, 24)
      const ctxStr = (c.headEllipsis ? '…' : '') + c.before + c.hit + c.after + (c.tailEllipsis ? '…' : '')
      let line = '- 第 ' + lc.line + ' 行第 ' + lc.col + ' 列 — `' + ctxStr.replace(/`/g, "'") + '`'
      if (e.hit.fix && e.fixable) {
        const suggest = e.hit.sample.slice(0, e.hit.fix.from - e.hit.from) + e.hit.fix.insert
          + e.hit.sample.slice(e.hit.fix.to - e.hit.from)
        line += ' → 建议 `' + suggest.replace(/`/g, "'") + '`'
      }
      lines.push(line)
    }
    lines.push('')
  }
  if (!rep.entries.length) lines.push('这一篇没有查出排版问题。')
  return lines.join('\n') + '\n'
}

function sidecarObject(rep, now) {
  const opts = currentScanOpts()
  return {
    version: 1,
    plugin: PLUGIN_ID,
    pluginVersion: PLUGIN_VERSION,
    note: rep.notePath || '',
    generatedAt: now,
    settings: {
      ruleSpace: opts.rules.space,
      rulePunct: opts.rules.punct,
      ruleQuote: opts.rules.quote,
      ruleDup: opts.rules.dup,
      ruleHeading: opts.rules.heading,
      ruleTrailing: opts.rules.trailing,
      headingSingleHash: opts.headingSingleHash,
    },
    hits: rep.entries.map((e) => {
      const lc = lineColOf(rep.whole, e.from)
      const c = contextOf(rep.whole, e.from, e.to, 24)
      return {
        rule: e.rule,
        line: lc.line,
        col: lc.col,
        from: e.from,
        to: e.to,
        sample: e.sample,
        fixable: e.fixable,
        context: c.before + c.hit + c.after,
      }
    }),
    _note: 'from/to are text offsets at generation time — evidence only, never coordinates. '
      + 'Any consumer must re-locate a hit by sample + context; never write to a file using from/to.',
  }
}

/**
 * 导出的唯一入口。同名冲突走 -2…-9 后缀,**绝不覆写**;读失败一律中止,一个字节不写、
 * 也不留任何「已导出」标记。
 */
async function exportReport(noteBase, md, sidecar, now) {
  const wf = workFolder()
  const stamp = stampOf(typeof now === 'number' ? now : Date.now())
  const suffixes = [0, 2, 3, 4, 5, 6, 7, 8, 9]
  for (const n of suffixes) {
    const tail = n ? '-' + n : ''
    const p = wf + '/' + REPORT_DIR + '/' + noteBase + '_' + stamp + tail + '.md'
    const car = wf + '/' + REPORT_DIR + '/.' + noteBase + '_' + stamp + tail + '.json'
    const probe = await tryRead(p)
    if (probe.kind === 'error') {
      ctx.notify?.(t('exportReadFail'), { level: 'error', title: t('title') })
      return 'readfail'
    }
    if (probe.kind === 'exists') continue
    if (guardWrite(p) === 'blocked') return 'blocked'
    await ctx.app.writeFile(p, md)
    try {
      await ctx.app.writeFile(car, JSON.stringify(sidecar, null, 2))
    } catch (e) {
      // markdown 已落盘 —— 删它是第二次毁数据。只说清楚。
      ctx.notify?.(t('exportPartial'), { level: 'warning', title: t('title') })
      ctx.activity?.log('export', { path: p, sidecar: false })
      return 'partial'
    }
    ctx.notify?.(t('exportOk', { path: p }), { level: 'success', title: t('title') })
    ctx.activity?.log('export', { path: p, sidecar: true })
    return 'ok'
  }
  ctx.notify?.(t('exportTooMany'), { level: 'error', title: t('title') })
  return 'toomany'
}

async function doExport(rep) {
  const now = Date.now()
  const base = noteBaseOf(rep.notePath)
  return exportReport(base, reportMarkdown(rep, base, now), sidecarObject(rep, now), now)
}

// ══ 状态栏 ════════════════════════════════════════════════════════════════
let statusHandle = null
let statusTimer = 0
function refreshStatus() {
  if (statusTimer) return
  statusTimer = later(() => {
    statusTimer = 0
    if (!statusHandle || !statusHandle.update) return
    const live = liveViewList()
    if (!live.length) {
      try {
        statusHandle.update({ text: '', title: t('statusTitle') })
      } catch (e) {
        /* 旧宿主 handle 无 update */
      }
      return
    }
    let n = 0
    for (const v of live) n += hitCounts.get(v) || 0
    try {
      statusHandle.update({ text: n ? t('statusHits', { n }) : t('statusClean'), title: t('statusTitle') })
    } catch (e) {
      /* 旧宿主 handle 无 update */
    }
  }, STATUS_THROTTLE_MS)
}

// ══ 样式 ══════════════════════════════════════════════════════════════════
const CSS = [
  '.zhtypo-hit { text-decoration: underline wavy var(--zhtypo-c, var(--accent, #6b8afd));',
  '  text-decoration-thickness: 1.5px; text-underline-offset: 3px;',
  '  text-decoration-skip-ink: none; cursor: pointer; }',
  '.zhtypo-punct, .zhtypo-dup { --zhtypo-c: var(--danger, #d9534f); }',
  '.zhtypo-quote, .zhtypo-trailing { --zhtypo-c: var(--text-muted, #888); }',
  '.zhtypo-space, .zhtypo-heading { --zhtypo-c: var(--accent, #6b8afd); }',
  '.zhtypo-trailing { background: var(--danger-light, rgba(217,83,79,.12)); }',
  '.zhtypo-layer { position: fixed; inset: 0; pointer-events: none; z-index: 60; }',
  '.zhtypo-pop { position: fixed; pointer-events: auto; width: 260px; padding: 10px 12px;',
  '  background: var(--bg-card, #ffffff); color: var(--text, #1f2328);',
  '  border: 1px solid var(--border, #d0d7de); border-radius: var(--radius-md, 8px);',
  '  box-shadow: var(--card-shadow, 0 6px 20px rgba(0,0,0,.16)); font-size: 12.5px; }',
  '.zhtypo-pop-msg { font-weight: 600; margin-bottom: 4px; color: var(--text, #1f2328); }',
  '.zhtypo-pop-sample { font-family: ui-monospace, SFMono-Regular, Menlo, monospace;',
  '  color: var(--text-muted, #6b7280); margin-bottom: 8px; word-break: break-all; }',
  '.zhtypo-pop-note { color: var(--text-muted, #6b7280); margin-bottom: 8px; }',
  '.zhtypo-pop-row { display: flex; gap: 6px; flex-wrap: wrap; }',
  '.zhtypo-btn { font: inherit; font-size: 12px; padding: 4px 10px; cursor: pointer;',
  '  background: var(--bg-card, #ffffff); color: var(--text, #1f2328);',
  '  border: 1px solid var(--border, #d0d7de); border-radius: var(--radius-sm, 6px); }',
  '.zhtypo-btn:hover { border-color: var(--accent, #6b8afd); }',
  '.zhtypo-btn.primary { background: var(--accent, #6b8afd); color: var(--on-accent, #ffffff);',
  '  border-color: transparent; box-shadow: var(--btn-shadow, none); }',
  '.zhtypo-btn[disabled] { opacity: .55; cursor: default; }',
  '.zhtypo-root { padding: 16px 20px 28px; color: var(--text, #1f2328); font-size: 13px; line-height: 1.6; }',
  '.zhtypo-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }',
  '.zhtypo-h1 { font-size: 15px; font-weight: 600; color: var(--text, #1f2328); flex: 1; min-width: 140px; }',
  '.zhtypo-sub { color: var(--text-muted, #6b7280); font-size: 12px; margin: 6px 0 14px; }',
  '.zhtypo-badge { display: inline-block; padding: 1px 7px; margin-left: 6px; font-size: 11px;',
  '  background: var(--bg-card, #f6f8fa); color: var(--text, #1f2328);',
  '  border: 1px solid var(--border, #d0d7de); border-radius: 10px; }',
  '.zhtypo-group { margin: 14px 0 4px; font-weight: 600; color: var(--text, #1f2328); cursor: pointer; }',
  '.zhtypo-row { display: flex; align-items: baseline; gap: 10px; padding: 4px 0;',
  '  border-bottom: 1px solid var(--border, #eaeef2); cursor: pointer; }',
  '.zhtypo-lc { color: var(--text-muted, #6b7280); font-size: 12px; white-space: nowrap; }',
  '.zhtypo-ctx { flex: 1; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;',
  '  color: var(--text, #1f2328); word-break: break-all; }',
  '.zhtypo-ctx-hit { background: var(--accent-light, rgba(107,138,253,.20)); color: var(--text, #1f2328);',
  '  border-radius: 3px; padding: 0 1px; }',
  '.zhtypo-empty { color: var(--text-muted, #6b7280); padding: 26px 0; }',
].join('\n')

function injectStyle() {
  if (typeof document === 'undefined' || !document.createElement) return
  if (document.getElementById(STYLE_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = CSS
  if (document.head && document.head.appendChild) document.head.appendChild(el)
}
injectStyle()

// ══ 报告视图 ══════════════════════════════════════════════════════════════
let mountCount = 0
const reportRefreshers = new Set()
ctx.registerView({
  id: 'report',
  title: t('viewTitle'),
  singleton: true,
  mount(el) {
    mountCount++
    const root = document.createElement('div')
    root.className = 'zhtypo-root'
    el.appendChild(root)
    const ui = { expanded: {}, data: null }

    const refresh = () => {
      ui.data = analyze()
      render()
    }
    const render = () => {
      const scrollTop = el.scrollTop || 0
      root.textContent = ''
      const rep = ui.data
      const head = document.createElement('div')
      head.className = 'zhtypo-head'
      const h1 = document.createElement('div')
      h1.className = 'zhtypo-h1'
      h1.textContent = rep && rep.notePath ? noteBaseOf(rep.notePath) : t('viewTitle')
      head.appendChild(h1)
      if (rep && rep.mode !== 'none') {
        head.appendChild(mkButton(t('btnRecheck'), '', () => {
          rescanAll()
          refresh()
          ctx.activity?.log('check', { n: ui.data ? ui.data.entries.length : 0 })
        }))
        const fixAll = mkButton(t('btnFixAll'), 'primary', () => {
          fixWholeNote()
          refresh()
        })
        if (rep.mode !== 'live' || !rep.fixable) fixAll.disabled = true
        head.appendChild(fixAll)
        head.appendChild(mkButton(t('btnExport'), '', () => {
          const snap = ui.data
          if (snap) void doExport(snap)
        }))
      }
      root.appendChild(head)

      if (!rep || rep.mode === 'none') {
        const p = document.createElement('div')
        p.className = 'zhtypo-empty'
        p.textContent = t('emptyNoNote')
        root.appendChild(p)
        return
      }
      const sub = document.createElement('div')
      sub.className = 'zhtypo-sub'
      sub.textContent = t('hitsSummary', { n: rep.entries.length, m: rep.fixable })
      const badge = document.createElement('span')
      badge.className = 'zhtypo-badge'
      badge.textContent = rep.mode === 'live' ? t('srcLive') : t('srcStale')
      sub.appendChild(badge)
      if (rep.oversize) {
        const os = document.createElement('span')
        os.className = 'zhtypo-badge'
        os.textContent = t('oversizeBlock', { n: rep.oversize })
        sub.appendChild(os)
      }
      root.appendChild(sub)

      if (!rep.entries.length) {
        const p = document.createElement('div')
        p.className = 'zhtypo-empty'
        p.textContent = t('emptyClean')
        root.appendChild(p)
        return
      }
      for (const rule of RULE_ORDER) {
        const list = rep.entries.filter((e) => e.rule === rule)
        if (!list.length) continue
        const gh = document.createElement('div')
        gh.className = 'zhtypo-group'
        const open = ui.expanded[rule] !== false
        gh.textContent = (open ? '▾ ' : '▸ ') + t('rule' + rule.charAt(0).toUpperCase() + rule.slice(1)) + ' (' + list.length + ')'
        gh.addEventListener('click', () => {
          ui.expanded[rule] = !open
          render()
        })
        root.appendChild(gh)
        if (!open) continue
        for (const e of list) root.appendChild(renderRow(rep, e))
      }
      el.scrollTop = scrollTop
    }
    const renderRow = (rep, e) => {
      const row = document.createElement('div')
      row.className = 'zhtypo-row'
      const lc = lineColOf(rep.whole, e.from)
      const pos = document.createElement('div')
      pos.className = 'zhtypo-lc'
      pos.textContent = t('lineCol', { line: lc.line, col: lc.col })
      row.appendChild(pos)
      const c = contextOf(rep.whole, e.from, e.to, 24)
      const box = document.createElement('div')
      box.className = 'zhtypo-ctx'
      const b1 = document.createElement('span')
      b1.textContent = (c.headEllipsis ? '…' : '') + c.before
      const b2 = document.createElement('span')
      b2.className = 'zhtypo-ctx-hit'
      b2.textContent = c.hit
      const b3 = document.createElement('span')
      b3.textContent = c.after + (c.tailEllipsis ? '…' : '')
      box.appendChild(b1)
      box.appendChild(b2)
      box.appendChild(b3)
      row.appendChild(box)
      const btn = mkButton(t('btnFix'), '', (ev) => {
        if (ev && ev.stopPropagation) ev.stopPropagation()
        if (!e.section.view) return
        fixSingle(e.section.view, e.section, e.hit)
        refresh()
      })
      if (!e.fixable || rep.mode !== 'live') btn.disabled = true
      row.appendChild(btn)
      row.addEventListener('click', () => {
        jumpTo(e)
      })
      return row
    }
    refresh()
    // ⚠️切语言只重画,**不重挂视图**;展开状态与滚动位置在 ui/el 上,重建后回填。
    const offLocale = ctx.subscribeLocale ? ctx.subscribeLocale(() => render()) : null
    const offPage = ctx.app.subscribePage ? ctx.app.subscribePage(() => refresh()) : null
    reportRefreshers.add(refresh)
    return () => {
      reportRefreshers.delete(refresh)
      if (offLocale) offLocale()
      if (offPage) offPage()
    }
  },
})

function jumpTo(entry) {
  const s = entry.section
  const v = s.view
  if (!v) return
  const a = s.base + entry.hit.from
  if (a > v.state.doc.content.size) {
    onStale()
    return
  }
  try {
    const tr = v.state.tr
    v.dispatch(tr.setSelection(PM_TOOLS.TextSelection.near(v.state.doc.resolve(a))))
    v.focus()
    if (v.dom && v.dom.scrollIntoView) v.dom.scrollIntoView({ block: 'center' })
  } catch (e) {
    onStale()
  }
}

// ══ 贡献点注册 ════════════════════════════════════════════════════════════
const PM_TOOLS = { TextSelection: null }
if (ctx.registerEditorExtension) {
  ctx.registerEditorExtension((pm) => {
    PM_TOOLS.TextSelection = pm.TextSelection
    return editorFactory(pm)
  }, { priority: 'normal' })
} else {
  // 旧宿主:**说清楚原因后退场**,不装作装上了。报告仍走只读快照路径。
  ctx.notify?.(t('needNewerHost'), { level: 'error', title: t('title') })
}

ctx.registerCommand({
  id: 'zhtypo-open',
  title: t('cmdOpen'),
  keywords: 'zhtypo 排版 校对 typo pangu 空格 report',
  run: () => {
    if (ctx.openView) ctx.openView('report')
  },
})
// 注:id 读起来像「检查」,按规格钉死的语义是**修当前段落**。
ctx.registerCommand({
  id: 'zhtypo-check',
  title: t('cmdCheck'),
  keywords: 'zhtypo 排版 修 段落 fix paragraph',
  run: () => {
    fixOneParagraph()
    for (const r of reportRefreshers) r()
  },
})
ctx.registerCommand({
  id: 'zhtypo-fix-note',
  title: t('cmdFixNote'),
  keywords: 'zhtypo 排版 体检 检查 note check',
  run: () => {
    rescanAll()
    if (ctx.openView) ctx.openView('report')
    for (const r of reportRefreshers) r()
    ctx.activity?.log('check', { scope: 'note' })
  },
})

ctx.registerSlashItem({
  id: 'zhtypo-report',
  label: t('slashLabel'),
  hint: t('slashHint'),
  icon: 'text',
  group: t('group'),
  keywords: 'zhtypo 排版 校对 typo pangu 空格',
  run: () => {
    rescanAll()
    if (ctx.openView) ctx.openView('report')
    for (const r of reportRefreshers) r()
    return '' // ⚠️返回空串 = 一个字都不插
  },
})

ctx.registerSetting({ key: 'ruleSpace', label: t('setSpace'), type: 'boolean', default: true })
ctx.registerSetting({ key: 'rulePunct', label: t('setPunct'), type: 'boolean', default: true })
ctx.registerSetting({ key: 'ruleQuote', label: t('setQuote'), type: 'boolean', default: true })
ctx.registerSetting({ key: 'ruleDup', label: t('setDup'), type: 'boolean', default: true })
ctx.registerSetting({ key: 'ruleHeading', label: t('setHeading'), type: 'boolean', default: true })
ctx.registerSetting({ key: 'ruleTrailing', label: t('setTrailing'), type: 'boolean', default: true })
ctx.registerSetting({ key: 'headingSingleHash', label: t('setSingleHash'), type: 'boolean', default: false, description: t('setSingleHashDesc') })
ctx.registerSetting({ key: 'maxBlockChars', label: t('setMaxChars'), type: 'number', default: 20000, min: 2000, max: 200000, description: t('setMaxCharsDesc') })
// 同 key 重注册即覆盖宿主的标准行,只为把 label/描述说清楚。
ctx.registerSetting({ key: 'workFolder', label: t('setWorkFolder'), type: 'text', default: WF_FALLBACK, description: t('setWorkFolderDesc') })

statusHandle = ctx.registerStatusItem
  ? ctx.registerStatusItem({
    id: 'hits',
    side: 'right',
    text: '',
    title: t('statusTitle'),
    onClick: () => {
      if (ctx.openView) ctx.openView('report')
    },
  })
  : null
// 状态栏项是少数**能**运行时改文案的宿主面(handle.update):它跟着语言走,不必等重启。
const offLocaleStatus = ctx.subscribeLocale ? ctx.subscribeLocale(() => refreshStatus()) : null

// ── check.mjs 测试钩子 ────────────────────────────────────────────────────
if (globalThis.__ZHTYPO_TEST__) {
  Object.assign(globalThis.__ZHTYPO_TEST__, {
    MSG, L, t, ready, STATS,
    exemptRanges, isExempt, mergeRanges, scanText, safeScan, collectHits,
    ruleSpace, rulePunct, ruleQuote, quoteStats, quotePositions, ruleDup, ruleHeading, ruleTrailing,
    lineColOf, contextOf, contextKey, lineBounds,
    blockTextOf, collectUnits, scanUnit, quotePass, buildDecorations,
    putPlan, applyPlan, applyPlans, headingFixable, headingCapable, applyHeadingFixes,
    editorFactory, currentScanOpts, settingSignature,
    exportReport, guardWrite, tryRead, noteBaseOf, stampOf, norm,
    reportMarkdown, sidecarObject, analyze, doExport,
    addIgnore, ignoreDataObj, ignoredSetRef: () => ignoredSet, ignoredListRef: () => ignoredList,
    liveViews, hitCounts, orderedViews, currentView,
    lastViewRef: () => lastView,
    mountCountRef: () => mountCount,
    fixSections, fixOneParagraph, fixWholeNote, rescanAll, workFolder,
  })
}

return () => {
  disposed = true
  clearTimers()
  closePopup()
  if (offLocaleStatus) offLocaleStatus()
  if (statusHandle && statusHandle.dispose) statusHandle.dispose()
  reportRefreshers.clear()
  liveViews.clear()
  hitCounts.clear()
  lastView = null
  if (typeof document !== 'undefined' && document.getElementById) {
    const st = document.getElementById(STYLE_ID)
    if (st && st.remove) st.remove()
  }
}
