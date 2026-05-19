# Picote（Obsidian Columns）

**Picote** 是给设计师和重度笔记用户用的 Obsidian 分栏插件：偏重**拖拽采集**与**尽量不打扰编辑流程**的实现。

---

## 为什么选择 Picote

- **低摩擦采集**：网页/花瓣/小红书/Pinterest 等场景下，倾向用**拖拽**把图放进分栏（比依赖粘贴更稳）。
- **智能本地化**：能嗅探远程图 URL，静默下载并重命名后，把链接换成本地 `![[image.png]]`。
- **写入节奏**：配合 `requestAnimationFrame` 等节奏，减轻高频写回导致的卡顿或报错。
- **复杂 CDN**：对无扩展名、防盗链等链接有专门嗅探链路。

插件界面与交互由作者按 UI/UX 思路做过拖拽反馈等方面的打磨。

---

## 功能概要

- 简洁的分栏书写方式，预览下布局顺滑。
- 跨平台 CDN / 外链识别管线。
- 建议优先使用**拖拽**，作为与 Obsidian/CodeMirror 配合最稳的路径。

---

## 安装与升级（通用）

1. 从 [GitHub Releases](https://github.com/) 下载对应版本的 `main.js`、`manifest.json`、`styles.css`（以 Release 资产为准）。
2. 放到 `.obsidian/plugins/picote/`（目录名必须与 `manifest.json` 里的 `id` 一致）。
3. 在「第三方插件」中启用；**升级后**建议**关闭插件再启用**，或重启 Obsidian。

下文各版本若在「所含文件」中**未写明** `styles.css`，则表示该版本未改样式文件，只需按需替换所列文件。

> 版本号以仓库 [`manifest.json`](./manifest.json) 的 **`version`** 字段为准。

---

## 更新日志（精简）

### [2.3.5] — 2026-05-12

**类型**：稳定性 / 交互修复  

**所含文件**：`main.js`、`manifest.json`  

**Bug 10：分栏内打字后字符消失或跑到分栏外**  
输入法、停顿或 Enter 后会触发防抖写回，Live Preview 会整段换掉分栏 DOM，原先加在 wrapper 上的「跳过重建」标记无法迁移到新节点，导致焦点落到编辑器、观感上像丢字或「跑到外面」。  
**处理**：输入 / `compositionend` / Enter 期间**只更新内存里的列数据**，不写回源码；**失焦**时再统一防抖同步（并保留孤儿列不写回的守卫）。

---

### [2.3.4] — 2026-05-12

**类型**：稳定性 / 排版修复  

**所含文件**：`main.js`、`manifest.json`  

**Bug 9：视频 + 文字分栏下，底下仍露出单独一行 ```**  
原判断过严、扫描步数与邻接关系不够，且视频加载后 DOM 二次重拍发生在固定延时之后，清理逻辑碰不到。  
**处理**：按「整行是否为纯围栏」放宽判断并跳过插件自身容器；扩大向上回溯与扫描步数；用 **MutationObserver** 补齐异步重排；延时档位加密并叠加 `requestAnimationFrame`。

---

### [2.3.3] — 2026-05-12

**类型**：稳定性 / 拖放修复  

**所含文件**：`main.js`、`manifest.json`  

**Bug 8：一侧有视频/文字时，拖图「没反应」；拖视频后另一侧文字闪烁**  

- blur 在列已从 DOM 移除后仍用旧 DOM 序列化，把刚写入的内容盖掉 → 增加 **`col.isConnected`** 守卫。  
- 多处 `syncToSource` 与异步重建打架 → **统一走 `debouncedSync`**，与 `_dtSkipRebuild` 配合减少双次重建。  
- 同笔记内从 `<video>` 拖拽缺兜底 → **`dragstart` 对齐 VIDEO**。  
- 带 `text/html` 的内部 wikilink 被误判为外链 → **`isInternalWikilinkRef`** 强制走笔记内分支。

---

### [2.3.2] — 2026-05-12

**类型**：稳定性修复  

**所含文件**：`main.js`、`styles.css`、`manifest.json`  

- **Bug 6**：Enter 用 `execCommand` 在 CM6 嵌套 `contenteditable` 下不可靠 → 改为 **Range 插 `<br>`** 并拦事件冒泡；`buildContainer` 增加 **`force`**；聚焦期 **`_dtSkipRebuild`**，`debouncedSync` 编辑中不草率放开。  
- **Bug 7**：首张图写入后第二张拖中间栏失败 → drop 入口重置跳过标记与定时器；异步回调从 **`wrapperEl._dtColumns`** 取最新数组再写入。

---

### [2.3.1] — 2026-05-12

**类型**：首批稳定性修复  

**所含文件**：`main.js`、`styles.css`、`manifest.json`  

- **Bug 1**：Obsidian 先处理 drop → 在 **window 捕获阶段**处理落在分栏上的拖放；`items` → `getAsFile()` 兜底。  
- **Bug 2**：`<div><br></div>` 序列化多出空行 → **`serializeColumnContent`** 区分空块与单媒体块。  
- **Bug 3**：IME 期间防抖写回打断组字 → **composition** 门禁 + 失焦轮询等待。  
- **Bug 4**：点分栏误入代码块视图 → **z-index / isolation**，收窄 `.dt-inserter` 热区，事件 **`stopPropagation`**。  
- **Bug 5**：闭合围栏单独成行的「假 ```」→ **`cleanupStrayFenceNearWrapper`**（可能误伤分栏外故意写的单独围栏，属权衡）。

---

### [2.3.0] 及更早

更早变更见仓库提交历史或 Release 说明。

---

## 关于开发与作者

Picote 是在 Obsidian / CodeMirror 6 环境下的工程取舍：在保证可维护的前提下，用**拖拽优先**与**异步写回节拍**换来的稳定体验。

**Designed with ❤️ by Pipi_huang**
