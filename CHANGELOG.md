# 更新日志

## 1.0.2 — 2026-10-04

- Space 图标换成插件自己的图标,不再和别的插件共用图标库里的同一枚(`space.json` 的 `iconFile`)。需要支持 Space 自绘图标的 Forsion(2.12.2 之后的版本);更早的版本照旧显示原来的图标。配方版本不变,已保存的布局不受影响。
- **English:** The Space now shows the plugin's own icon instead of a shared library icon (`iconFile` in `space.json`). Needs a Forsion version that supports custom Space icons (later than 2.12.2); earlier versions keep the previous icon. The recipe version is unchanged, so saved layouts are not affected.

## 1.0.1 — 2026-08-21

对抗评审修复轮(报告见 `Forsion-Instrumentality-Project/20260821/REVIEW-zhtypo.md`)。发布前修,未上过用户机器。

- **[P0] 修「列表项里的 `##标题` 一键修 → `#` 被删掉、块没变成标题、还报『已修正 1 处』」**:
  同一个事务里先 `tr.delete()` 删掉 `#` 再 `tr.setBlockType()`,而 prosemirror 的 `setBlockType`
  对 `canChangeType` 为 false 的块是**静默跳过**(不抛不报)—— 列表项的 content 规格是
  `paragraph block*`,第一个子节点恒不许换成 heading。于是 `- ##重点` 变成 `- 重点`,
  **用户的两个字符没了**,而提示说修好了。现在 `setBlockType` 之后验收一次
  (`tr.doc.resolve(at).parent.type === heading`),不合格就**整条事务丢掉、不 dispatch、不计数** ——
  delete 与 setBlockType 本来就在同一个 tr 里,丢掉就是原子回滚。
- **[P0] 修「一键全修会把另一个面板里那篇没被点到的笔记也改掉」**:`registerEditorExtension` 是
  全局注册,**每个编辑器实例**都会进 `liveViews`,而 `fixWholeNote` / `gatherUnits` 取的是全部
  live view,不按篇过滤。分屏把两篇笔记同时摆出来(工作台的一等交互)时,在甲文上点「一键全修」
  会把乙文一起改了,提示合并成一个数字;体检报告也把两篇缝进同一个 `whole` 却只署甲文的路径与行号。
  新增 `scopedViews()`:**v4/统一载体(普通笔记的默认形态)= 一篇一个编辑器 → 只认焦点那一个**;
  谁都没被点过就一个都不改(命令会提示「请先点一下正文」);v3 标记页维持全取(一篇本来就是很多个编辑器)。
- **[P1] 修「一次读失败就无声覆写用户上一次导出的报告」**:`tryRead` 只把 **throw** 判成读失败,
  而宿主的读失败形态是 **return null**(真源 `electron/amadeus/ipc.ts:981-988`)——
  于是 `main.js` 上那句「三态:成功 / 明确不存在 / 读失败。**读失败绝不折叠成 missing**」在真宿主上
  是死代码。现在 null 时用只读枚举面复核(`.md` 走 `listPages`、其余走 `listFiles`),
  「在库里却读不回来」= 读失败 ⇒ 中止,零写入;枚举面缺席 / 空数组时退回 missing。
- check.mjs:**把假 tr 升级成能模拟「setBlockType 被静默跳过」**(以前的假 tr 只记「有没有调」,
  从原理上看不见这一半 —— 这正是 P0 第一条能躲过 242 条断言的原因),补 R-F1 / R-F2 / R-F3 三组回归。
  三条变异验证当场变红。

### 已知未修(记台账,见 REVIEW-zhtypo.md Finding 4/5/6/7)

- 豁免区漏 4 类:四空格缩进代码块、`\(…\)` 公式、公式内 `\$` 转义、属性值含 `>` 的 HTML 标签
  (**只在只读快照通道出现**,live 通道被 PM 结构挡住,所以是报告噪音不是改坏文件)。
- 报告里的「第 N 行第 M 列」在含代码块的笔记上与磁盘行号对不上(`analyze()` 跳过代码块后重排)。
- 撞名探测只探 `.md` 不探 `.json`:孤儿 sidecar 会被无声覆写。
- README / manifest / onboarding 承诺的「报告正开着时直接拒绝导出」真实路径上走不到
  (实际是悄悄另存 `-2`);`guardWrite` 事实上是一道死闸。

## 1.0.0 — 2026-08-21

首个版本。

- **行内提示**:六条规则(盘古之白 / 标点混用 / 引号不一致 / 重复词 / 标题缺空格 / 行尾多余空格)在编辑器里画波浪线,点一下弹「修正 / 忽略这一处 / 关掉这条规则」。
- **三个粒度**:单条就地修 / 修当前段落 / 体检当前笔记(按规则分组的报告 + 一键全修)。每次修改是一个编辑器事务,Cmd+Z 一步撤销。
- **豁免区**:代码围栏、行内代码、公式、URL、链接路径、wikilink、HTML 标签与注释、frontmatter 一律不碰,三层豁免并联。
- **导出报告**:落 `<工作文件夹>/排版体检/`,同名绝不覆写(自动加 `-2`…`-9`),报告正开着时拒绝导出。
- 中英双语,跟随宿主语言实时切换。全程离线。
