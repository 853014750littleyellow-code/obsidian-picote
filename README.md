# Picote (Obsidian Columns) 🚀

**Picote** 是一个专为追求极致效率的设计师和开发者打造的 Obsidian 智能分栏插件。它不仅是布局工具，更是你灵感采集流中的“无感自动化”中心。

---

## 🌟 核心价值：为什么选择 Picote？

在开发 Picote 时，我遵循**第一性原理**重新思考了素材采集路径。传统的“复制粘贴”常受限于编辑器底层权限，而 Picote 另辟蹊径：

*   **零摩擦采集 (Zero-Friction)**: 真正实现全网图片（花瓣、小红书、Pinterest 等）“一拖即入”，无需先下载到本地。
*   **智能本地化 (Auto-Localization)**: 自动嗅探远程图片 URL，静默下载并重命名，自动将图链替换为本地 `![[image.png]]`。
*   **底层写入优化**: 利用 `requestAnimationFrame` 寻找系统渲染空隙，彻底解决高频写入导致的编辑器死锁报错。

## 🛠️ 功能特性

*   **极简分栏语法**: 延续你熟悉的布局逻辑，但响应更顺滑。
*   **跨平台 CDN 识别**: 针对无扩展名或防盗链的特殊 CDN 链接建立了嗅探管线。
*   **设计驱动交互**: 作为一名 UI/UX 设计师，我优化了每一像素的拖拽反馈。

## 🚀 快速开始

1.  在 GitHub Releases 中下载最新的 `main.js`, `manifest.json`, `styles.css`。
2.  将其放入你的 Obsidian 插件目录 `.obsidian/plugins/picote/`（文件夹名须与 `manifest.json` 里的 `id` 一致）。
3.  在插件设置中启用，开始享受**一拖即入**的快感。

> **💡 专家建议**: 为了获得最稳定的体验，请优先使用**拖拽 (Drag & Drop)** 交互，这是我通过底层协议验证后的最优路径。

## 📋 更新日志

下列版本号与仓库内 [`manifest.json`](./manifest.json) 的 **`version`** 字段一致。

### [2.3.5] — 2026-05-12

**类型**：稳定性与体验修复（Bugfix）。

**升级**：替换 **`main.js`、`manifest.json`**（本版未改 `styles.css`），在 Obsidian 中关闭再启用本插件或重启应用。

#### Bug 10：在分栏里输入文字后，文字消失或跑到分栏外面

**用户场景**：

- 在某一栏里打「猫咪公馆」等文字，停顿一会儿后字突然不见；或下一刻输入直接出现在**分栏外的笔记正文**里，无法继续在分栏内编辑。

**原因**：

- v2.3.2 起 `input` / `compositionend` 在 800ms / 120ms 防抖后会 `syncToSource` 把内容写回 Markdown 源码。
- Live Preview 模式下，源码一旦变化，Obsidian 会**用全新的 DOM 节点替换**整个分栏代码块（这是 CM6 atomic widget 的工作方式）。
- v2.3.2 加在 wrapper 上的 `_dtSkipRebuild` 标记**只对同一个 DOM 节点有效**；Obsidian 用新节点整体替换旧节点时，标记并不会被搬到新节点上。
- 后果：用户正在编辑的 `.dt-column` 节点被销毁 → 焦点掉到 CodeMirror → 还没"上屏"的字符被截断（消失）；后续按键直接落进笔记源码（"跑到分栏外"）。

**处理**：

- **编辑期间彻底不写回源码**：`input` / `compositionend` / `Enter` 三处都只更新 `wrapperEl._dtColumns` 数组，不再触发任何 `debouncedSync` / `syncToSource`，并主动清掉 `_syncTimer`。
- **失焦时统一同步**：仍由 `blur` 触发一次 `debouncedSync` 写回源码并允许 post-processor 重建 DOM；保留 v2.3.3 的「孤儿节点 (`!col.isConnected`) 跳过」守卫，杜绝旧内容反向覆盖。
- 体验：写字、中文拼音、换行不会被任何异步重建打断；切换到其他位置或保存前的失焦时，源码会一次性同步到位。

---

### [2.3.4] — 2026-05-12

**类型**：稳定性与体验修复（Bugfix）。

**升级**：请同时替换 **`main.js`、`manifest.json`**（本版未改 `styles.css`），在 Obsidian 中关闭再启用本插件或重启应用。

#### Bug 9：「视频 + 文字」分栏正常显示后，下方仍漏出一行「```」三点，影响排版

**用户场景**：

