/*
 * DingTalk Columns — Obsidian Plugin (v3)
 * Pure JS, no build step, no @codemirror imports.
 * Direct contenteditable + vault resource path for media.
 */

"use strict";

var __defProp = Object.defineProperty;
var main_exports = {};
__defProp(main_exports, "__esModule", { value: true });

var obsidian = require("obsidian");

var MAX_COLUMNS = 4;
var CODEBLOCK_LANG = "dt-columns";
var COL_SEP = "|||";
var NEWLINE_TOKEN = "<br>";

/** 与 manifest.json 同步，便于启动提示与自检 */
var DT_COLUMNS_VER = "2.3.4";

/* =============================================================
   Helpers
   ============================================================= */

function getEditorEl(mdView) {
	try { return mdView.contentEl.querySelector(".cm-editor"); }
	catch (e) { return null; }
}

function getCMView(el) {
	try {
		var cmEl = (el.closest ? el.closest(".cm-editor") : null) ||
			(el.querySelector ? el.querySelector(".cm-editor") : null) || el;
		if (cmEl && cmEl.cmView && cmEl.cmView.view) return cmEl.cmView.view;
		if (el && el.cmView && el.cmView.view) return el.cmView.view;
	} catch (e) {}
	return null;
}

/**
 * Live Preview 下代码块外层通常不在 .cm-editor 树下，必须用当前 Markdown 页的 CodeMirror
 * 才能 sync 回源码，否则粘贴会静默失败、预览立刻随源码复位。
 */
function resolveCMViewForSync(wrapperEl) {
	try {
		var cmv = getCMView(wrapperEl);
		if (cmv && cmv.state && cmv.state.doc) return cmv;
		var plugin = wrapperEl && wrapperEl._dtPlugin;
		if (!plugin || !plugin.app || !plugin.app.workspace) return null;
		var mdView = plugin.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
		if (!mdView || !mdView.editor || !mdView.editor.cm) return null;
		var fallback = mdView.editor.cm;
		return (fallback && fallback.state && fallback.state.doc) ? fallback : null;
	} catch (e) {}
	return null;
}

function getCursorCoords(editorEl, mdView) {
	try {
		var cmView = null;
		if (mdView && mdView.editor && mdView.editor.cm) {
			cmView = mdView.editor.cm;
		} else {
			cmView = getCMView(editorEl);
		}
		if (cmView) {
			var pos = cmView.state.selection.main.head;
			var coords = cmView.coordsAtPos(pos);
			if (coords) {
				var eRect = editorEl.getBoundingClientRect();
				return { x: coords.left - eRect.left, y: coords.top - eRect.top };
			}
		}
		var cursor =
			editorEl.querySelector(".cm-cursor-primary") ||
			editorEl.querySelector(".cm-cursor");
		if (!cursor) return null;
		var cRect = cursor.getBoundingClientRect();
		var eRect2 = editorEl.getBoundingClientRect();
		if (cRect.height === 0) return null;
		return { x: cRect.left - eRect2.left, y: cRect.top - eRect2.top };
	} catch (e) { return null; }
}

function getVaultResourceUrl(plugin, vaultPath) {
	try {
		return plugin.app.vault.adapter.getResourcePath(vaultPath);
	} catch (e) {
		return vaultPath;
	}
}

var IMG_RE = /^!\[\[([^\]|]+\.(png|jpg|jpeg|gif|webp|svg|bmp|avif))(\|[^\]]+)?\]\]$/i;
var VID_RE = /^!\[\[([^\]|]+\.(mp4|webm|ogg|mov|mkv))(\|[^\]]+)?\]\]$/i;
var IMG_MD_RE = /^!\[([^\]]*)\]\(([^)]+\.(png|jpg|jpeg|gif|webp|svg|bmp|avif))\)$/i;
var VID_MD_RE = /^!\[([^\]]*)\]\(([^)]+\.(mp4|webm|ogg|mov|mkv))\)$/i;
var IMG_URL_RE = /^https?:\/\/.+\.(png|jpg|jpeg|gif|webp|svg|bmp|avif)(\?[^\s]*)?$/i;
var VID_URL_RE = /^https?:\/\/.+\.(mp4|webm|ogg|mov|mkv)(\?[^\s]*)?$/i;
var GENERIC_IMG_URL_RE = /^https?:\/\/.+\/(img|image|res|photo|pic|picture|upload)\/.+$/i;
/* 宽松匹配：![](https://...) 形式的任何外部URL（无需扩展名），用来兼容花瓣/小红书/微博等 CDN 图片 */
var IMG_MD_LOOSE_RE = /^!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)$/i;
/* 常见图床/CDN 域名识别，没有扩展名时也按图片处理 */
var IMG_HOST_RE = /^https?:\/\/([^/]*\.)?(huaban|hbimg|xhscdn|xiaohongshu|sinaimg|weibocdn|zhimg|byteimg|bdimg|hdslb|gtimg|qpic|qlogo|qpic\.cn|360doc|imgsa|alicdn|aliyuncs|tencentcos|cos\.ap|tos-cn|baidu|sogoucdn|nosdn|nipic|fengketu|imageshack|imgur|cloudinary|unsplash|pixabay|pexels|googleusercontent|ggpht|gstatic|fbcdn|cdninstagram|twimg)\./i;