- 左栏视频、右栏文字（视频 + 文字组合）。分栏整体已正确渲染，但分栏**下方**始终留着一行孤零零的 `` ``` ``（视觉上像「三个点」），其后大片空白拉远了下一段内容的相对位置，破坏了整体排版。
- 2.3.1 已实现的 `cleanupStrayFenceNearWrapper` 在「图片 + 文字」下能盖住，但「视频 + 文字」下 Live Preview 的 DOM 重排时机更晚，往往落在原有 5 档延时窗口（0/48/120/320/720ms）之外，于是漏网。

**原因**：

- 原 `isNodeOnlyFenceText` 在「整行只剩 ```」之外还要求 `children.length <= 4`；CM6 把闭合围栏渲染到 `.cm-line` 里时可能带多个 `<span>`（高亮/装饰/光标占位），子元素数量超出阈值就被放过。
- 原扫描循环 `limit++ < 28` 步、且只看「wrapperEl 的直接兄弟」与「父级的下一兄弟」，遇到被多层 `.cm-embed-block` / `.markdown-rendered` 包裹的结构会越过目标。
- 仅有固定延时，没有 `MutationObserver`；视频/缩略图加载完成后 CM 二次重排时，已经过了所有 setTimeout 窗口，再也不会复查。

**处理**：