function parseMediaRef(raw) {
	var m;
	m = raw.match(IMG_RE);
	if (m) return { type: "image", file: m[1] };
	m = raw.match(VID_RE);
	if (m) return { type: "video", file: m[1] };
	m = raw.match(VID_MD_RE);
	if (m) return { type: "video", file: m[2], isUrl: /^https?:\/\//.test(m[2]) };
	m = raw.match(IMG_MD_RE);
	if (m) return { type: "image", file: m[2], isUrl: /^https?:\/\//.test(m[2]) };
	m = raw.match(VID_URL_RE);
	if (m) return { type: "video", file: raw, isUrl: true };
	m = raw.match(IMG_URL_RE);
	if (m) return { type: "image", file: raw, isUrl: true };
	if (GENERIC_IMG_URL_RE.test(raw)) return { type: "image", file: raw, isUrl: true };
	/* 宽松：![](https://...) 即使没有扩展名也认作图片 */
	m = raw.match(IMG_MD_LOOSE_RE);
	if (m) return { type: "image", file: m[2], isUrl: true };
	/* 来自常见图床域名的纯 URL，按图片处理 */
	if (IMG_HOST_RE.test(raw)) return { type: "image", file: raw, isUrl: true };
	return null;
}

function isExternalUrl(str) {
	return /^https?:\/\//.test(str);
}

function wrapUrlAsMarkdownImage(url) {
	return "![]("+url+")";
}

function escapeRegExp(s) {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripInvisible(s) {
	return s.replace(/[\u200B\u200C\u200D\uFEFF\u00AD\u2060\u200E\u200F\u061C]/g, "");
}

function normalizeName(raw) {
	var s = raw;
	try { s = decodeURIComponent(s); } catch(e) {}
	try { s = decodeURIComponent(s); } catch(e) {}
	return stripInvisible(s);
}

function getBaseName(filepath) {
	return filepath.replace(/^.*[\\\/]/, "");
}

function buildMediaRegex(filename) {
	var decoded = normalizeName(filename);
	var base = getBaseName(decoded);
	var escaped = escapeRegExp(base);
	var wiki = "!\\[\\[(?:[^\\]]*[\\\\/])?" + escaped + "(?:\\|.*?)?\\]\\]";
	var md   = "!\\[[^\\]]*\\]\\([^)]*?" + escaped + "[^)]*\\)";
	return new RegExp("(?:" + wiki + "|" + md + ")", "i");
}

function findVaultFile(plugin, fileName) {
	var f = plugin.app.vault.getAbstractFileByPath("assets/" + fileName);
	if (f) return "assets/" + fileName;
	f = plugin.app.vault.getAbstractFileByPath(fileName);
	if (f) return fileName;
	var all = plugin.app.vault.getFiles();
	for (var i = 0; i < all.length; i++) {
		if (all[i].name === fileName) return all[i].path;
	}
	return "assets/" + fileName;
}

/* =============================================================
   Insert code block
   ============================================================= */

function insertColumnsBlock(editor, count) {
	try {
		var cursor = editor.getCursor();
		var lineText = editor.getLine(cursor.line);
		var seps = new Array(count).fill("").join(" " + COL_SEP + " ");
		var block = "```" + CODEBLOCK_LANG + "\n" + seps + "\n```\n";
		editor.replaceRange(
			block,
			{ line: cursor.line, ch: 0 },
			{ line: cursor.line, ch: lineText.length }
		);
		editor.setCursor({ line: cursor.line + 3, ch: 0 });
	} catch (e) {
		console.error("DingTalk Columns: insert failed", e);
	}
}

/* =============================================================
   Plugin Class
   ============================================================= */

var DingTalkColumnsPlugin = (function (_super) {

	function DingTalkColumnsPlugin() {
		return _super !== null && _super.apply(this, arguments) || this;
	}
	Object.setPrototypeOf(DingTalkColumnsPlugin.prototype, _super.prototype);
	Object.setPrototypeOf(DingTalkColumnsPlugin, _super);

	DingTalkColumnsPlugin.prototype.onload = function () {
		var _this = this;
		this._floatingEl = null;
		this._menuEl = null;
		this._menuOpen = false;
		this._editorEl = null;
		this._dtWelcomeShown = false;

		this._createFloatingUI();

		this.registerEvent(
			this.app.workspace.on("active-leaf-change", function () {
				_this._attach();
				_this._reposition();
			})
		);

		this.registerDomEvent(document, "keyup", function () {
			_this._reposition();
		});

		this.registerDomEvent(document, "mouseup", function (e) {
			if (_this._floatingEl && _this._floatingEl.contains(e.target)) return;
			if (_this._menuEl && _this._menuEl.contains(e.target)) return;
			setTimeout(function () { _this._reposition(); }, 30);
		});

		this.registerInterval(
			window.setInterval(function () { _this._reposition(); }, 500)
		);

		this.registerMarkdownCodeBlockProcessor(
			CODEBLOCK_LANG,
			function (source, el, ctx) {
				var cols = parseColumns(source);
				buildContainer(cols, el, ctx, _this);
			}
		);

		this.addCommand({
			id: "insert-dingtalk-columns",
			name: "picote：插入两列分栏",
			editorCallback: function (editor) {
				insertColumnsBlock(editor, 2);
			},
		});

		this.addCommand({
			id: "dt-columns-diagnose-clipboard",
			name: "picote：检查剪贴板（贴不进图时用这个）",
			callback: function () {
				diagnoseDtColumnsClipboard();
			},
		});

		this.registerDomEvent(document, "dragstart", function (e) {
			clearDragSession();
			var target = e.target;
			if (!target) return;
			if (target.closest && target.closest(".dt-column")) return;

			var cmEditor = target.closest ? target.closest(".cm-editor") : null;
			if (!cmEditor) return;
			var cmv = getCMView(cmEditor);
			if (!cmv) return;

			function captureLine(cmLine) {
				var raw = cmLine.text;
				var trimmed = raw.trim();
				var ref = parseMediaRef(trimmed);
				/* R2-9：行首项目符号 / 引用块兜底 —— 例如 "- ![[a.png]]"、"> ![[a.png]]" */
				if (!ref) {
					var stripped = trimmed.replace(/^(?:[-*+]\s+|>\s+|\d+\.\s+)+/, "");
					var ref2 = parseMediaRef(stripped);
					if (ref2) {
						ref = ref2;
						trimmed = stripped;
					}
				}
				var fileName = (ref && !ref.isUrl) ? getBaseName(normalizeName(ref.file)) : null;
				beginDragSession(trimmed, fileName, cmLine.number - 1, raw);
			}

			var sel = cmv.state.selection.main;
			if (sel.from !== sel.to) {
				var selLine = cmv.state.doc.lineAt(sel.from);
				if (parseMediaRef(selLine.text.trim())) {
					captureLine(selLine);
					console.log("DT-Columns dragstart [sel] line:", _dragSession.line, _dragSession.ref);
					return;
				}
			}

			try {
				var pos = cmv.posAtCoords({ x: e.clientX, y: e.clientY });
				if (pos != null) {
					var posLine = cmv.state.doc.lineAt(pos);
					if (parseMediaRef(posLine.text.trim())) {
						captureLine(posLine);
						console.log("DT-Columns dragstart [pos] line:", _dragSession.line, _dragSession.ref);
						return;
					}
				}
			} catch (ex) {}

			var imgEl = (target.tagName === "IMG") ? target :
				(target.querySelector ? target.querySelector("img") : null);
			if (imgEl) {
				var fn = "";
				if (imgEl.alt) fn = normalizeName(imgEl.alt);
				if (!fn && imgEl.src) {
					try { fn = decodeURIComponent(imgEl.src).split("/").pop().split("?")[0]; } catch(ex2){}
				}
				if (fn) {
					var fnRegex = buildMediaRegex(fn);
					var doc = cmv.state.doc;
					var inB = false;
					for (var li = 1, ln = doc.lines; li <= ln; li++) {
						var cmL = doc.line(li);
						var lnText = cmL.text.trim();
						if (lnText.startsWith("```")) { inB = !inB; continue; }
						if (!inB && fnRegex.test(lnText)) {
							captureLine(cmL);
							console.log("DT-Columns dragstart [img] line:", _dragSession.line, _dragSession.ref);
							return;
						}
					}
					beginDragSession("![[" + fn + "]]", getBaseName(fn), -1, "");
				}
			}

			/* Bug 8：之前只对 IMG 兜底，从笔记里拖拽**视频**（Live Preview 渲染出来的 <video>）
			 * 时 posAtCoords 偶尔解析不到正确行号，又没有 fallback，最终 _dragSession 是空的；
			 * 在分栏 drop 时 capturedRef 为 null，只能落到 dt.files / extractImageFromHtml 等
			 * 不识别视频的兜底里，于是出现「同笔记内的视频拖不进分栏」。这里对称地补一段 VIDEO 兜底。 */
			var vidEl = (target.tagName === "VIDEO") ? target :
				(target.querySelector ? target.querySelector("video") : null);
			if (vidEl) {
				var vfn = "";
				if (vidEl.getAttribute && vidEl.getAttribute("alt")) {
					vfn = normalizeName(vidEl.getAttribute("alt"));
				}
				if (!vfn && vidEl.src) {
					try { vfn = decodeURIComponent(vidEl.src).split("/").pop().split("?")[0]; } catch(exV){}
				}
				if (!vfn && vidEl.currentSrc) {
					try { vfn = decodeURIComponent(vidEl.currentSrc).split("/").pop().split("?")[0]; } catch(exV2){}
				}
				if (vfn) {
					var vfnRegex = buildMediaRegex(vfn);
					var vdoc = cmv.state.doc;
					var vinB = false;
					for (var vli = 1, vln = vdoc.lines; vli <= vln; vli++) {
						var vcmL = vdoc.line(vli);
						var vlnText = vcmL.text.trim();
						if (vlnText.startsWith("```")) { vinB = !vinB; continue; }
						if (!vinB && vfnRegex.test(vlnText)) {
							captureLine(vcmL);
							console.log("DT-Columns dragstart [video] line:", _dragSession.line, _dragSession.ref);
							return;
						}
					}
					beginDragSession("![[" + vfn + "]]", getBaseName(vfn), -1, "");
					console.log("DT-Columns dragstart [video-fallback] ref:", _dragSession.ref);
				}
			}
		});

		this.registerDomEvent(document, "dragend", function () {
			setTimeout(clearDragSession, 1500);
		});

		/* Live Preview：焦点常在 CodeMirror —— window 捕获阶段转发（比单独 document 更可靠）*/
		var _pasteRouteHook = function (e) {
			var tgt = e.target;
			if (tgt && tgt.closest && tgt.closest(".dt-column")) return;

			var cb = e.clipboardData || window.clipboardData;
			if (!cb) return;

			var tyList = cb.types ? Array.from(cb.types) : [];
			if (cb.files && cb.files.length > 0) {
				try {
					console.info("[DingTalk Columns] clipboard: files=", cb.files.length);
				} catch (t0) {}
			}

			var looksRich = clipboardLooksLikeMediaPaste(cb);
			try {
				if (looksRich || tyList.some(function (t) {
					var s = String(t).toLowerCase();
					return s.indexOf("image") >= 0 || s.indexOf("html") >= 0;
				})) {
					console.info("[DingTalk Columns] paste event | types=", JSON.stringify(tyList),
						" mediaLike=", looksRich,
						" target=", tgt && tgt.nodeName ? tgt.nodeName : "?");
				}
			} catch (t1) {}

			if (!looksRich) return;

			if (_lastColumn.el && !document.body.contains(_lastColumn.el)) {
				_lastColumn.el = null;
				_lastColumn.ts = 0;
			}

			var col = resolveTargetColumnForPaste();
			if (!col) {
				try {
					console.warn("[DingTalk Columns] 检测到图片类剪贴板，但没找到目标分栏。"
						+ "请先「用鼠标点在分栏里」再 Ctrl+V（不要先在开发者工具里按粘贴）");
				} catch (t2) {}
				return;
			}

			var wrap = findDtWrapperElement(col);
			if (!wrap || wrap._dtColumns == null || !wrap._dtPlugin) {
				try { console.warn("[DingTalk Columns] 找不到分栏 wrapper/_dtColumns"); } catch (t4) {}
				return;
			}

			var idx = parseInt(col.getAttribute("data-col-index") || "0", 10);
			if (idx < 0 || isNaN(idx)) idx = 0;

			e.preventDefault();
			try { e.stopImmediatePropagation(); } catch (stopE) { e.stopPropagation(); }

			try {
				console.info("[DingTalk Columns] → 转发到 column #" + (idx + 1));
			} catch (t5) {}

			processPasteIntoColumn(cb, wrap._dtColumns, idx, wrap, wrap._dtPlugin);
		};
		window.addEventListener("paste", _pasteRouteHook, true);
		this.register(function () {
			try { window.removeEventListener("paste", _pasteRouteHook, true); } catch (t6) {}
		});

		installDtColumnWindowDropCapture(_this);

		/* R2-6：mousemove 高频，rAF 节流；只在下一帧统一同步坐标 */
		this.registerDomEvent(document, "mousemove", function (ev) {
			_dtMouse._nextX = ev.clientX;
			_dtMouse._nextY = ev.clientY;
			if (_dtMouse._pending) return;
			_dtMouse._pending = true;
			requestAnimationFrame(function () {
				_dtMouse.x = _dtMouse._nextX;
				_dtMouse.y = _dtMouse._nextY;
				_dtMouse._pending = false;
			});
		});

		this.registerDomEvent(document, "pointerdown", function (ev) {
			var t = ev.target;
			if (!t || !t.closest) return;
			var c = t.closest(".dt-column");
			if (c) {
				_lastColumn.el = c;
				_lastColumn.ts = Date.now();
			}
		}, true);

		this.app.workspace.onLayoutReady(function () {
			_this._attach();
			if (!_this._dtWelcomeShown) {
				_this._dtWelcomeShown = true;
				try {
					new obsidian.Notice(
						"选中文本光标旁边的紫色加号，点击就可以创建分栏，支持图片、文字、视频上传",
						16000
					);
				} catch (w0) {}
			}
		});
	};

	DingTalkColumnsPlugin.prototype.onunload = function () {
		if (this._floatingEl && this._floatingEl.parentNode) this._floatingEl.remove();
		if (this._menuEl && this._menuEl.parentNode) this._menuEl.remove();
		if (this._outsideHandler) document.removeEventListener("mousedown", this._outsideHandler);
	};

	DingTalkColumnsPlugin.prototype._createFloatingUI = function () {
		var _this = this;

		this._floatingEl = document.createElement("div");
		this._floatingEl.className = "dt-floating-trigger";
		this._floatingEl.innerHTML =
			'<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" ' +
			'viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
			'stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">' +
			'<line x1="12" y1="5" x2="12" y2="19"/>' +
			'<line x1="5" y1="12" x2="19" y2="12"/></svg>';
		this._floatingEl.style.display = "none";

		this._floatingEl.addEventListener("mousedown", function (e) {
			e.preventDefault(); e.stopPropagation();
			_this._toggleMenu();
		});

		this._menuEl = document.createElement("div");
		this._menuEl.className = "dt-floating-menu";

		var items = [
			{ icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="18" rx="1"/><rect x="14" y="3" width="7" height="18" rx="1"/></svg>', label: "两栏布局", count: 2 },
			{ icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="5" height="18" rx="1"/><rect x="9.5" y="3" width="5" height="18" rx="1"/><rect x="17" y="3" width="5" height="18" rx="1"/></svg>', label: "三栏布局", count: 3 },
			{ icon: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="4" height="18" rx="1"/><rect x="7" y="3" width="4" height="18" rx="1"/><rect x="13" y="3" width="4" height="18" rx="1"/><rect x="19" y="3" width="4" height="18" rx="1"/></svg>', label: "四栏布局", count: 4 },
		];

		items.forEach(function (item) {
			var row = document.createElement("div");
			row.className = "dt-floating-menu-item";
			row.innerHTML = '<span class="dt-floating-menu-icon">' + item.icon + "</span><span>" + item.label + "</span>";
			row.addEventListener("mousedown", function (e) {
				e.preventDefault(); e.stopPropagation();
				_this._hideMenu();
				_this._doInsert(item.count);
			});
			_this._menuEl.appendChild(row);
		});

		this._outsideHandler = function (e) {
			if (_this._menuOpen &&
				_this._floatingEl && !_this._floatingEl.contains(e.target) &&
				_this._menuEl && !_this._menuEl.contains(e.target)) {
				_this._hideMenu();
			}
		};
		document.addEventListener("mousedown", this._outsideHandler);
	};

	DingTalkColumnsPlugin.prototype._attach = function () {
		try {
			var mdView = this.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
			if (!mdView) { this._hide(); return; }
			var el = getEditorEl(mdView);
			if (!el) { this._hide(); return; }
			var needsAppend = (el !== this._editorEl) ||
				!this._floatingEl.parentNode || !this._menuEl.parentNode;
			if (!needsAppend) return;
			this._editorEl = el;
			el.appendChild(this._floatingEl);
			el.appendChild(this._menuEl);
		} catch (e) {}
	};

	DingTalkColumnsPlugin.prototype._reposition = function () {
		try {
			if (_activeEditCol) return;
			var mdView = this.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
			if (!mdView || !mdView.editor) { this._hide(); return; }
			var editor = mdView.editor;
			var cur = editor.getCursor();
			var lineText = editor.getLine(cur.line);
			if (lineText.trim() !== "") { this._hide(); return; }
			var edEl = getEditorEl(mdView);
			if (!edEl) { this._hide(); return; }
			this._attach();
			var coords = getCursorCoords(edEl, mdView);
			if (!coords) { this._hide(); return; }
			this._show(Math.max(4, coords.x - 30), coords.y);
		} catch (e) { this._hide(); }
	};

	DingTalkColumnsPlugin.prototype._show = function (x, y) {
		this._floatingEl.style.left = x + "px";
		this._floatingEl.style.top = y + "px";
		this._floatingEl.style.display = "flex";
	};

	DingTalkColumnsPlugin.prototype._hide = function () {
		if (this._floatingEl) this._floatingEl.style.display = "none";
		this._hideMenu();
	};

	DingTalkColumnsPlugin.prototype._toggleMenu = function () {
		this._menuOpen ? this._hideMenu() : this._showMenu();
	};

	DingTalkColumnsPlugin.prototype._showMenu = function () {
		try {
			var bRect = this._floatingEl.getBoundingClientRect();
			var pRect = this._editorEl ? this._editorEl.getBoundingClientRect() : bRect;
			this._menuEl.style.left = (bRect.left - pRect.left) + "px";
			this._menuEl.style.top = (bRect.bottom - pRect.top + 4) + "px";
			this._menuEl.style.display = "block";
			this._menuOpen = true;
			var m = this._menuEl;
			requestAnimationFrame(function () { m.classList.add("dt-floating-menu--visible"); });
		} catch (e) {}
	};

	DingTalkColumnsPlugin.prototype._hideMenu = function () {
		try {
			if (this._menuEl) {
				this._menuEl.classList.remove("dt-floating-menu--visible");
				this._menuEl.style.display = "none";
			}
			this._menuOpen = false;
		} catch (e) {}
	};

	DingTalkColumnsPlugin.prototype._doInsert = function (count) {
		try {
			var mdView = this.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
			if (!mdView || !mdView.editor) return;
			insertColumnsBlock(mdView.editor, count);
			this._hide();
		} catch (e) {}
	};

	return DingTalkColumnsPlugin;
}(obsidian.Plugin));

/* =============================================================
   Code-block Post-processor
   ============================================================= */

function parseColumns(src) {
	return src.split(COL_SEP).map(function (s) { return s.trim(); });
}

var _activeEditCol = null;
var _syncTimer = null;

/**
 * 拖拽会话：原先散在 4 个 var 里，跨进程拖拽不会触发 dragstart，旧值不会自动清，
 * 是「花瓣首次拖拽失败」一类回归的根因。封到一个对象里，统一 begin/clear。
 */
var _dragSession = {
	ref: null,         /* `_draggingMedia` */
	fileName: null,    /* `_draggedFileName` */
	line: -1,          /* `_dragSourceLine` */
	raw: ""            /* `_dragSourceRaw` */
};
function beginDragSession(ref, fileName, line, raw) {
	_dragSession.ref = ref || null;
	_dragSession.fileName = fileName || null;
	_dragSession.line = (typeof line === "number") ? line : -1;
	_dragSession.raw = raw || "";
}
function clearDragSession() {
	_dragSession.ref = null;
	_dragSession.fileName = null;
	_dragSession.line = -1;
	_dragSession.raw = "";
}

/**
 * 鼠标坐标：仅用于 paste 兜底定位，rAF 节流避免 mousemove 高频赋值。
 */
var _dtMouse = { x: 0, y: 0, _pending: false, _nextX: 0, _nextY: 0 };

/**
 * 最近点击过的分栏，配合 paste 路由使用。
 */
var _lastColumn = { el: null, ts: 0 };

function findDtWrapperElement(columnEl) {
	var n = columnEl;
	while (n) {
		if (n.classList && n.classList.contains("dt-wrapper")) return n;
		n = n.parentElement;
	}
	return null;
}

/**
 * 是否是「笔记内 wikilink 引用」(![[file.ext]])，独立函数避免在 drop 路径里
 * 用 parseMediaRef 来判（parseMediaRef 还会匹配 http(s) URL，会误判）。
 * 用于：drop 时即便同时存在 text/html (Obsidian 内部拖拽常这样)，只要 captured/plain
 * 是 wikilink 就当成笔记内拖拽，跳过远程下载兜底，否则同笔记内的视频/图片永远拖不进。
 */
function isInternalWikilinkRef(raw) {
	if (!raw) return false;
	var s = String(raw).trim();
	if (!s) return false;
	return /^!\[\[[^\]\r\n]+\]\]$/.test(s);
}

/**
 * 跨进程从浏览器拖入时不会触发我们的 dragstart，_dragSession 可能是残留；
 * 在外部拖拽进入分栏时清零，避免第一次 drop 误走「笔记内拖放」分支。
 */
function resetInternalDragStateIfExternal(dt) {
	if (!dt) return;
	var types = dt.types ? Array.from(dt.types) : [];
	var looksExt = false;
	for (var ti = 0; ti < types.length; ti++) {
		var s = String(types[ti]).toLowerCase();
		if (s === "files" || s === "text/uri-list" || s === "text/html") { looksExt = true; break; }
		if (s.indexOf("image") >= 0 || s.indexOf("downloadurl") >= 0) { looksExt = true; break; }
	}
	if (!looksExt && dt.items && dt.items.length > 0) {
		for (var ij = 0; ij < dt.items.length; ij++) {
			var it = dt.items[ij];
			if (!it) continue;
			if (it.kind === "file") { looksExt = true; break; }
			var mt = String(it.type || "").toLowerCase();
			if (mt.indexOf("image") >= 0 || mt.indexOf("html") >= 0 || mt.indexOf("video") >= 0) {
				looksExt = true;
				break;
			}
		}
	}
	if (looksExt) clearDragSession();
}

/**
 * drop 时刻判断：是否更像「浏览器 / 系统」拖入（用于否定残留的 capturedRef）。
 */
function dataTransferLooksExternal(dt) {
	if (!dt) return false;
	if (dt.files && dt.files.length > 0) return true;
	var types = dt.types ? Array.from(dt.types) : [];
	for (var i = 0; i < types.length; i++) {
		var s = String(types[i]).toLowerCase();
		if (s === "text/html" || s === "text/uri-list" || s === "files") return true;
		if (s.indexOf("image") >= 0) return true;
	}
	if (dt.items && dt.items.length) {
		for (var j = 0; j < dt.items.length; j++) {
			var it = dt.items[j];
			if (!it) continue;
			if (it.kind === "file") return true;
			var mt = String(it.type || "").toLowerCase();
			if (mt.indexOf("image") >= 0 || mt.indexOf("video") >= 0) return true;
		}
	}
	try {
		var plain = (dt.getData("text/plain") || "").trim();
		if (plain && /^https?:\/\//i.test(plain) && !/\s/.test(plain)) return true;
		var html = dt.getData("text/html");
		if (html && /<img\b/i.test(html)) return true;
		var urilist = (dt.getData("text/uri-list") || "").trim();
		if (urilist && /^https?:\/\//i.test(urilist.split(/\r?\n/).filter(function (x) { return x && !x.startsWith("#"); })[0] || "")) return true;
	} catch (e) {}
	return false;
}

/**
 * 不靠开发者工具：弹 Notice 让用户看见剪贴板与分栏状态。
 */
function diagnoseDtColumnsClipboard() {
	var rows = [];
	rows.push("—— picote · 剪贴板检查（v" + DT_COLUMNS_VER + "）——");
	try {
		var req = typeof require !== "undefined" ? require : null;
		var elc = req ? req("electron") : null;
		if (elc && elc.clipboard) {
			var fm = elc.clipboard.availableFormats();
			var fmShort = fm && fm.slice ? fm.slice(0, 14) : [];
			rows.push("剪贴板里当前有的格式：" + JSON.stringify(fmShort));
			var ni = elc.clipboard.readImage();
			var hasBmp = !!(ni && typeof ni.isEmpty === "function" && !ni.isEmpty());
			rows.push("是否像「整张贴图」：" + (hasBmp ? "是，可以直接 Ctrl+V" : "否，请先复制图片再试"));
		} else {
			rows.push("读不到系统剪贴板（少见，可重启 Obsidian 再试）");
		}
	} catch (e1) {
		rows.push("读剪贴板出错：" + String(e1 && e1.message || e1));
	}
	try {
		rows.push(document.querySelector(".dt-column") ? "这一页：能看到分栏 ✓" : "这一页：还没看到分栏（先插入分栏代码块并预览）");
	} catch (e2) {
		rows.push("无法判断当前页有没有分栏");
	}
	try {
		var hi = document.elementFromPoint(_dtMouse.x, _dtMouse.y);
		rows.push(hi && hi.closest && hi.closest(".dt-column") ? "鼠标指针下面：在分栏格子上 ✓" : "鼠标指针下面：不在分栏上（把鼠标移到紫色格子里再检查）");
	} catch (e3) { rows.push("无法读取鼠标位置"); }
	try {
		if (_lastColumn.el && document.body.contains(_lastColumn.el)) {
			var sec = Math.floor((Date.now() - _lastColumn.ts) / 1000);
			rows.push("你最近点过分栏：" + sec + " 秒内有效 ✓");
		} else rows.push("请先「在某一栏里点一下」再运行本检查");
	} catch (e4) {}
	try { console.info("DTC diagn\n" + rows.join("\n")); } catch (e6) {}
	try {
		new obsidian.Notice(rows.join("\n"), 22000);
	} catch (e5) {}
}

function clipboardLooksLikeMediaPaste(cb) {
	if (!cb) return false;

	var typesArr = cb.types ? Array.from(cb.types) : [];
	for (var ti = 0; ti < typesArr.length; ti++) {
		var tName = String(typesArr[ti]).toLowerCase();
		if (tName.indexOf("image") >= 0) return true;
	}

	try {
		if (tryReadElectronClipboardImageAsFile()) return true;
	} catch (e0) {}
	if (cb.files && cb.files.length > 0) {
		for (var fi = 0; fi < cb.files.length; fi++) {
			var f = cb.files[fi];
			if (f.type && (f.type.startsWith("image/") || f.type.startsWith("video/"))) return true;
		}
	}
	var items = cb.items;
	if (items) {
		for (var ii = 0; ii < items.length; ii++) {
			var it = items[ii];
			if (!it || it.kind !== "file") continue;
			var mime = it.type || "";
			if (mime.startsWith("image/") || mime.startsWith("video/")) return true;
		}
	}
	var html = cb.getData("text/html");
	if (html && /<img\b/i.test(html)) return true;
	if (html && html.length > 15 && extractImageFromHtml(html)) return true;
	var text = (cb.getData("text/plain") || "").trim();
	if (!text) return false;
	if (/^data:image\//i.test(text)) return true;
	var ref = parseMediaRef(text);
	if (ref && ref.isUrl) return true;
	if (isExternalUrl(text) && !/\s/.test(text)) return true;
	return false;
}

function resolveTargetColumnForPaste() {
	if (_lastColumn.el && !document.body.contains(_lastColumn.el)) {
		_lastColumn.el = null;
		_lastColumn.ts = 0;
	}

	var under = null;
	try {
		var topEl = document.elementFromPoint(_dtMouse.x, _dtMouse.y);
		under = topEl && topEl.closest ? topEl.closest(".dt-column") : null;
	} catch (e1) {}
	if (under) return under;
	if (_lastColumn.el && document.body.contains(_lastColumn.el)) {
		if (Date.now() - _lastColumn.ts < 180000) return _lastColumn.el;
	}
	return null;
}

/**
 * 分栏粘贴核心逻辑（供 .dt-column 自身 与 document 捕获转发共用）
 */
function processPasteIntoColumn(cb, columns, colIdx, wrapperEl, plugin) {
	if (!cb || !wrapperEl || !plugin) return false;

	var handled = false;

	if (cb.files && cb.files.length > 0) {
		for (var fi = 0; fi < cb.files.length; fi++) {
			var f = cb.files[fi];
			if (f.type && (f.type.startsWith("image/") || f.type.startsWith("video/"))) {
				handleClipboardFile(f, columns, colIdx, wrapperEl, plugin);
				handled = true;
				break;
			}
		}
	}

	if (!handled) {
		var items = cb.items;
		if (items) {
			for (var ii = 0; ii < items.length; ii++) {
				var it = items[ii];
				if (!it || it.kind !== "file") continue;
				var blob = it.getAsFile();
				if (blob && blob.type && (blob.type.startsWith("image/") || blob.type.startsWith("video/"))) {
					handleClipboardFile(blob, columns, colIdx, wrapperEl, plugin);
					handled = true;
					break;
				}
			}
		}
	}

	if (!handled) {
		var nativeImg = tryReadElectronClipboardImageAsFile();
		if (nativeImg) {
			handleClipboardFile(nativeImg, columns, colIdx, wrapperEl, plugin);
			handled = true;
		}
	}

	if (!handled) {
		var html = cb.getData("text/html");
		var imgUrl = html ? extractImageFromHtml(html) : null;
		if (imgUrl) {
			if (/^data:image\//i.test(imgUrl)) {
				handleDataUriImage(imgUrl, columns, colIdx, wrapperEl, plugin);
				handled = true;
			} else if (/^https?:\/\//i.test(imgUrl)) {
				insertRemoteMedia(imgUrl, columns, colIdx, wrapperEl, plugin);
				handled = true;
			}
		}
	}

	if (!handled) {
		var text = (cb.getData("text/plain") || "").trim();
		if (text) {
			if (/^data:image\//i.test(text)) {
				handleDataUriImage(text, columns, colIdx, wrapperEl, plugin);
				handled = true;
			} else {
				var mediaRef = parseMediaRef(text);
				if (mediaRef && mediaRef.isUrl) {
					insertRemoteMedia(mediaRef.file, columns, colIdx, wrapperEl, plugin);
					handled = true;
				} else if (mediaRef && !mediaRef.isUrl) {
					appendToColumn(columns, colIdx, text);
					buildContainer(columns, wrapperEl, wrapperEl._dtCtx, plugin, true);
					debouncedSync(wrapperEl);
					handled = true;
				} else if (isExternalUrl(text) && !/\s/.test(text)) {
					appendToColumn(columns, colIdx, text);
					buildContainer(columns, wrapperEl, wrapperEl._dtCtx, plugin, true);
					debouncedSync(wrapperEl);
					var mdV = plugin.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
					var tf = mdV && mdV.file ? mdV.file : null;
					maybeUpgradeUrlToImageInBackground(plugin, text, tf);
					handled = true;
				} else {
					document.execCommand("insertText", false, text);
					handled = true;
				}
			}
		}
	}

	return handled;
}

function buildContainer(columns, el, ctx, plugin, force) {
	/* R2-4：旧实现用模块级 `_skipRebuild`，多分栏笔记会互相吞 rebuild。
	 * 改挂在 wrapper 实例上，互不干扰。
	 * force=true 用于「来自插件内部 的用户动作（拖入/粘贴/点击插入列/删除媒体/Enter…）」，
	 * 它们必须能刷新 UI；只有 markdown post-processor 等「外部」回调走默认 skipRebuild 检查，
	 * 这样编辑过程中 syncToSource 异步触发的 rebuild 不会销毁正在编辑的格子。 */
	if (!force && el && el._dtSkipRebuild && el._dtBuilt) return;

	el.empty();
	el.addClass("dt-wrapper");
	el._dtCtx = ctx;
	el._dtColumns = columns;
	el._dtPlugin = plugin;
	el._dtBuilt = true;

	var container = el.createDiv({ cls: "dt-container" });
	var colCount = columns.length;

	columns.forEach(function (text, idx) {
		if (idx > 0 && colCount < MAX_COLUMNS) {
			container.appendChild(
				makeInserter(container, columns, el, idx, plugin, colCount)
			);
		}

		var col = container.createDiv({ cls: "dt-column" });
		col.setAttribute("data-col-index", String(idx));

		renderColumnContent(col, text, plugin);

		bindColumnEvents(col, columns, idx, el, plugin);
		bindDragDrop(col, columns, idx, el, plugin);
	});

	if (colCount < MAX_COLUMNS) {
		container.appendChild(
			makeInserter(container, columns, el, columns.length, plugin, colCount)
		);
	}

	var badge = document.createElement("div");
	badge.className = "dt-column-count";
	badge.textContent = colCount + "/" + MAX_COLUMNS;
	if (colCount >= MAX_COLUMNS) badge.classList.add("dt-column-count--full");
	container.appendChild(badge);
	["mousedown", "pointerdown", "click", "dblclick"].forEach(function (evName) {
		badge.addEventListener(evName, function (e) {
			e.stopPropagation();
		});
	});

	scheduleCleanupStrayFences(el);
}

/**
 * Live Preview 下 CM 偶尔把闭合围栏 ``` 渲染成分栏下方「孤零零一行三个点」，用户以为多了一段内容。
 *
 * 2.3.4 修复：
 *  - 旧版本判定过于保守：限制了 children.length <= 4、扫描步数 28、仅延时几次；
 *    在「视频 + 文字」分栏下，DOM 重排往往晚于这些延时窗口，孤零零的 ``` 漏网。
 *  - 现改为：
 *      1) 仅依据 textContent 是否「只剩反引号」判定，不再受子元素数量限制；
 *      2) 扫描范围扩大到 200 步，并向上回溯到最近的 .cm-embed-block / .markdown-preview-section；
 *      3) 在 wrapper 父级挂 MutationObserver，新插入的纯围栏行立即隐藏，无需依赖固定延时。
 */
function isNodeOnlyFenceText(el) {
	if (!el || el.nodeType !== 1) return false;
	/* 已隐藏过的节点直接跳过，避免重复打 class */
	if (el.classList && el.classList.contains("dt-stray-fence-hidden")) return false;
	/* 不能误伤插件自身渲染的容器 */
	if (el.classList && (
		el.classList.contains("dt-wrapper") ||
		el.classList.contains("dt-container") ||
		el.classList.contains("dt-column") ||
		el.classList.contains("dt-floating-trigger") ||
		el.classList.contains("dt-floating-menu")
	)) return false;
	if (el.closest && el.closest(".dt-wrapper, .dt-floating-menu, .dt-floating-trigger")) return false;

	var txt = String(el.textContent || "")
		.replace(/\u00a0/g, " ")
		.replace(/\u200b/g, "")
		.replace(/\s+/g, " ")
		.trim();
	if (!txt) return false;
	/* 只匹配「纯闭合围栏」行，不误伤 ```js 这类开场围栏格 */
	return /^`{3,}\s*$/.test(txt);
}

function hideStrayFenceNode(node) {
	if (!node || !node.classList) return;
	if (node.classList.contains("dt-stray-fence-hidden")) return;
	try {
		node.style.display = "none";
		node.classList.add("dt-stray-fence-hidden");
		node.setAttribute("aria-hidden", "true");
	} catch (e) {}
}

function cleanupStrayFenceNearWrapper(wrapperEl) {
	try {
		if (!wrapperEl) return;
		var hidden = 0;
		var maxHide = 8;
		var maxStepsPerScan = 200;

		function scanFrom(start) {
			var cur = start;
			var limit = 0;
			while (cur && hidden < maxHide && limit++ < maxStepsPerScan) {
				if (isNodeOnlyFenceText(cur)) {
					hideStrayFenceNode(cur);
					hidden++;
				}
				cur = cur.nextElementSibling;
			}
		}

		/* 1) 直接兄弟链 */
		scanFrom(wrapperEl.nextElementSibling);

		/* 2) 向上回溯：处理被包到 .cm-embed-block / .markdown-rendered / .cm-line 之类祖先里的情况
		 *    最多回溯到 .cm-editor / .markdown-preview-section / body，超过就停。 */
		var anc = wrapperEl.parentElement;
		var hopGuard = 0;
		while (anc && hopGuard++ < 8) {
			scanFrom(anc.nextElementSibling);
			if (
				anc.classList && (
					anc.classList.contains("cm-editor") ||
					anc.classList.contains("markdown-preview-section") ||
					anc.classList.contains("markdown-preview-view") ||
					anc === document.body
				)
			) break;
			anc = anc.parentElement;
		}

		/* 3) 同父中 wrapperEl 之后的所有兄弟（覆盖被遗漏的、非紧邻的情况） */
		var par = wrapperEl.parentElement;
		if (par) {
			var seenWrapper = false;
			var ch = par.firstElementChild;
			while (ch) {
				if (ch === wrapperEl) {
					seenWrapper = true;
					ch = ch.nextElementSibling;
					continue;
				}
				if (seenWrapper && hidden < maxHide) {
					if (isNodeOnlyFenceText(ch)) {
						hideStrayFenceNode(ch);
						hidden++;
					}
				}
				ch = ch.nextElementSibling;
			}
		}
	} catch (e) {}
}

/**
 * 在 wrapper 父级挂 MutationObserver，无论 CM 何时把闭合围栏渲染出来都能秒杀。
 * 同一个 wrapper 只挂一次；wrapper 自身离开 DOM 时自动解绑。
 */
function ensureStrayFenceObserver(wrapperEl) {
	if (!wrapperEl) return;
	if (wrapperEl._dtStrayObserver) return;

	var target =
		(wrapperEl.closest && wrapperEl.closest(".cm-embed-block")) ||
		wrapperEl.parentElement ||
		(wrapperEl.closest && wrapperEl.closest(".cm-editor, .markdown-preview-section")) ||
		document.body;
	if (!target) return;

	try {
		var obs = new MutationObserver(function () {
			if (!wrapperEl.isConnected) {
				try { obs.disconnect(); } catch (eD) {}
				wrapperEl._dtStrayObserver = null;
				return;
			}
			cleanupStrayFenceNearWrapper(wrapperEl);
		});
		obs.observe(target, { childList: true, subtree: true, characterData: true });
		wrapperEl._dtStrayObserver = obs;
	} catch (e) {}
}

function scheduleCleanupStrayFences(wrapperEl) {
	if (!wrapperEl) return;
	/* 立即跑一次 + 多档延时兜住 CM 异步重排 */
	cleanupStrayFenceNearWrapper(wrapperEl);
	var delays = [0, 24, 64, 140, 280, 520, 880, 1400];
	for (var di = 0; di < delays.length; di++) {
		(function (ms) {
			setTimeout(function () {
				cleanupStrayFenceNearWrapper(wrapperEl);
			}, ms);
		})(delays[di]);
	}
	try {
		requestAnimationFrame(function () {
			cleanupStrayFenceNearWrapper(wrapperEl);
		});
	} catch (eR) {}
	/* 长期监听：之后任何 DOM 改动（拖图、删图、滚动到视口、CM 重排）都会自动复查 */
	ensureStrayFenceObserver(wrapperEl);
}

/* =============================================================
   旧版独立的 renderTextColumn / renderMedia 已并入 renderColumnContent，删除避免误用。
   ============================================================= */

function openVideoPlayer(url, plugin) {
	var overlay = document.createElement("div");
	overlay.className = "dt-video-overlay";

	var wrap = document.createElement("div");
	wrap.className = "dt-video-player-wrap";

	var video = document.createElement("video");
	video.className = "dt-video-player";
	video.src = url;
	video.controls = true;
	video.autoplay = true;
	wrap.appendChild(video);

	var closeBtn = document.createElement("div");
	closeBtn.className = "dt-video-close";
	closeBtn.innerHTML = "&times;";
	closeBtn.addEventListener("click", function () {
		video.pause();
		overlay.remove();
	});
	wrap.appendChild(closeBtn);

	overlay.appendChild(wrap);
	overlay.addEventListener("click", function (e) {
		if (e.target === overlay) {
			video.pause();
			overlay.remove();
		}
	});

	document.body.appendChild(overlay);
}

/* =============================================================
   Unified Column Renderer — text + media mixed
   ============================================================= */

function renderColumnContent(col, rawContent, plugin) {
	col.setAttribute("contenteditable", "true");
	col.setAttribute("spellcheck", "false");
	col.setAttribute("tabindex", "0");
	col.classList.add("dt-column--text");

	if (!rawContent || rawContent.trim() === "") {
		col.setAttribute("data-placeholder", "输入文字，或拖入图片/视频…");
		return;
	}

	col.removeAttribute("data-placeholder");

	var parts = rawContent.split("<br>");
	parts.forEach(function (part, i) {
		var trimmed = part.trim();

		if (!trimmed) {
			if (i > 0) col.appendChild(document.createElement("br"));
			return;
		}

		var media = parseMediaRef(trimmed);
		if (media) {
			var url;
			if (media.isUrl || isExternalUrl(media.file)) {
				url = media.file;
			} else {
				var vaultPath = findVaultFile(plugin, media.file);
				url = getVaultResourceUrl(plugin, vaultPath);
			}

			if (media.type === "image") {
				var img = document.createElement("img");
				img.className = "dt-media-img";
				img.src = url;
				img.alt = media.file;
				img.setAttribute("data-media-ref", trimmed);
				img._dtMediaRef = trimmed;
				img.draggable = false;
				if (media.isUrl) {
					img.setAttribute("referrerpolicy", "no-referrer");
				}
				img.addEventListener("error", function () {
					img.style.display = "none";
					var fallback = document.createElement("span");
					fallback.className = "dt-media-fallback";
					fallback.textContent = "图片加载失败: " + media.file;
					if (img.nextSibling) {
						col.insertBefore(fallback, img.nextSibling);
					} else {
						col.appendChild(fallback);
					}
				});
				img.addEventListener("mousedown", function (ev) {
					ev.preventDefault();
					ev.stopPropagation();
				});
				img.addEventListener("click", function (ev) {
					ev.preventDefault();
					ev.stopPropagation();
					selectMediaInColumn(col, img);
				});

				/* 本地 ![[...]] 与远程 URL 一律套工具层：始终可见「下载 / 导出」按钮 */
				var imgWrap = document.createElement("span");
				imgWrap.className = "dt-img-toolbar-wrap";
				imgWrap.setAttribute("contenteditable", "false");
				imgWrap.appendChild(img);

				var dlBtn = document.createElement("button");
				dlBtn.type = "button";
				dlBtn.className = "dt-img-download-btn";
				dlBtn.setAttribute("aria-label", media.isUrl ? "下载到笔记" : "导出图片");
				dlBtn.title = media.isUrl
					? "下载到 vault（assets）并替换为本地引用"
					: "导出到系统下载文件夹";
				dlBtn.innerHTML =
					'<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" ' +
					'viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
					'stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
					'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>' +
					'<polyline points="7 10 12 15 17 10"/>' +
					'<line x1="12" y1="15" x2="12" y2="3"/></svg>';
				(function (capturedUrl, capturedRef, isRemote) {
					dlBtn.addEventListener("mousedown", function (ev) {
						ev.preventDefault();
						ev.stopPropagation();
					});
					dlBtn.addEventListener("click", function (ev) {
						ev.preventDefault();
						ev.stopPropagation();
						if (isRemote) {
							downloadRemoteImageToLocal(capturedUrl, capturedRef, plugin);
						} else {
							exportVaultWikiImageToDownloads(plugin, capturedRef);
						}
					});
				})(url, trimmed, !!(media.isUrl || isExternalUrl(media.file)));

				imgWrap.appendChild(dlBtn);
				col.appendChild(imgWrap);
			} else if (media.type === "video") {
				var wrapper = document.createElement("div");
				wrapper.className = "dt-video-thumb";
				wrapper.setAttribute("contenteditable", "false");
				wrapper._dtMediaRef = trimmed;
				wrapper.setAttribute("data-media-ref", trimmed);

				var vid = document.createElement("video");
				vid.className = "dt-video-preview";
				vid.src = url;
				vid.muted = true;
				vid.preload = "metadata";
				vid.addEventListener("loadeddata", function () {
					vid.currentTime = 1;
				});
				wrapper.appendChild(vid);

				var playBtn = document.createElement("div");
				playBtn.className = "dt-video-play-btn";
				playBtn.innerHTML =
					'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" ' +
					'viewBox="0 0 24 24" fill="white" stroke="none">' +
					'<polygon points="5,3 19,12 5,21"/></svg>';
				wrapper.appendChild(playBtn);

				(function (capturedUrl, capturedWrapper) {
					capturedWrapper.addEventListener("mousedown", function (ev) {
						ev.preventDefault();
						ev.stopPropagation();
					});
					capturedWrapper.addEventListener("click", function (ev) {
						ev.preventDefault();
						ev.stopPropagation();
						selectMediaInColumn(col, capturedWrapper);
					});
					capturedWrapper.addEventListener("dblclick", function (ev) {
						ev.preventDefault();
						ev.stopPropagation();
						openVideoPlayer(capturedUrl, plugin);
					});
					playBtn.style.pointerEvents = "auto";
					playBtn.style.cursor = "pointer";
					playBtn.addEventListener("mousedown", function (ev) {
						ev.stopPropagation();
					});
					playBtn.addEventListener("click", function (ev) {
						ev.preventDefault();
						ev.stopPropagation();
						openVideoPlayer(capturedUrl, plugin);
					});
				})(url, wrapper);

				col.appendChild(wrapper);
			}
		} else {
			col.appendChild(document.createTextNode(trimmed));
		}

		if (i < parts.length - 1) {
			col.appendChild(document.createElement("br"));
		}
	});
}

/**
 * 媒体 ref 必须**独占一整行**，否则下次 rebuild 时 parseMediaRef 锚点 `$` 失败，
 * 整行降级为纯文本，导致"图片消失只剩地址"。
 *
 * R1#2：以前这里维护了一对独立的简化正则，与 parseMediaRef 的 7 种识别形态不对偶
 * （URL 兜底 / IMG_HOST_RE / IMG_MD_LOOSE_RE 都识别不出），是「webp+文字」一类
 * 回归的潜在再发地。改为复用 parseMediaRef 作为唯一真源。
 */
function isMediaRefToken(token) {
	if (!token || token === "<br>") return false;
	var t = String(token).trim();
	if (!t) return false;
	return parseMediaRef(t) != null;
}

function divIsEmptyOrSingleBr(node) {
	if (!node || node.nodeType !== 1) return false;
	var name = node.nodeName;
	if (name !== "DIV" && name !== "P") return false;
	var ch = node.childNodes;
	if (ch.length === 0) return true;
	if (ch.length === 1) {
		var c0 = ch[0];
		if (c0.nodeName === "BR") return true;
		if (c0.nodeType === 3 && !String(c0.textContent || "").replace(/\u00a0/g, " ").trim()) return true;
	}
	return false;
}

function divHasOnlyMediaChild(node) {
	if (!node || node.nodeType !== 1 || node.childNodes.length !== 1) return false;
	var c = node.childNodes[0];
	if (c.nodeName === "IMG") return true;
	if (c.nodeType === 1 && c.classList && c.classList.contains("dt-img-toolbar-wrap")) return true;
	if (c.nodeType === 1 && c.classList && c.classList.contains("dt-video-thumb")) return true;
	return false;
}

function serializeColumnContent(col) {
	var result = [];

	function pushToken(token) {
		if (token == null) return;
		var prev = result.length ? result[result.length - 1] : "";
		if (prev && prev !== "<br>" && token !== "<br>") {
			if (isMediaRefToken(prev) || isMediaRefToken(token)) {
				result.push("<br>");
			}
		}
		result.push(token);
	}

	function walk(node) {
		if (node.nodeType === 3) {
			var t = node.textContent;
			if (t && t.length > 0) pushToken(t);
		} else if (node.nodeName === "BR") {
			result.push("<br>");
		} else if (node.nodeName === "IMG") {
			var ref = node._dtMediaRef || node.getAttribute("data-media-ref");
			if (ref) pushToken(ref);
		} else if (node.classList && node.classList.contains("dt-video-thumb")) {
			var vRef = node._dtMediaRef || node.getAttribute("data-media-ref");
			if (vRef) pushToken(vRef);
		} else if (node.classList && node.classList.contains("dt-media-fallback")) {
			/* skip fallback elements */
		} else if (node.classList && node.classList.contains("dt-img-toolbar-wrap")) {
			var rImg = node.querySelector("img.dt-media-img");
			if (rImg) {
				var rRef = rImg._dtMediaRef || rImg.getAttribute("data-media-ref");
				if (rRef) pushToken(rRef);
			}
		} else if (node.nodeType === 1) {
			if (node.nodeName === "DIV" || node.nodeName === "P") {
				/* contenteditable 常见：<div><br></div> 被旧逻辑序列化成 <br><br>，失焦写回后另一栏会「多出空行」 */
				if (divIsEmptyOrSingleBr(node)) {
					result.push("<br>");
					return;
				}
				if (divHasOnlyMediaChild(node)) {
					for (var im = 0; im < node.childNodes.length; im++) {
						walk(node.childNodes[im]);
					}
					return;
				}
				result.push("<br>");
				for (var i = 0; i < node.childNodes.length; i++) {
					walk(node.childNodes[i]);
				}
				return;
			}
			for (var j = 0; j < node.childNodes.length; j++) {
				walk(node.childNodes[j]);
			}
		}
	}

	for (var k = 0; k < col.childNodes.length; k++) {
		walk(col.childNodes[k]);
	}

	var text = result.join("");
	text = text.replace(/^(<br>)+|(<br>)+$/g, "");
	text = text.replace(/(<br>){3,}/g, "<br><br>");
	return text;
}

function appendToColumn(columns, colIdx, newRef) {
	var existing = columns[colIdx] ? columns[colIdx].trim() : "";
	columns[colIdx] = existing ? existing + "<br>" + newRef : newRef;
}

/**
 * 在分栏内当前光标处插入换行：手动用 Range API，避免 execCommand("insertLineBreak")
 * 在「contenteditable 嵌 contenteditable」(分栏在 .cm-content 内) 环境下的不稳定行为，
 * 防止 Enter 之后焦点落到 CodeMirror 主编辑器，造成「后续输入跑到分栏外面」。
 */
function insertBrInColumnAtCaret(col) {
	if (!col) return;
	col.focus();
	var sel = window.getSelection();
	var range;
	if (!sel || sel.rangeCount === 0 || !col.contains(sel.getRangeAt(0).startContainer)) {
		range = document.createRange();
		range.selectNodeContents(col);
		range.collapse(false);
		if (sel) {
			sel.removeAllRanges();
			sel.addRange(range);
		}
	} else {
		range = sel.getRangeAt(0);
		range.deleteContents();
	}

	var br = document.createElement("br");
	range.insertNode(br);

	/* 末尾插 BR 时浏览器不会自动给一个「锚定换行」，需要再补一个 BR 才能让光标落在新空行上 */
	var needPad = false;
	var next = br.nextSibling;
	if (!next) needPad = true;
	else if (next.nodeType === 1 && next.nodeName === "BR" &&
		(!next.nextSibling || (next.nextSibling.nodeType === 3 && !next.nextSibling.textContent.trim()))) {
		needPad = true;
	} else if (next.nodeType === 3 && !next.textContent.replace(/\u00a0/g, "").trim() && !next.nextSibling) {
		needPad = true;
	}

	var caretAnchor = br;
	if (needPad) {
		var pad = document.createElement("br");
		br.parentNode.insertBefore(pad, br.nextSibling);
		caretAnchor = pad;
	}

	try {
		var r2 = document.createRange();
		r2.setStartBefore(caretAnchor);
		r2.collapse(true);
		if (sel) {
			sel.removeAllRanges();
			sel.addRange(r2);
		}
	} catch (eR) {}

	try {
		if (caretAnchor && caretAnchor.scrollIntoView) {
			caretAnchor.scrollIntoView({ block: "nearest", inline: "nearest" });
		}
	} catch (eS) {}
}

/**
 * 紧跟在图片/视频后的可编辑尾部：单独一张图时浏览器往往把选区落在图上，
 * 用户看不到「图片下方」光标；末尾强制补一行 <br> 作为打字锚点。
 */
function ensureEditableTailAfterMedia(col) {
	if (!col) return;
	var last = col.lastChild;
	if (!last) return;
	function isMediaTail(node) {
		if (!node || node.nodeType !== 1) return false;
		if (node.nodeName === "IMG") return true;
		if (node.classList && node.classList.contains("dt-img-toolbar-wrap")) return true;
		if (node.classList && node.classList.contains("dt-video-thumb")) return true;
		return false;
	}
	if (!isMediaTail(last)) return;
	col.appendChild(document.createElement("br"));
}

/**
 * 拖入图片/视频后把光标落到分栏末尾（即图片下方），用户可直接输入文字。
 */
function focusColumnAtEnd(wrapperEl, colIdx) {
	if (!wrapperEl) return;
	requestAnimationFrame(function () {
		requestAnimationFrame(function () {
			setTimeout(function () {
				try {
					var container = wrapperEl.querySelector(".dt-container");
					if (!container) return;
					var col = container.querySelector('.dt-column[data-col-index="' + colIdx + '"]');
					if (!col) return;
					ensureEditableTailAfterMedia(col);
					col.focus();
					var range = document.createRange();
					range.selectNodeContents(col);
					range.collapse(false);
					var sel = window.getSelection();
					if (sel) {
						sel.removeAllRanges();
						sel.addRange(range);
					}
					try {
						var lc = col.lastChild;
						if (lc && lc.scrollIntoView) lc.scrollIntoView({ block: "nearest", inline: "nearest" });
					} catch (e2) {}
				} catch (e) {}
			}, 48);
		});
	});
}

/* =============================================================
   Media selection (click to select, Delete/Backspace to remove)
   ============================================================= */

function clearMediaSelectionInColumn(col) {
	if (!col) return;
	var sel = col.querySelectorAll(".dt-media--selected");
	for (var i = 0; i < sel.length; i++) sel[i].classList.remove("dt-media--selected");
}

function selectMediaInColumn(col, mediaEl) {
	clearMediaSelectionInColumn(col);
	if (mediaEl) mediaEl.classList.add("dt-media--selected");
	if (col && typeof col.focus === "function") col.focus();
}

function removeSelectedMediaInColumn(col, columns, colIdx, wrapperEl) {
	if (!col) return false;
	var media = col.querySelector(".dt-media--selected");
	if (!media) return false;

	/* 若在工具包裹层中，整个 wrap 一并删除 */
	var removeTarget = media;
	if (media.parentNode && media.parentNode.classList &&
		media.parentNode.classList.contains("dt-img-toolbar-wrap")) {
		removeTarget = media.parentNode;
	}

	var next = removeTarget.nextSibling;
	if (next && next.nodeName === "BR") {
		next.parentNode.removeChild(next);
	} else {
		var prev = removeTarget.previousSibling;
		if (prev && prev.nodeName === "BR") prev.parentNode.removeChild(prev);
	}
	removeTarget.parentNode.removeChild(removeTarget);

	var stored = serializeColumnContent(col);
	columns[colIdx] = stored;
	if (!stored.trim()) {
		col.setAttribute("data-placeholder", "输入文字，或拖入图片/视频…");
	}
	debouncedSync(wrapperEl);
	return true;
}

/* =============================================================
   Column Events
   ============================================================= */

function bindColumnEvents(col, columns, colIdx, wrapperEl, plugin) {

	col.addEventListener("mousedown", function (e) {
		e.stopPropagation();
	});
	col.addEventListener("pointerdown", function (e) {
		e.stopPropagation();
	});

	col.addEventListener("click", function (e) {
		e.stopPropagation();
		var container = col.parentElement;
		if (container) {
			var allCols = container.querySelectorAll(".dt-column");
			for (var ci = 0; ci < allCols.length; ci++) {
				if (allCols[ci] !== col) {
					allCols[ci].classList.remove("dt-column--selected");
					clearMediaSelectionInColumn(allCols[ci]);
				}
			}
		}
		var t = e.target;
		var clickedMedia = t && t.closest && t.closest(".dt-media-img, .dt-video-thumb");
		if (!clickedMedia) {
			clearMediaSelectionInColumn(col);
		}
		col.classList.add("dt-column--selected");
		col.focus();
	});

	col.addEventListener("keydown", function (e) {
		e.stopPropagation();

		if (e.key === "Enter" && !e.shiftKey) {
			/* 不能让 Enter 冒泡或走默认：嵌在 .cm-content 内的 contenteditable，default 行为常被 CM 吃成「源码换行」，导致后续输入跑到分栏外面 */
			e.preventDefault();
			try { e.stopImmediatePropagation(); } catch (sE) {}
			insertBrInColumnAtCaret(col);
			var storedEnter = serializeColumnContent(col);
			columns[colIdx] = storedEnter;
			if (storedEnter.trim() === "") {
				col.setAttribute("data-placeholder", "输入文字，或拖入图片/视频…");
			} else {
				col.removeAttribute("data-placeholder");
			}
			if (col._dtImeComposing) return;
			if (_syncTimer) clearTimeout(_syncTimer);
			_syncTimer = setTimeout(function () { debouncedSync(wrapperEl); }, 800);
			return;
		}

		if (e.key === "Delete" || e.key === "Backspace") {
			if (col.querySelector(".dt-media--selected")) {
				e.preventDefault();
				removeSelectedMediaInColumn(col, columns, colIdx, wrapperEl);
				return;
			}

			if (col.classList.contains("dt-column--selected")) {
				var hasOnlyMedia = !col.innerText.trim();
				var hasMedia = col.querySelector("img, .dt-video-thumb");
				if (hasOnlyMedia && hasMedia) {
					e.preventDefault();
					columns[colIdx] = "";
					buildContainer(columns, wrapperEl, wrapperEl._dtCtx, plugin, true);
					debouncedSync(wrapperEl);
					return;
				}
			}
		}

		if (e.key === "Escape") {
			if (col.querySelector(".dt-media--selected")) {
				e.preventDefault();
				clearMediaSelectionInColumn(col);
			}
		}
	});

	col.addEventListener("keyup", function (e) {
		e.stopPropagation();
	});

	/* 中文等 IME：组字过程中绝不能 syncToSource（会整块重渲染 contenteditable，打断组字并导致拼音错乱/重复） */
	col.addEventListener("compositionstart", function () {
		col._dtImeComposing = true;
		if (_syncTimer) {
			clearTimeout(_syncTimer);
			_syncTimer = null;
		}
	});
	col.addEventListener("compositionend", function () {
		col._dtImeComposing = false;
		var storedEnd = serializeColumnContent(col);
		columns[colIdx] = storedEnd;
		if (storedEnd.trim() === "") {
			col.setAttribute("data-placeholder", "输入文字，或拖入图片/视频…");
		} else {
			col.removeAttribute("data-placeholder");
		}
		if (_syncTimer) {
			clearTimeout(_syncTimer);
			_syncTimer = null;
		}
		_syncTimer = setTimeout(function () {
			debouncedSync(wrapperEl);
		}, 120);
	});

	col.addEventListener("input", function (e) {
		var stored = serializeColumnContent(col);
		columns[colIdx] = stored;

		if (stored.trim() === "") {
			col.setAttribute("data-placeholder", "输入文字，或拖入图片/视频…");
		} else {
			col.removeAttribute("data-placeholder");
		}

		if (col._dtImeComposing || (e && e.isComposing)) {
			if (_syncTimer) {
				clearTimeout(_syncTimer);
				_syncTimer = null;
			}
			return;
		}

		if (_syncTimer) clearTimeout(_syncTimer);
		_syncTimer = setTimeout(function () {
			debouncedSync(wrapperEl);
		}, 800);
	});

	col.addEventListener("focus", function () {
		_activeEditCol = col;
		col.removeAttribute("data-placeholder");
		var container = col.parentElement;
		if (container) {
			var allCols = container.querySelectorAll(".dt-column");
			for (var ci = 0; ci < allCols.length; ci++) {
				if (allCols[ci] !== col) allCols[ci].classList.remove("dt-column--selected");
			}
		}
		col.classList.add("dt-column--selected");
		/* 关键：编辑期间禁止 buildContainer 重建 DOM。否则 Obsidian 的 markdown post-processor
		 * 在 syncToSource 写回后会异步触发 buildContainer，el.empty() 一旦在用户敲字过程中触发，
		 * 焦点会丢到 CodeMirror，后续按键就变成「在源码里插字符 / 跑出分栏」。 */
		if (wrapperEl) wrapperEl._dtSkipRebuild = true;
	});

	col.addEventListener("blur", function () {
		/* Bug 8：拖入图片/视频到「已聚焦」的分栏时，buildContainer(force=true) 会 el.empty()
		 * 把当前列从 DOM 上摘下来，浏览器随即在这个**孤儿节点**上触发 blur。
		 * 旧实现继续 serializeColumnContent(col) 读到的是**重建前的旧内容**（不含刚刚 append 的
		 * 媒体引用），随后 columns[colIdx] = stored 把"text"反向盖回 wrapper 持有的 columns 数组上，
		 * 再走 debouncedSync 写回源码 → 用户看到的现象就是「图片/视频拖了一下就消失」。
		 * 所以只要这次 blur 来自一个已经被摘除的列，本次 blur 必须放弃所有"读 DOM → 写数组 →
		 * 写源码"的副作用，仅做最少的活动列清理。 */
		if (!col.isConnected) {
			if (_activeEditCol === col) _activeEditCol = null;
			col.classList.remove("dt-column--selected");
			return;
		}
		_activeEditCol = null;
		var stored = serializeColumnContent(col);
		columns[colIdx] = stored;
		if (stored.trim() === "") {
			col.setAttribute("data-placeholder", "输入文字，或拖入图片/视频…");
		}
		var blurAttempts = 0;
		function blurSyncWhenReady() {
			if (col._dtImeComposing && blurAttempts++ < 60) {
				setTimeout(blurSyncWhenReady, 50);
				return;
			}
			debouncedSync(wrapperEl);
			/* 比 debouncedSync 内部 600ms 多 50ms，给 CM 的 dispatch + 后处理留出整个窗口 */
			setTimeout(function () {
				if (wrapperEl && !_activeEditCol) wrapperEl._dtSkipRebuild = false;
			}, 650);
		}
		blurSyncWhenReady();
		col.classList.remove("dt-column--selected");
	});

	col.addEventListener("paste", function (e) {
		e.preventDefault();
		e.stopPropagation();
		var cb = e.clipboardData || window.clipboardData;
		if (!cb) return;
		processPasteIntoColumn(cb, columns, colIdx, wrapperEl, plugin);
	});
}

function debouncedSync(wrapperEl) {
	if (!wrapperEl) return;
	wrapperEl._dtSkipRebuild = true;
	syncToSource(wrapperEl);
	scheduleCleanupStrayFences(wrapperEl);
	setTimeout(function () {
		/* 仅当当前不再有任何 .dt-column 处于编辑状态时才允许清除 skipRebuild。
		 * 否则 markdown post-processor 异步回来时还能 rebuild，正在编辑的格子会被销毁，
		 * 焦点掉到 CodeMirror，后续按键就直接打在源码里（用户反馈：「编辑没完成就跑出去了」）。 */
		try {
			if (_activeEditCol && wrapperEl.contains(_activeEditCol)) return;
		} catch (eC) {}
		wrapperEl._dtSkipRebuild = false;
	}, 600);
}

/* =============================================================
   Inter-column Inserter
   ============================================================= */

function makeInserter(container, columns, wrapperEl, insertAt, plugin, currentCount) {
	var strip = document.createElement("div");
	strip.className = "dt-inserter";

	var vline = document.createElement("div");
	vline.className = "dt-inserter-line";
	strip.appendChild(vline);

	var btn = document.createElement("button");
	btn.className = "dt-inserter-btn";
	btn.setAttribute("aria-label", "添加分栏");
	btn.innerHTML =
		'<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" ' +
		'viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
		'stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' +
		'<line x1="12" y1="5" x2="12" y2="19"/>' +
		'<line x1="5" y1="12" x2="19" y2="12"/></svg>';

	btn.addEventListener("click", function (e) {
		e.preventDefault(); e.stopPropagation();
		var liveCount = container.querySelectorAll(".dt-column").length;
		if (liveCount >= MAX_COLUMNS) {
			new obsidian.Notice("已达到上限，最多 " + MAX_COLUMNS + " 个分栏");
			return;
		}
		columns.splice(insertAt, 0, "");
		buildContainer(columns, wrapperEl, wrapperEl._dtCtx, plugin, true);
		debouncedSync(wrapperEl);
	});

	["mousedown", "pointerdown", "click", "dblclick"].forEach(function (evName) {
		strip.addEventListener(evName, function (e) {
			e.stopPropagation();
		});
	});

	strip.appendChild(btn);
	return strip;
}

/* =============================================================
   Drag & Drop
   ============================================================= */

/**
 * Electron / Windows：有时 drop 当下 `dataTransfer.files` 仍为空，但 `items` 里已有 file。
 */
function getDroppedFileFromDataTransfer(dt) {
	if (!dt) return null;
	try {
		if (dt.files && dt.files.length > 0) return dt.files[0];
	} catch (e) {}
	if (dt.items && dt.items.length > 0) {
		for (var i = 0; i < dt.items.length; i++) {
			var it = dt.items[i];
			if (!it || it.kind !== "file") continue;
			try {
				var f = it.getAsFile();
				if (f) return f;
			} catch (e2) {}
		}
	}
	return null;
}

/**
 * 分栏投放统一入口：在 window 捕获阶段优先处理，避免 Obsidian 默认行为抢先写入笔记其它位置，
 * 造成「文件已进库但分栏无反应 / 要拖好几次」。
 */
function handleDtColumnDataDrop(e, col, plugin) {
	if (!col || !plugin) return;
	col.classList.remove("dt-column--dragover");
	var wrapperEl = findDtWrapperElement(col);
	if (!wrapperEl || wrapperEl._dtColumns == null) return;
	var columns = wrapperEl._dtColumns;
	var colIdx = parseInt(col.getAttribute("data-col-index") || "0", 10);
	if (isNaN(colIdx) || colIdx < 0 || colIdx >= columns.length) colIdx = 0;

	var dt = e.dataTransfer;
	if (!dt) return;

	/* 关键：drop 一定要让后续 buildContainer 真正重建出新格子。
	 * 之前一栏完成 drop / 编辑时可能把 wrapperEl._dtSkipRebuild 设成 true，
	 * 这会让「第二张图」之后的 buildContainer 直接 return，UI 不更新 → 拖了好像没反应。 */
	wrapperEl._dtSkipRebuild = false;
	if (_syncTimer) {
		try { clearTimeout(_syncTimer); } catch (eT) {}
		_syncTimer = null;
	}

	var capturedRef = _dragSession.ref;
	var capturedFn = _dragSession.fileName;
	var capturedLine = _dragSession.line;
	var capturedRaw = _dragSession.raw;
	clearDragSession();

	var dropPlain = (dt.getData("text/plain") || "").trim();
	var typesArr = dt.types ? Array.from(dt.types) : [];
	var hasHtml = typesArr.indexOf("text/html") >= 0;
	var dropHtml = hasHtml ? (dt.getData("text/html") || "") : "";

	var hasExternalEvidence = dataTransferLooksExternal(dt);

	/* Bug 8：当 capturedRef 是 wikilink (![[...]]) 时，必然来自当前 vault；
	 * 即便 dataTransfer 同时带了 text/html (hasExternalEvidence=true)，也不应否定 capturedRef。
	 * 不然从「当前笔记的视频/图片」拖到分栏会绕开本分支，落到 extractImageFromHtml / uri-list 兜底，
	 * 视频提取不出来就完全丢掉，用户看到的现象就是「同笔记内拖拽视频根本拖不进去」。 */
	if (capturedRef && (isInternalWikilinkRef(capturedRef) || !hasExternalEvidence)) {
		appendToColumn(columns, colIdx, capturedRef);
		buildContainer(columns, wrapperEl, wrapperEl._dtCtx, plugin, true);
		debouncedSync(wrapperEl);
		focusColumnAtEnd(wrapperEl, colIdx);
		scheduleErase(plugin, capturedLine, capturedRaw, capturedFn);
		return;
	}

	var plain = dropPlain;
	if (plain && (isInternalWikilinkRef(plain) || !hasExternalEvidence)) {
		var mediaRef = parseMediaRef(plain);
		if (mediaRef && !mediaRef.isUrl) {
			appendToColumn(columns, colIdx, plain);
			buildContainer(columns, wrapperEl, wrapperEl._dtCtx, plugin, true);
			debouncedSync(wrapperEl);
			focusColumnAtEnd(wrapperEl, colIdx);
			scheduleErase(plugin, capturedLine, capturedRaw, capturedFn || getBaseName(normalizeName(mediaRef.file)));
			return;
		}
	}

	var droppedFile = getDroppedFileFromDataTransfer(dt);
	if (droppedFile) {
		handleFileDrop(col, droppedFile, columns, colIdx, wrapperEl, plugin, capturedLine, capturedRaw, capturedFn);
		return;
	}

	var html = dropHtml || dt.getData("text/html");
	var imgFromHtml = html ? extractImageFromHtml(html) : null;
	if (imgFromHtml) {
		if (/^data:image\//i.test(imgFromHtml)) {
			handleDataUriImage(imgFromHtml, columns, colIdx, wrapperEl, plugin);
			focusColumnAtEnd(wrapperEl, colIdx);
			return;
		}
		if (/^https?:\/\//i.test(imgFromHtml)) {
			insertRemoteMedia(imgFromHtml, columns, colIdx, wrapperEl, plugin);
			focusColumnAtEnd(wrapperEl, colIdx);
			return;
		}
	}

	var uriList = (dt.getData("text/uri-list") || "").split(/\r?\n/).filter(function (s) {
		return s && !s.startsWith("#");
	});
	var firstUri = uriList[0] || "";
	if (firstUri && /^https?:\/\//i.test(firstUri)) {
		var refUri = parseMediaRef(firstUri);
		if (refUri && refUri.isUrl) {
			insertRemoteMedia(refUri.file, columns, colIdx, wrapperEl, plugin);
			focusColumnAtEnd(wrapperEl, colIdx);
			return;
		}
		appendToColumn(columns, colIdx, firstUri);
		buildContainer(columns, wrapperEl, wrapperEl._dtCtx, plugin, true);
		debouncedSync(wrapperEl);
		focusColumnAtEnd(wrapperEl, colIdx);
		var mdViewU = plugin.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
		var targetFileU = mdViewU && mdViewU.file ? mdViewU.file : null;
		maybeUpgradeUrlToImageInBackground(plugin, firstUri, targetFileU);
		return;
	}

	if (plain) {
		if (/^data:image\//i.test(plain)) {
			handleDataUriImage(plain, columns, colIdx, wrapperEl, plugin);
			focusColumnAtEnd(wrapperEl, colIdx);
			return;
		}
		var mediaRef2 = parseMediaRef(plain);
		if (mediaRef2 && mediaRef2.isUrl) {
			insertRemoteMedia(mediaRef2.file, columns, colIdx, wrapperEl, plugin);
			focusColumnAtEnd(wrapperEl, colIdx);
			return;
		}
		if (mediaRef2) {
			appendToColumn(columns, colIdx, plain);
			buildContainer(columns, wrapperEl, wrapperEl._dtCtx, plugin, true);
			debouncedSync(wrapperEl);
			focusColumnAtEnd(wrapperEl, colIdx);
			return;
		}
		if (isExternalUrl(plain) && !/\s/.test(plain)) {
			appendToColumn(columns, colIdx, plain);
			buildContainer(columns, wrapperEl, wrapperEl._dtCtx, plugin, true);
			debouncedSync(wrapperEl);
			focusColumnAtEnd(wrapperEl, colIdx);
			var mdViewP = plugin.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
			var targetFileP = mdViewP && mdViewP.file ? mdViewP.file : null;
			maybeUpgradeUrlToImageInBackground(plugin, plain, targetFileP);
			return;
		}
		appendToColumn(columns, colIdx, plain);
		buildContainer(columns, wrapperEl, wrapperEl._dtCtx, plugin, true);
		debouncedSync(wrapperEl);
		focusColumnAtEnd(wrapperEl, colIdx);
	}
}

function installDtColumnWindowDropCapture(plugin) {
	function onWinDragOver(e) {
		var col = e.target && e.target.closest && e.target.closest(".dt-column");
		if (!col) return;
		e.preventDefault();
		try { if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"; } catch (er) {}
	}
	function onWinDrop(e) {
		var col = e.target && e.target.closest && e.target.closest(".dt-column");
		if (!col) return;
		e.preventDefault();
		try { e.stopImmediatePropagation(); } catch (s) {}
		try { e.stopPropagation(); } catch (s2) {}
		handleDtColumnDataDrop(e, col, plugin);
	}
	window.addEventListener("dragover", onWinDragOver, true);
	window.addEventListener("drop", onWinDrop, true);
	plugin.register(function () {
		window.removeEventListener("dragover", onWinDragOver, true);
		window.removeEventListener("drop", onWinDrop, true);
	});
}

function bindDragDrop(col, columns, colIdx, wrapperEl, plugin) {
	/* dragenter：仅负责声明可投放 + 清空「笔记内拖拽」残留状态（否则会吃掉花瓣第一次 drop）。
	 * 高亮只挂在 dragover，避免穿过子节点时 dragenter/dragleave 交替造成闪烁。
	 * 实际 drop 在 window 捕获阶段处理（installDtColumnWindowDropCapture）。 */
	col.addEventListener("dragenter", function (e) {
		e.preventDefault(); e.stopPropagation();
		resetInternalDragStateIfExternal(e.dataTransfer);
		try { if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"; } catch (eF) {}
	});
	col.addEventListener("dragover", function (e) {
		e.preventDefault(); e.stopPropagation();
		col.classList.add("dt-column--dragover");
		try { if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"; } catch (eF2) {}
	});
	col.addEventListener("dragleave", function (e) {
		try {
			var related = e.relatedTarget;
			if (related && col.contains(related)) return;
		} catch (e2) {}
		col.classList.remove("dt-column--dragover");
	});
}

/* =============================================================
   Core: erase source line from editor
   ============================================================= */

function getActiveEditor(plugin) {
	var mdView = plugin.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
	return (mdView && mdView.editor) ? mdView.editor : null;
}

function eraseLineFromEditor(editor, lineIdx) {
	var total = editor.lineCount();
	if (lineIdx < 0 || lineIdx >= total) return false;
	var lineText = editor.getLine(lineIdx);
	if (lineIdx < total - 1) {
		editor.replaceRange("", { line: lineIdx, ch: 0 }, { line: lineIdx + 1, ch: 0 });
	} else if (lineIdx > 0) {
		var prevLen = editor.getLine(lineIdx - 1).length;
		editor.replaceRange("", { line: lineIdx - 1, ch: prevLen }, { line: lineIdx, ch: lineText.length });
	} else {
		editor.replaceRange("", { line: 0, ch: 0 }, { line: 0, ch: lineText.length });
	}
	return true;
}

function findAndErase(plugin, srcLine, srcRaw, searchFn) {
	var editor = getActiveEditor(plugin);
	if (!editor) return false;
	var total = editor.lineCount();

	if (srcLine >= 0 && srcLine < total) {
		var currentText = stripInvisible(editor.getLine(srcLine).trim());
		var expectedText = stripInvisible(srcRaw.trim());
		if (currentText === expectedText && currentText.length > 0) {
			console.log("DT-Columns erase: exact line match at", srcLine);
			eraseLineFromEditor(editor, srcLine);
			return true;
		}
		for (var d = 1; d <= 3; d++) {
			var above = srcLine - d;
			var below = srcLine + d;
			if (above >= 0) {
				var aboveText = stripInvisible(editor.getLine(above).trim());
				if (aboveText === expectedText && aboveText.length > 0) {
					console.log("DT-Columns erase: found at", above, "(shifted -" + d + ")");
					eraseLineFromEditor(editor, above);
					return true;
				}
			}
			if (below < total) {
				var belowText = stripInvisible(editor.getLine(below).trim());
				if (belowText === expectedText && belowText.length > 0) {
					console.log("DT-Columns erase: found at", below, "(shifted +" + d + ")");
					eraseLineFromEditor(editor, below);
					return true;
				}
			}
		}
	}

	if (srcRaw) {
		var expectedFull = stripInvisible(srcRaw.trim());
		if (expectedFull.length > 0) {
			var inBlock = false;
			for (var i = 0; i < total; i++) {
				var lt = stripInvisible(editor.getLine(i).trim());
				if (lt.startsWith("```")) { inBlock = !inBlock; continue; }
				if (!inBlock && lt === expectedFull) {
					console.log("DT-Columns erase: full-text match at line", i);
					eraseLineFromEditor(editor, i);
					return true;
				}
			}
		}
	}

	if (searchFn) {
		var regex = buildMediaRegex(searchFn);
		var inBlock2 = false;
		for (var j = 0; j < total; j++) {
			var lt2 = stripInvisible(editor.getLine(j).trim());
			if (lt2.startsWith("```")) { inBlock2 = !inBlock2; continue; }
			if (!inBlock2 && regex.test(lt2)) {
				console.log("DT-Columns erase: regex match at line", j, ":", lt2);
				eraseLineFromEditor(editor, j);
				return true;
			}
		}
	}

	console.log("DT-Columns erase: nothing found. srcLine:", srcLine, "srcRaw:", srcRaw, "searchFn:", searchFn);
	return false;
}

function scheduleErase(plugin, srcLine, srcRaw, searchFn) {
	setTimeout(function () {
		var ok = findAndErase(plugin, srcLine, srcRaw, searchFn);
		console.log("DT-Columns pass1 (200ms):", ok ? "DELETED" : "not found");
	}, 200);

	setTimeout(function () {
		var ok = findAndErase(plugin, srcLine, srcRaw, searchFn);
		if (ok) {
			console.log("DT-Columns pass2 (700ms): DELETED leftover");
			try {
				plugin.app.commands.executeCommandById("editor:save-file");
			} catch (e) {}
		} else {
			console.log("DT-Columns pass2 (700ms): clean");
		}
	}, 700);
}

function handleFileDrop(col, file, columns, colIdx, wrapperEl, plugin, srcLine, srcRaw, srcFn) {
	var reader = new FileReader();
	reader.onload = async function () {
		try {
			var ab = reader.result;
			await ensureAssetsFolder(plugin);

			/* R2-1：同名文件不直接覆盖，找一个唯一名字 */
			var safeName = pickUniqueAssetName(plugin, file.name);
			var filePath = "assets/" + safeName;
			await plugin.app.vault.createBinary(filePath, ab);

			var newRef;
			if (file.type.startsWith("image/") || file.type.startsWith("video/")) {
				newRef = "![[" + safeName + "]]";
			} else {
				newRef = new TextDecoder().decode(ab);
			}

			/* 关键：FileReader 是异步的，期间 markdown post-processor 可能已经把 wrapperEl._dtColumns
			 * 换成了从源码重新 parse 出来的新数组。继续往「闭包里的旧 columns」追加会写到一个已不被 wrapper
			 * 引用的数组上，UI 表现就是「第二张图拖了但什么都没发生」。这里强制以 wrapper 当前持有的数组为准。 */
			var liveCols = (wrapperEl && wrapperEl._dtColumns) ? wrapperEl._dtColumns : columns;
			var liveIdx = colIdx;
			if (liveIdx >= liveCols.length) liveIdx = liveCols.length - 1;
			if (liveIdx < 0) liveIdx = 0;

			appendToColumn(liveCols, liveIdx, newRef);

			/* 解开聚焦时设的 skipRebuild —— 否则 buildContainer 直接 return，UI 不刷新 */
			if (wrapperEl) wrapperEl._dtSkipRebuild = false;
			buildContainer(liveCols, wrapperEl, wrapperEl._dtCtx, plugin, true);
			/* Bug 8 闪烁修复：force-rebuild 已经把新 DOM 渲染好了；
			 * syncToSource 异步触发的 markdown post-processor 会再 build 一次造成闪烁，
			 * 改走 debouncedSync —— 它先把 _dtSkipRebuild 拨回 true，~600ms 后再放，
			 * 这期间外部回调命中"force=false + skipRebuild"分支直接 return，不再二次重建。 */
			debouncedSync(wrapperEl);
			focusColumnAtEnd(wrapperEl, liveIdx);

			var fn = srcFn || getBaseName(normalizeName(file.name));
			scheduleErase(plugin, srcLine, srcRaw, fn);
		} catch (e) {
			console.error("DingTalk Columns: drop failed", e);
		}
	};
	reader.readAsArrayBuffer(file);
}

/* =============================================================
   Clipboard & HTML helpers
   ============================================================= */

function decodeHtmlEntities(s) {
	if (!s) return s;
	try {
		/* body.textContent 会把整页 HTML「变纯文本」，破坏嵌在标签里的 URL，故仅作短串回退 */
		if (String(s).length < 400 && !/<(?:img|picture|body|meta)\b/i.test(s)) {
			var doc = new DOMParser().parseFromString("<!doctype html><body>" + s, "text/html");
			var decoded = doc.body ? doc.body.textContent : null;
			if (decoded != null) return decoded;
		}
	} catch (e) {}
	return s
		.replace(/&amp;/gi, "&")
		.replace(/&lt;/gi, "<")
		.replace(/&gt;/gi, ">")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;|&apos;/gi, "'")
		.replace(/&#x([0-9a-f]+);/gi, function (_, h) { return String.fromCodePoint(parseInt(h, 16)); })
		.replace(/&#(\d+);/g, function (_, d) { return String.fromCodePoint(parseInt(d, 10)); });
}

function normalizePastedMediaUrl(raw) {
	if (!raw) return raw;
	var u = String(raw).trim();
	try { u = u.replace(/^["']+|["']+$/g, ""); } catch (e2) {}
	if (u.indexOf("//") === 0 && /^\/\//.test(u)) u = "https:" + u;
	return decodeHtmlEntities(u);
}

function srcsetBoostScore(desc) {
	try {
		var parts = String(desc).split(",").map(function (s) { return s.trim(); }).filter(Boolean);
		var maxW = -1;
		for (var i = 0; i < parts.length; i++) {
			var seg = parts[i].split(/\s+/);
			var w = 0;
			if (seg[1]) {
				var mw = seg[1].match(/^(\d+(?:\.\d+)?)([wx])$/i);
				if (mw) {
					w = parseFloat(mw[1]);
					if (mw[2].toLowerCase() === "x") w *= 800;
				}
			}
			if (w > maxW) maxW = w;
		}
		return Math.max(0, maxW);
	} catch (e) { return 0; }
}

function urlsFromInlineStyle(style) {
	if (!style) return [];
	var urls = [];
	var re = /url\s*\(\s*["']?([^"')]+)["']?\s*\)/gi;
	var m;
	while ((m = re.exec(style)) !== null) {
		if (m[1]) urls.push(normalizePastedMediaUrl(m[1]));
	}
	return urls;
}

function scrapeHttpImageUrlsFromSnippet(html) {
	var list = [];
	var re = /https?:\/\/[^\s"'<>]+?\.(?:jpe?g|png|gif|webp|bmp|svg|avif)(?:[^\s"'<>]*)?/gi;
	var m;
	while ((m = re.exec(html)) !== null) list.push(normalizePastedMediaUrl(m[0]));
	return list;
}

/**
 * Electron：从 Chromium 复制的图片常以「系统剪贴板位图」存在， ClipboardData.files 有时是空的。
 */
function tryReadElectronClipboardImageAsFile() {
	try {
		var req = typeof require !== "undefined" ? require :
			(typeof window !== "undefined" && window.require ? window.require : null);
		if (!req) return null;
		var electron = req("electron");
		if (!electron || !electron.clipboard || !electron.nativeImage) return null;
		var ni = electron.clipboard.readImage();
		if (!ni || (typeof ni.isEmpty === "function" && ni.isEmpty())) return null;
		var buf = ni.toPNG();
		if (!buf || buf.length < 32) return null;
		var ua = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
		var fname = "paste_" + Date.now() + ".png";
		return new File([ua], fname, { type: "image/png" });
	} catch (e) { return null; }
}

function extractImageFromHtml(html) {
	if (!html || html.length < 3) return null;

	/* 1) DOM 解析 —— 覆盖百度 picture / data-src / 无引号属性 / style 背景图等 */
	try {
		var parsed = new DOMParser().parseFromString(html, "text/html");
		var bestUrl = null;
		var bestScore = -1e9;
		function consider(u, bias) {
			if (!u) return;
			var url = normalizePastedMediaUrl(u);
			if (!url || /^blob:/i.test(url) || /^data:/i.test(url) || /^about:/i.test(url)) return;
			var sc = bias || 0;
			var lo = url.toLowerCase();
			if (/\.(jpe?g|png|gif|webp|bmp|svg|avif)(\?|#|$)/.test(lo)) sc += 500;
			if (/img|image|photo|picture|pics|pics0|baike|bdstatic|bcebos|bceimg|xhscdn|hbimg/i.test(lo)) sc += 40;
			if (sc > bestScore) { bestScore = sc; bestUrl = url; }
		}

		var imgs = parsed.querySelectorAll("img");
		for (var i = 0; i < imgs.length; i++) {
			var img = imgs[i];
			var sset = img.getAttribute("srcset");
			if (sset) {
				var fromSet = pickBestFromSrcset(sset);
				if (fromSet) consider(fromSet, 260 + srcsetBoostScore(sset));
			}
			var hrefLike = img.getAttribute("src") ||
				img.getAttribute("data-src") || img.getAttribute("data-original") ||
				img.getAttribute("data-lazy-src") || img.getAttribute("data-actualsrc") ||
				img.getAttribute("data-url") || img.getAttribute("data-img") || img.getAttribute("data-image");
			if (hrefLike) consider(hrefLike, 180);
			var istyle = img.getAttribute("style");
			if (istyle) {
				var bl = urlsFromInlineStyle(istyle);
				for (var bi = 0; bi < bl.length; bi++) consider(bl[bi], 140);
			}
		}

		var sources = parsed.querySelectorAll("picture source, source[srcset]");
		for (var j = 0; j < sources.length; j++) {
			var sr = sources[j];
			var sset2 = sr.getAttribute("srcset");
			if (sset2) {
				var fb = pickBestFromSrcset(sset2);
				if (fb) consider(fb, 300 + srcsetBoostScore(sset2));
			}
			var one = sr.getAttribute("src");
			if (one) consider(one, 220);
		}

		var metaOg = parsed.querySelector("meta[property=\"og:image\"], meta[property='og:image'], meta[name=\"twitter:image\"], meta[name='twitter:image']");
		if (metaOg) {
			var c = metaOg.getAttribute("content");
			if (c) consider(c, 160);
		}

		if (bestUrl) return bestUrl;
	} catch (eDOM) {}

	/* 2) 正则回退（畸形 / 不完整 HTML） */
	var srcsetMatch = html.match(/<img\b[^>]+srcset\s*=\s*["']([^"']+)["']/i);
	if (!srcsetMatch) srcsetMatch = html.match(/<img\b[^>]+srcset\s*=\s*([^\s>]+)/i);
	if (srcsetMatch && srcsetMatch[1]) {
		var b1 = pickBestFromSrcset(srcsetMatch[1]);
		if (b1) return normalizePastedMediaUrl(b1);
	}
	var m = html.match(/<img\b[^>]+src\s*=\s*["']([^"']+)["']/i);
	if (!m) m = html.match(/<img\b[^>]+src\s*=\s*([^\s>]+)/i);
	if (m && m[1]) return normalizePastedMediaUrl(m[1]);
	var lazy = html.match(/<img\b[^>]*(?:data-src|data-original|data-lazy-src|data-actualsrc|data-url|data-img)\s*=\s*["']([^"']+)["']/i);
	if (!lazy) lazy = html.match(/<img\b[^>]*(?:data-src|data-original|data-lazy-src|data-actualsrc|data-url|data-img)\s*=\s*([^\s>]+)/i);
	if (lazy && lazy[1]) return normalizePastedMediaUrl(lazy[1]);
	var v = html.match(/<video\b[^>]+src\s*=\s*["']([^"']+)["']/i);
	if (!v) v = html.match(/<video\b[^>]+src\s*=\s*([^\s>]+)/i);
	if (v && v[1]) return normalizePastedMediaUrl(v[1]);
	var srcLine = html.match(/<source\b[^>]+src\s*=\s*["']([^"']+)["']/i);
	if (srcLine && srcLine[1]) return normalizePastedMediaUrl(srcLine[1]);

	/* 3) 最后再扫正文中的图片直链（某些站点仅存一大段脚本/JSON） */
	var scraped = scrapeHttpImageUrlsFromSnippet(html);
	if (scraped.length === 1) return scraped[0];
	if (scraped.length > 1) return scraped[0]; /* 第一张通常足够预览 */
	return null;
}

function pickBestFromSrcset(srcset) {
	try {
		var parts = srcset.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
		var best = null;
		var bestW = -1;
		for (var i = 0; i < parts.length; i++) {
			var seg = parts[i].split(/\s+/);
			var url = seg[0];
			var w = 0;
			if (seg[1]) {
				var mw = seg[1].match(/^(\d+(?:\.\d+)?)([wx])$/i);
				if (mw) {
					w = parseFloat(mw[1]);
					if (mw[2].toLowerCase() === "x") w = w * 1000;
				}
			}
			if (w > bestW) { bestW = w; best = url; }
		}
		return best;
	} catch (e) { return null; }
}

/* =============================================================
   Remote image downloader — vault localization
   ============================================================= */

function guessExtFromUrlOrType(url, contentType) {
	var ct = (contentType || "").toLowerCase();
	var ctMap = {
		"image/png": "png", "image/jpeg": "jpg", "image/jpg": "jpg",
		"image/gif": "gif", "image/webp": "webp", "image/svg+xml": "svg",
		"image/bmp": "bmp", "image/avif": "avif",
		"video/mp4": "mp4", "video/webm": "webm", "video/ogg": "ogg",
		"video/quicktime": "mov"
	};
	for (var key in ctMap) {
		if (ct.indexOf(key) >= 0) return ctMap[key];
	}
	try {
		var clean = url.split("?")[0].split("#")[0];
		var em = clean.match(/\.(png|jpe?g|gif|webp|svg|bmp|avif|mp4|webm|ogg|mov|mkv)$/i);
		if (em) {
			var ext = em[1].toLowerCase();
			return ext === "jpeg" ? "jpg" : ext;
		}
		/* 花瓣 _fw658webp 这类后缀 */
		if (/webp/i.test(clean)) return "webp";
		if (/png/i.test(clean)) return "png";
		if (/jpe?g/i.test(clean)) return "jpg";
	} catch (e) {}
	return "png";
}

function isVideoMime(contentType) {
	return /^video\//i.test(contentType || "");
}

async function ensureAssetsFolder(plugin) {
	try {
		if (!plugin.app.vault.getAbstractFileByPath("assets")) {
			await plugin.app.vault.createFolder("assets");
		}
	} catch (e) {}
}

/**
 * R2-1：同名文件防覆盖。
 * 若 `assets/<base>` 不存在，直接返回；否则尝试 `<name>-1.<ext>` ... `<name>-99.<ext>`，
 * 仍冲突就追加时间戳兜底。永远不会用同名覆盖已有附件。
 */
function pickUniqueAssetName(plugin, baseName) {
	try {
		var safe = String(baseName || "asset").replace(/[\\/:*?"<>|]/g, "_");
		var dot = safe.lastIndexOf(".");
		var stem = dot > 0 ? safe.slice(0, dot) : safe;
		var ext = dot > 0 ? safe.slice(dot) : "";
		var candidate = safe;
		if (!plugin.app.vault.getAbstractFileByPath("assets/" + candidate)) return candidate;
		for (var i = 1; i <= 99; i++) {
			candidate = stem + "-" + i + ext;
			if (!plugin.app.vault.getAbstractFileByPath("assets/" + candidate)) return candidate;
		}
		return stem + "-" + Date.now() + ext;
	} catch (e) {
		return String(baseName || ("asset_" + Date.now()));
	}
}

function looksLikeImageBytes(ab) {
	try {
		var view = new Uint8Array(ab, 0, Math.min(16, ab.byteLength));
		if (view.length < 4) return false;
		/* PNG  89 50 4E 47 */
		if (view[0] === 0x89 && view[1] === 0x50 && view[2] === 0x4E && view[3] === 0x47) return true;
		/* JPEG FF D8 FF */
		if (view[0] === 0xFF && view[1] === 0xD8 && view[2] === 0xFF) return true;
		/* GIF8 */
		if (view[0] === 0x47 && view[1] === 0x49 && view[2] === 0x46 && view[3] === 0x38) return true;
		/* BMP */
		if (view[0] === 0x42 && view[1] === 0x4D) return true;
		/* WEBP RIFF....WEBP */
		if (view[0] === 0x52 && view[1] === 0x49 && view[2] === 0x46 && view[3] === 0x46 &&
			ab.byteLength >= 12) {
			var v2 = new Uint8Array(ab, 8, 4);
			if (v2[0] === 0x57 && v2[1] === 0x45 && v2[2] === 0x42 && v2[3] === 0x50) return true;
		}
		/* SVG（文本 XML） */
		var head = new TextDecoder("utf-8", { fatal: false }).decode(view);
		if (/<\?xml|<svg/i.test(head)) return true;
		/* AVIF/HEIC ftyp */
		if (ab.byteLength >= 12) {
			var v3 = new Uint8Array(ab, 4, 8);
			if (v3[0] === 0x66 && v3[1] === 0x74 && v3[2] === 0x79 && v3[3] === 0x70) return true;
		}
	} catch (e) {}
	return false;
}

/**
 * 主流图床/CDN 的 Referer 白名单：花瓣、小红书、微博等都对 hotlink 做了 referer 校验，
 * 直链请求会被 403 拦下；这里按域名挂上"上游官方页"作为 referer，能显著提升下载成功率。
 */
function pickRefererForUrl(url) {
	try {
		var u = new URL(url);
		var host = u.host.toLowerCase();
		var map = [
			[/(^|\.)hbimg\.huaban\.com$|(^|\.)huaban\.com$/, "https://huaban.com/"],
			[/(^|\.)xhscdn\.com$|(^|\.)xiaohongshu\.com$/,    "https://www.xiaohongshu.com/"],
			[/(^|\.)sinaimg\.cn$|(^|\.)weibocdn\.com$|(^|\.)weibo\.com$/, "https://weibo.com/"],
			[/(^|\.)zhimg\.com$|(^|\.)zhihu\.com$/,           "https://www.zhihu.com/"],
			[/(^|\.)byteimg\.com$|(^|\.)pstatp\.com$/,        "https://www.toutiao.com/"],
			[/(^|\.)bdstatic\.com$|(^|\.)baidu\.com$|(^|\.)bdimg\.com$/, "https://www.baidu.com/"],
			[/(^|\.)hdslb\.com$|(^|\.)bilibili\.com$/,        "https://www.bilibili.com/"],
			[/(^|\.)alicdn\.com$/,                            "https://www.taobao.com/"],
			[/(^|\.)qpic\.cn$|(^|\.)qq\.com$/,                "https://www.qq.com/"],
		];
		for (var i = 0; i < map.length; i++) {
			if (map[i][0].test(host)) return map[i][1];
		}
		return u.origin + "/";
	} catch (e) {
		return undefined;
	}
}

async function fetchRemoteMediaResp(url) {
	var headersBase = {
		"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
		"Accept": "image/avif,image/webp,image/apng,image/*,video/*,*/*;q=0.8"
	};
	var referer = pickRefererForUrl(url);
	if (referer) headersBase["Referer"] = referer;

	try {
		var resp = await obsidian.requestUrl({ url: url, method: "GET", headers: headersBase, throw: false });
		if (resp && resp.status >= 200 && resp.status < 300) return resp;

		/* 403/401 兜底：去掉 Referer 重试 */
		if (resp && (resp.status === 403 || resp.status === 401)) {
			var headersNoRef = Object.assign({}, headersBase);
			delete headersNoRef["Referer"];
			var resp2 = await obsidian.requestUrl({ url: url, method: "GET", headers: headersNoRef, throw: false });
			if (resp2 && resp2.status >= 200 && resp2.status < 300) return resp2;
			return resp2 || resp;
		}
		return resp;
	} catch (e) {
		console.warn("DingTalk Columns: requestUrl threw", e);
		return null;
	}
}

async function downloadRemoteMediaToVault(plugin, url) {
	try {
		var resp = await fetchRemoteMediaResp(url);
		if (!resp || resp.status < 200 || resp.status >= 300) {
			console.warn("DingTalk Columns: remote download failed status=", resp && resp.status, url);
			return null;
		}
		var ab = resp.arrayBuffer;
		if (!ab || ab.byteLength < 32) return null;
		var contentType = "";
		try {
			if (resp.headers) {
				contentType = resp.headers["content-type"] || resp.headers["Content-Type"] || "";
			}
		} catch (e) {}

		/* 校验：必须是图片/视频 mime；否则按文件签名再判一次；都不是就放弃 */
		var ctLower = (contentType || "").toLowerCase();
		var isImageOrVideo = /^image\//.test(ctLower) || /^video\//.test(ctLower);
		if (!isImageOrVideo && !looksLikeImageBytes(ab)) {
			console.warn("DingTalk Columns: response is not image/video, skip. content-type=", contentType, url);
			return null;
		}

		var ext = guessExtFromUrlOrType(url, contentType);
		await ensureAssetsFolder(plugin);
		var stamp = Date.now() + "_" + Math.floor(Math.random() * 10000);
		var safeName = "remote_" + stamp + "." + ext;
		var filePath = "assets/" + safeName;
		await plugin.app.vault.createBinary(filePath, ab);
		return { name: safeName, path: filePath, isVideo: isVideoMime(contentType) || /^(mp4|webm|ogg|mov|mkv)$/i.test(ext) };
	} catch (e) {
		console.error("DingTalk Columns: download error", e);
		return null;
	}
}

/**
 * 给一个 Promise 套上超时；超时后 reject，避免慢站点卡死整个粘贴体验
 */
function withTimeout(promise, ms) {
	var timer;
	var timeoutPromise = new Promise(function (_, reject) {
		timer = setTimeout(function () { reject(new Error("DT_TIMEOUT")); }, ms);
	});
	return Promise.race([promise, timeoutPromise]).then(
		function (v) { clearTimeout(timer); return v; },
		function (e) { clearTimeout(timer); throw e; }
	);
}

/**
 * 在某个具体打开的 markdown editor 中按文本替换；不影响其他笔记，保留光标位置
 */
function replaceInEditorByText(editor, oldText, newText) {
	try {
		var total = editor.lineCount();
		for (var i = 0; i < total; i++) {
			var line = editor.getLine(i);
			var idx = line.indexOf(oldText);
			if (idx >= 0) {
				editor.replaceRange(
					newText,
					{ line: i, ch: idx },
					{ line: i, ch: idx + oldText.length }
				);
				return true;
			}
		}
	} catch (e) {
		console.error("DingTalk Columns: editor replace failed", e);
	}
	return false;
}

/**
 * 锁定到指定文件做替换：先尝试已打开的编辑器（保留光标），失败则改写磁盘内容。
 *
 * R2-3：旧实现用 `content.split(oldText).join(newText)` 全文档替换 N 处，
 * 当 oldText 是裸 URL 时会把笔记里其他位置的同 URL 文本（例如来源说明）一并改掉。
 * 现在改为「只替换第 1 处」+ 计数其余出现次数，多于 1 处时给一次 Notice 让用户感知。
 */
async function replacePlaceholderInFile(plugin, targetFile, oldText, newText) {
	if (!targetFile || !oldText) return false;
	try {
		var leaves = plugin.app.workspace.getLeavesOfType("markdown");
		for (var i = 0; i < leaves.length; i++) {
			var view = leaves[i].view;
			if (view && view.file === targetFile && view.editor) {
				if (replaceInEditorByText(view.editor, oldText, newText)) return true;
			}
		}
	} catch (e) {}
	try {
		var content = await plugin.app.vault.read(targetFile);
		var idx = content.indexOf(oldText);
		if (idx < 0) return false;

		var rest = content.slice(idx + oldText.length);
		var extra = 0;
		var p = 0;
		while ((p = rest.indexOf(oldText, p)) >= 0) {
			extra++;
			p += oldText.length;
			if (extra > 5) break;
		}

		var updated = content.slice(0, idx) + newText + rest;
		await plugin.app.vault.modify(targetFile, updated);

		if (extra > 0) {
			try {
				new obsidian.Notice(
					"已替换 1 处；该笔记中还有 " + extra + " 处相同文本未改动",
					6000
				);
			} catch (eN) {}
		}
		return true;
	} catch (e) {
		console.error("DingTalk Columns: vault modify failed", e);
		return false;
	}
}

/**
 * 后台探测一个未识别的 URL：如果服务器返回的真的是图片/视频，
 * 把它从 vault 中找到的"文字 URL"原地替换为 ![[localname]] 本地引用。
 * 不是图片或超时就静默放弃 —— 用户最终看到的就是普通文字 URL，不打扰。
 *
 * 这是覆盖"任何网站的复制图片地址"的关键兜底。
 */
function maybeUpgradeUrlToImageInBackground(plugin, url, targetFile) {
	if (!plugin || !url || !targetFile) return;
	(async function () {
		try {
			var info = await withTimeout(downloadRemoteMediaToVault(plugin, url), 10000);
			if (!info) return; /* 不是图片 → 静默 */
			var newRef = "![[" + info.name + "]]";
			var ok = await replacePlaceholderInFile(plugin, targetFile, url, newRef);
			if (ok) {
				try { new obsidian.Notice("已识别为图片，已保存到 " + info.path); } catch (e) {}
			}
		} catch (e) {
			/* 超时或网络错误 → 静默放弃，文字保留 */
		}
	})();
}

/**
 * 用户手动点「下载」按钮时调用：把远程图片下载到 vault/assets，
 * 并把当前笔记里所有 ![](url) 形式的引用替换成 ![[localname]]。
 * - rawRef 形如 "![](https://...)" 或裸 URL，用作回写 vault 的"待替换文本"
 * - 自动下载失败 / 防盗链 → Notice 提示
 */
function downloadRemoteImageToLocal(url, rawRef, plugin) {
	var notice;
	try { notice = new obsidian.Notice("正在下载远程图片到本地…", 0); } catch (e) {}

	var mdView = plugin.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
	var targetFile = mdView && mdView.file ? mdView.file : null;

	(async function () {
		try {
			/* R2-2：手动下载也要带超时，否则慢站点会让 "正在下载…" Notice 永不消失 */
			var info = await withTimeout(downloadRemoteMediaToVault(plugin, url), 15000);
			try { if (notice) notice.hide(); } catch (e) {}

			if (!info) {
				try { new obsidian.Notice("下载失败（可能服务器拒绝了请求）"); } catch (e) {}
				return;
			}

			var newRef = "![[" + info.name + "]]";
			var ok = false;

			/* 多种引用形态都尝试替换一次：原始 ref 字符串 / ![](url) / 裸 URL */
			var candidates = [];
			if (rawRef) candidates.push(rawRef);
			candidates.push("![](" + url + ")");
			candidates.push(url);

			for (var i = 0; i < candidates.length && !ok; i++) {
				try {
					ok = await replacePlaceholderInFile(plugin, targetFile, candidates[i], newRef);
				} catch (e) {}
			}

			if (ok) {
				try { new obsidian.Notice("已保存到 " + info.path); } catch (e) {}
			} else {
				try { new obsidian.Notice("已保存到 " + info.path + "，但未找到原引用，请手动调整"); } catch (e) {}
			}
		} catch (e) {
			try { if (notice) notice.hide(); } catch (e2) {}
			console.error("DingTalk Columns: manual download failed", e);
			var msg = (e && e.message) ? String(e.message) : String(e);
			if (msg === "DT_TIMEOUT") msg = "下载超时（15 秒），请稍后再试";
			try { new obsidian.Notice("下载出错：" + msg); } catch (e3) {}
		}
	})();
}

/**
 * 本地 wiki 图片：读出 vault 二进制并用浏览器下载链路导出到「下载」文件夹（再次保存副本）。
 */
function exportVaultWikiImageToDownloads(plugin, wikiRef) {
	var m = wikiRef && wikiRef.match(/^!\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/);
	if (!m) return;
	var fname = normalizeName(m[1]);
	(async function () {
		try {
			var vaultPath = findVaultFile(plugin, fname);
			var tf = plugin.app.vault.getAbstractFileByPath(vaultPath);
			if (!tf) {
				try { new obsidian.Notice("找不到附件：" + getBaseName(fname)); } catch (e0) {}
				return;
			}
			var buf = await plugin.app.vault.readBinary(tf);
			var base = getBaseName(fname);
			var ext = (base.split(".").pop() || "png").toLowerCase();
			var mimeMap = {
				png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
				webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", avif: "image/avif"
			};
			var mime = mimeMap[ext] || "application/octet-stream";
			var blob = new Blob([buf], { type: mime });
			var objUrl = URL.createObjectURL(blob);
			var a = document.createElement("a");
			a.href = objUrl;
			a.download = base;
			a.rel = "noopener";
			document.body.appendChild(a);
			a.click();
			document.body.removeChild(a);
			setTimeout(function () {
				try { URL.revokeObjectURL(objUrl); } catch (eR) {}
			}, 2500);
			try { new obsidian.Notice("已开始下载：" + base); } catch (eN) {}
		} catch (err) {
			console.error("picote export vault image", err);
			try { new obsidian.Notice("导出失败：" + (err && err.message || err)); } catch (e2) {}
		}
	})();
}

function insertRemoteMedia(url, columns, colIdx, wrapperEl, plugin) {
	/* 占位用一个极不易冲突的唯一标识，避免与笔记中其他相同 URL 的引用混淆 */
	var token = "__DT_REMOTE_" + Date.now() + "_" + Math.floor(Math.random() * 1e9) + "__";
	var placeholder = "![](" + url + "#" + token + ")";

	appendToColumn(columns, colIdx, placeholder);
	buildContainer(columns, wrapperEl, wrapperEl._dtCtx, plugin, true);
	debouncedSync(wrapperEl);
	focusColumnAtEnd(wrapperEl, colIdx);

	/* 锁定下载完成时要操作的目标文件 */
	var mdView = plugin.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
	var targetFile = mdView && mdView.file ? mdView.file : null;

	(async function () {
		var notice;
		try { notice = new obsidian.Notice("正在保存远程图片到本地…", 0); } catch (e) {}
		var info = await downloadRemoteMediaToVault(plugin, url);
		try { if (notice) notice.hide(); } catch (e) {}

		if (!info) {
			/* 下载失败：把唯一标识从源码里去掉，恢复成普通 ![](url) 远程引用 */
			var fallback = wrapUrlAsMarkdownImage(url);
			await replacePlaceholderInFile(plugin, targetFile, placeholder, fallback);
			try { new obsidian.Notice("远程图片下载失败，已保留远程链接"); } catch (e) {}
			return;
		}

		var newRef = "![[" + info.name + "]]";
		var ok = await replacePlaceholderInFile(plugin, targetFile, placeholder, newRef);
		if (ok) {
			try { new obsidian.Notice("已保存到 " + info.path); } catch (e) {}
		} else {
			try { new obsidian.Notice("已保存到 " + info.path + "，但替换失败，请手动刷新"); } catch (e) {}
		}
	})();
}

function handleDataUriImage(dataUri, columns, colIdx, wrapperEl, plugin) {
	try {
		var match = dataUri.match(/^data:([^;]+);base64,(.+)$/i);
		if (!match) return;
		var mime = match[1];
		var b64 = match[2];
		var binary = atob(b64);
		var len = binary.length;
		var bytes = new Uint8Array(len);
		for (var i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
		var ext = guessExtFromUrlOrType("", mime);
		var safeName = "paste_" + Date.now() + "." + ext;
		var pseudoFile = new File([bytes], safeName, { type: mime });
		handleClipboardFile(pseudoFile, columns, colIdx, wrapperEl, plugin);
	} catch (e) {
		console.error("DingTalk Columns: data URI parse failed", e);
	}
}

function handleClipboardFile(file, columns, colIdx, wrapperEl, plugin) {
	var ext = "";
	if (file.name && file.name.indexOf(".") > -1) {
		ext = file.name.split(".").pop().toLowerCase();
	} else {
		var mimeToExt = {
			"image/png": "png", "image/jpeg": "jpg", "image/gif": "gif",
			"image/webp": "webp", "image/svg+xml": "svg", "image/bmp": "bmp",
			"image/avif": "avif", "video/mp4": "mp4", "video/webm": "webm",
			"video/ogg": "ogg"
		};
		ext = mimeToExt[file.type] || "png";
	}
	var rawName = file.name || ("paste_" + Date.now() + "." + ext);

	var reader = new FileReader();
	reader.onload = async function () {
		try {
			var ab = reader.result;
			await ensureAssetsFolder(plugin);

			/* R2-1：同名文件不直接覆盖 */
			var safeName = pickUniqueAssetName(plugin, rawName);
			var filePath = "assets/" + safeName;
			await plugin.app.vault.createBinary(filePath, ab);

			/* 与 handleFileDrop 一致：异步回来时优先用 wrapper 当前持有的 columns 数组 */
			var liveColsCB = (wrapperEl && wrapperEl._dtColumns) ? wrapperEl._dtColumns : columns;
			var liveIdxCB = colIdx;
			if (liveIdxCB >= liveColsCB.length) liveIdxCB = liveColsCB.length - 1;
			if (liveIdxCB < 0) liveIdxCB = 0;

			appendToColumn(liveColsCB, liveIdxCB, "![[" + safeName + "]]");
			if (wrapperEl) wrapperEl._dtSkipRebuild = false;
			buildContainer(liveColsCB, wrapperEl, wrapperEl._dtCtx, plugin, true);
			/* 同 handleFileDrop：force-rebuild 已渲染新 DOM，debouncedSync 屏蔽 post-processor 的二次 build */
			debouncedSync(wrapperEl);
			focusColumnAtEnd(wrapperEl, liveIdxCB);
			try {
				new obsidian.Notice("已保存图片到 assets：" + safeName + "（若未刷新请再等半秒）", 9000);
			} catch (nFile) {}
		} catch (e) {
			console.error("DingTalk Columns: paste file failed", e);
		}
	};
	reader.readAsArrayBuffer(file);
}

/* =============================================================
   Source Sync
   ============================================================= */

/**
 * CM6/Obsidian：在一次编辑循环尚未结束时不能 dispatch。
 * Live Preview + buildContainer + 异步 FileReader 常与此冲突，必须延后并在失败时短重试，
 * 且每次重跑前重新算 range（避免文档已变化）。
 */
function syncToSource(wrapperEl) {
	try {
		var cols = wrapperEl._dtColumns;
		if (!cols) return;

		var newBody = cols.join(" " + COL_SEP + " ");
		/* 闭合围栏后必须有换行，避免预览层把 ``` 挤成单独可见的一行 */
		var replacement = "```" + CODEBLOCK_LANG + "\n" + newBody + "\n```\n";

		var maxTries = 60;
		var attempt = 0;

		function runSyncDispatch() {
			var ctx = wrapperEl._dtCtx;
			var sectionInfo = null;
			if (ctx && typeof ctx.getSectionInfo === "function") {
				try {
					sectionInfo = ctx.getSectionInfo(wrapperEl);
				} catch (gsi) {}
			}
			var cmv = resolveCMViewForSync(wrapperEl);
			if (!cmv) {
				console.warn("DingTalk Columns: syncToSource — 仍未找到编辑器（请先打开该 md 的标签页并使用 Live Preview）");
				return;
			}
			var range = null;
			if (sectionInfo) range = rangeFromSection(cmv, sectionInfo);
			if (!range) range = locateFirstCodeBlock(cmv);
			if (!range) {
				/* R2-5：以前这里静默 return，命中后用户输入"看起来丢了但不知道为什么"。
				 * 短次数重试 + 失败时告警。最常见情形是代码块刚渲染完毕但宿主还未把
				 * sectionInfo 注入到 ctx，等几帧后通常就好。 */
				if (attempt < 6) {
					attempt++;
					setTimeout(runSyncDispatch, 50);
					return;
				}
				try {
					console.warn("DingTalk Columns: syncToSource — 找不到代码块范围，写回放弃。",
						"ctx=", !!wrapperEl._dtCtx, "doc.lines=", cmv.state.doc.lines);
					new obsidian.Notice("分栏写回失败：找不到代码块位置。请重新进入笔记或检查代码块语言是否被改动。", 8000);
				} catch (eN) {}
				return;
			}

			try {
				cmv.dispatch({
					changes: { from: range.from, to: range.to, insert: replacement },
				});
			} catch (err) {
				var msg = String((err && err.message) ? err.message : err);
				var cmBusy =
					msg.indexOf("update is in progress") !== -1 ||
					msg.indexOf("while an update") !== -1 ||
					msg.indexOf("Calls to EditorView.update") !== -1 ||
					(msg.indexOf("not allowed") !== -1 && msg.indexOf("update") !== -1);

				if (cmBusy && attempt < maxTries) {
					attempt++;
					setTimeout(runSyncDispatch, attempt <= 22 ? 0 : Math.min(45, Math.floor(attempt / 3)));
				} else {
					console.error("DingTalk Columns: sync failed", err);
				}
			}
		}

		if (typeof requestAnimationFrame === "function") {
			requestAnimationFrame(function () {
				setTimeout(runSyncDispatch, 72);
			});
		} else {
			setTimeout(runSyncDispatch, 72);
		}
	} catch (e) {
		console.error("DingTalk Columns: sync failed", e);
	}
}

function rangeFromSection(cmv, info) {
	try {
		var doc = cmv.state.doc;
		return { from: doc.line(info.lineStart + 1).from, to: doc.line(info.lineEnd + 1).to };
	} catch (e) { return null; }
}

function locateFirstCodeBlock(cmv) {
	try {
		var doc = cmv.state.doc;
		var openTag = "```" + CODEBLOCK_LANG;
		for (var i = 1, n = doc.lines; i <= n; i++) {
			var l = doc.line(i);
			if (l.text.trim() === openTag) {
				for (var j = i + 1; j <= n; j++) {
					var endL = doc.line(j);
					if (endL.text.trim() === "```") {
						return { from: l.from, to: endL.to };
					}
				}
			}
		}
	} catch (e) {}
	return null;
}

main_exports.default = DingTalkColumnsPlugin;
module.exports = main_exports;