- 放宽 **`isNodeOnlyFenceText`**：只看 `textContent.trim()` 是否匹配 `^\`{3,}$`，**不再限制子元素数量**；同时主动跳过插件自身渲染的容器（`.dt-wrapper / .dt-container / .dt-column / .dt-floating-trigger / .dt-floating-menu`），杜绝自伤。
- 扩大扫描范围：单轮最多 **200 步**，最多隐藏 **8 个**节点；**向上回溯至多 8 层祖先**（遇到 `.cm-editor / .markdown-preview-section / .markdown-preview-view / body` 停止），覆盖被嵌套包裹的闭合围栏。
- 新增 **`ensureStrayFenceObserver`**：在 wrapper 最近的 `.cm-embed-block` / 父级上挂 `MutationObserver`，监听 `childList + subtree + characterData`。无论是 CM 异步重排、视频缩略图加载、还是 `debouncedSync` 之后的 post-processor 二次构建，新出现的 ``` 行都会立刻被隐藏；wrapper 离开 DOM 时观察者自动解绑。
- `scheduleCleanupStrayFences` 延时档位从 5 个加密到 **8 个**（0 / 24 / 64 / 140 / 280 / 520 / 880 / 1400ms），并叠加 `requestAnimationFrame`，保留兜底。

---

### [2.3.3] — 2026-05-12

**类型**：稳定性与体验修复（Bugfix）。

**升级**：请同时替换 **`main.js`、`manifest.json`**（本版未改 `styles.css`），在 Obsidian 中关闭再启用本插件或重启应用。

#### Bug 8：分栏一侧已有视频/文字时，向另一侧拖图片「拖了像没反应」；拖入视频后另一侧文字「闪闪闪」

**用户场景**：

- 左栏视频、右栏文字（如截图所示）：把下载好的图片拖入**右侧已有文字**的分栏，看起来「拖不进去」。
- 当前笔记中已有这段视频，把视频拖入分栏不生效，必须从系统资源管理器（外部 Downloads）才拖得动。
- 视频从外部成功拖进来之后，**另一栏的文字会"闪一下"**（DOM 被快速重建两次）。

**原因**：

- **(A) blur 反向覆盖（拖图片"看似没反应"的真凶）**：用户先把光标点在右栏文字上读 → 触发 `focus`、`wrapperEl._dtSkipRebuild = true`。随后释放图片 → `handleDtColumnDataDrop` 异步把图片写入 vault、`appendToColumn` 更新 `columns[colIdx]` 为 `"原文字<br>![[image.png]]"`、`buildContainer(force=true)` `el.empty()` 把右栏从 DOM 摘下。此时浏览器在被摘除的「孤儿列」上触发了一次 `blur`，旧的 `blur` 处理器**继续** `serializeColumnContent(col)`（读到的是重建**前**的旧 DOM，里面只有 `"原文字"`），然后 `columns[colIdx] = stored` 把刚追加好的引用**反向覆盖**掉，再 `debouncedSync` 把"原文字"写回源码 → 图片视觉上"瞬间消失"。
- **(B) 双重重建闪烁**：`handleDtColumnDataDrop` / `handleFileDrop` / `handleClipboardFile` 等路径在 `buildContainer(force=true)` 之后**直接**调 `syncToSource`，把 `_dtSkipRebuild` 当成 `false`。Obsidian 的 markdown post-processor 在 CM `dispatch` 之后异步又跑一次 `buildContainer(force=undefined)`，于是同一段 DOM 被来回重建两次 → 文字/视频闪烁。
- **(C) 同笔记内视频拖不动**：`dragstart` 之前只对 `IMG` 元素做了「按文件名扫 CodeMirror 行号 → 回写 wikilink」的兜底，**没给 `VIDEO` 做对称兜底**；从 Live Preview 渲染的 `<video>` 起拖时 `posAtCoords` 偶尔解析不出正确行号，`_dragSession.ref` 留空，drop 时只能依赖 `dt.files / extractImageFromHtml` 等不识别视频的兜底，于是「同笔记的视频」永远拖不进。
- **(D) wikilink 误判成外部源**：drop 时 `hasExternalEvidence` 检查 `text/html` 类型，Obsidian 内部拖拽的视频/图片同时会带 `text/html`，于是 `if (capturedRef && !hasExternalEvidence)` 被否定，绕开「按笔记内引用追加」的正确分支。

**处理**：

- 新增 **`col.isConnected` 守卫**：`blur` 处理器一开始就判断当前列是否仍挂在 DOM 上；不在则只清理 `_activeEditCol` / `selected` class，**不再**读取旧 DOM、不再写回 `columns`、不再触发 `debouncedSync`，杜绝旧内容反向覆盖。
- **统一改用 `debouncedSync`** 替代直接 `syncToSource`：所有「内部用户动作 → `buildContainer(force=true)` → 写回源码」的路径（`handleDtColumnDataDrop` 全部分支、`handleFileDrop`、`handleClipboardFile`、`processPasteIntoColumn`、`makeInserter`、`insertRemoteMedia`、删除选中媒体）都改走 `debouncedSync`。它先把 `_dtSkipRebuild=true`，~600ms 后再放，期间 markdown post-processor 的 `buildContainer(force=false)` 会因 `_dtSkipRebuild && _dtBuilt` 立即 return，消除二次重建闪烁。
- 新增 **`isInternalWikilinkRef`**：`drop` 入口对 `capturedRef` 与 `plain` 分别做 wikilink 形态检查；只要是 `![[...]]` 就强制走「笔记内追加」分支，**不再被 `hasExternalEvidence` 否定**。
- 给 `dragstart` 增加 **VIDEO 兜底**：取 `vidEl.alt / vidEl.src / vidEl.currentSrc` 的文件名，扫一遍当前文档行（跳过代码块），命中则 `captureLine(line)`；没命中也至少 `beginDragSession("![[<filename>]]", ...)` 兜住，drop 时直接复用 wikilink 分支。

---

### [2.3.2] — 2026-05-12

**类型**：稳定性与体验修复（Bugfix）。

**升级**：请同时替换 **`main.js`、`styles.css`、`manifest.json`**，在 Obsidian 中关闭再启用本插件或重启应用。

#### Bug 6：在分栏里按 Enter，新内容跑到分栏外面 / 编辑没完成就「不让继续」

**原因**：

- 旧实现使用 `document.execCommand("insertLineBreak")` 处理 Enter。在「`.dt-column` (contenteditable) 嵌在 `.cm-content` (contenteditable) 之内」的 Live Preview 环境下，行为不稳，按键易被 CodeMirror 当成「源码换行」，把后续输入挤到分栏外面。
- 用户输入后 `debouncedSync` 会写回源码，触发 Obsidian markdown post-processor **异步**重新调用 `buildContainer` → `el.empty()`，正在编辑的列 DOM 被销毁，焦点掉到 CodeMirror，看起来「不让我接着编辑」。

**处理**：

- 新增 **`insertBrInColumnAtCaret`**：用 Range API 手动在光标处插入 `<br>`（并在行尾补一个占位 `<br>` 让光标显示在新行），不再依赖 `execCommand`；Enter 事件 `stopImmediatePropagation`，杜绝冒泡到 CM。
- 给 `buildContainer` 增加 **`force`** 参数：所有「用户动作触发」的内部重建都传 `force=true`，**markdown post-processor 等外部回调**继续走 `_dtSkipRebuild` 检查。
- **聚焦** 时把 `wrapperEl._dtSkipRebuild = true`，**失焦** 时延迟 650ms 再放开；`debouncedSync` 在仍有列处于编辑时**不主动**释放该标志，避免 post-processor 在编辑半途偷偷重建 DOM。

#### Bug 7：成功拖入一张图后，第二张图拖到中间空栏拖不进去

**原因**：

- 第一次 drop 之后 `wrapperEl._dtSkipRebuild` 可能仍为 `true`（聚焦保护期或同步窗口内），后续 `buildContainer` 直接 `return`，UI 不刷新 → 看起来「拖了没反应」。
- `handleFileDrop` 使用 `FileReader` 读文件，期间 post-processor 可能已经把 `wrapperEl._dtColumns` 换成从源码重新 parse 出的**新数组**，闭包里的旧数组指针**已不被 wrapper 引用**，往里追加新图也无法体现到 UI。

**处理**：

- 在 `handleDtColumnDataDrop` 入口**强制重置** `wrapperEl._dtSkipRebuild = false`，并清掉残留的 `_syncTimer`。
- `handleFileDrop` / `handleClipboardFile` 的异步回调中，从 **`wrapperEl._dtColumns`** 重新取最新数组与有效 `colIdx`，再做 `appendToColumn` 与 `buildContainer(..., true)`，确保新图始终落到当前 UI 持有的列数组上。

### [2.3.1] — 2026-05-12

**类型**：稳定性与体验修复（Bugfix）。

**升级**：请同时替换 **`main.js`、`styles.css`、`manifest.json`**，在 Obsidian 中关闭再启用本插件或重启应用。

#### Bug 1：首次拖入本地/下载图片时，分栏无反应但文件已进入仓库

**原因**：Obsidian 默认的 `drop` 处理顺序较早，分栏逻辑抢不到首次投放，容易出现「库里已有文件、预览里却没更新」。

**处理**：

- 在 **`window` 捕获阶段**拦截落在 `.dt-column` 上的 `dragover` / `drop`，优先执行分栏逻辑并阻断与默认行为冲突。
- 增加 **`dataTransfer.items` → `getAsFile()`** 兜底：部分环境下首次 `drop` 时 `files` 仍为空，但从 `items` 可取到文件。

#### Bug 2：仅在一栏输入后失焦，另一栏无故多出空行或「下移」

**原因**：`contenteditable` 常见 DOM 结构 `<div><br></div>` 在旧版序列化里被当成两段换行，写回 Markdown 后多出一倍空行。

**处理**：在 `serializeColumnContent` 中区分「空行块」与「仅含一张图/视频的块」，避免对 `<div><br></div>` 重复插入 `<br>`，也避免在仅含媒体的 div 前多垫一行。

#### Bug 3：中文拼音输入时停顿几秒，会突然冒出之前的拼音

**原因**：打字过程中 **`input` 触发的防抖写回** 会调用 `syncToSource`，Live Preview 整块重绘 `contenteditable`，打断 **IME 组字**，导致拼音残留或错乱。

**处理**：

- 在 **`compositionstart` ~ `compositionend`** 期间禁止安排写回；并配合 **`input.isComposing`** 兜底。
- **`compositionend`** 后短延迟再同步；**失焦** 时若仍在组字则轮询等待结束后再写回。

#### Bug 4：点击某一分栏（尤其第二栏）顶部后，预览塌成源码块、图片不显示

**原因**：分栏与 CodeMirror 之间存在**命中层叠**；列间插入条 **`.dt-inserter::before` 热区过宽**，容易点到「看不见的间隙」使事件落到编辑器，触发「编辑代码块」视图。

**处理**：

- `.dt-wrapper` 提高 **z-index** 与 **isolation**，减少被 CM 透明层盖住。
- **收窄** `.dt-inserter::before` 的可点热区，减少侵入左右两栏点击区域。
- 在 **分栏、列间插入条、角标** 上对 `mousedown` / `pointerdown` / `click`（等）做 **`stopPropagation`**，避免误触编辑器。

#### Bug 5：四栏等布局正常显示后，下方仍多出一行「```」三点与空白编辑感

**原因**：Live Preview 偶将把**闭合围栏**单独渲成 DOM 里一行「孤零零的 ```」，并非你多写了一段正文。

**处理**：

- 增强 **`cleanupStrayFenceNearWrapper`**：扫描分栏根节点之后的兄弟与父级后续子节点，将**仅含反引号围栏**的节点隐藏（含多次延时与 `debouncedSync` 后的再扫描）。
- **注意**：若你在分栏**外部**刻意写一行单独 ` ``` `，有可能被同一套启发式误判隐藏；属为消除「假三个点」所做的权衡。

### [2.3.0] 及更早

更早版本的变更未在本文档逐条归档；完整历史见仓库提交记录或 Release 说明。

---

## 📝 开发复盘与方法论

Picote 的诞生是我对 Obsidian 底层架构（CodeMirror 6）深度研究的产物：
- **避实击虚**: 绕过受限的粘贴事件，利用高优先级的拖拽协议。
- **异步平衡**: 用工程逻辑实现设计自由。

---

**Designed with ❤️ by Pipi_huang**
