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
var DT_COLUMNS_VER = "2.2.7";

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
			_draggingMedia = null;
			_draggedFileName = null;
			_dragSourceLine = -1;
			_dragSourceRaw = "";
			var target = e.target;
			if (!target) return;
			if (target.closest && target.closest(".dt-column")) return;

			var cmEditor = target.closest ? target.closest(".cm-editor") : null;
			if (!cmEditor) return;
			var cmv = getCMView(cmEditor);
			if (!cmv) return;

			function captureLine(cmLine) {
				_dragSourceLine = cmLine.number - 1;
				_dragSourceRaw = cmLine.text;
				_draggingMedia = cmLine.text.trim();
				var ref = parseMediaRef(_draggingMedia);
				if (ref && !ref.isUrl) {
					_draggedFileName = getBaseName(normalizeName(ref.file));
				}
			}

			var sel = cmv.state.selection.main;
			if (sel.from !== sel.to) {
				var selLine = cmv.state.doc.lineAt(sel.from);
				if (parseMediaRef(selLine.text.trim())) {
					captureLine(selLine);
					console.log("DT-Columns dragstart [sel] line:", _dragSourceLine, _draggingMedia);
					return;
				}
			}

			try {
				var pos = cmv.posAtCoords({ x: e.clientX, y: e.clientY });
				if (pos != null) {
					var posLine = cmv.state.doc.lineAt(pos);
					if (parseMediaRef(posLine.text.trim())) {
						captureLine(posLine);
						console.log("DT-Columns dragstart [pos] line:", _dragSourceLine, _draggingMedia);
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
					_draggedFileName = getBaseName(fn);
					var fnRegex = buildMediaRegex(fn);
					var doc = cmv.state.doc;
					var inB = false;
					for (var li = 1, ln = doc.lines; li <= ln; li++) {
						var cmL = doc.line(li);
						var lnText = cmL.text.trim();
						if (lnText.startsWith("```")) { inB = !inB; continue; }
						if (!inB && fnRegex.test(lnText)) {
							captureLine(cmL);
							console.log("DT-Columns dragstart [img] line:", _dragSourceLine, _draggingMedia);
							return;
						}
					}
					_draggingMedia = "![[" + fn + "]]";
				}
			}
		});

		this.registerDomEvent(document, "dragend", function () {
			setTimeout(function () {
				_draggingMedia = null; _draggedFileName = null;
				_dragSourceLine = -1; _dragSourceRaw = "";
			}, 1500);
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

			if (_dtLastColumnEl && !document.body.contains(_dtLastColumnEl)) {
				_dtLastColumnEl = null;
				_dtLastColumnTs = 0;
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

		this.registerDomEvent(document, "mousemove", function (ev) {
			_dtMouseX = ev.clientX;
			_dtMouseY = ev.clientY;
		});

		this.registerDomEvent(document, "pointerdown", function (ev) {
			var t = ev.target;
			if (!t || !t.closest) return;
			var c = t.closest(".dt-column");
			if (c) {
				_dtLastColumnEl = c;
				_dtLastColumnTs = Date.now();
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
var _skipRebuild = false;
var _syncTimer = null;
var _draggingMedia = null;
var _draggedFileName = null;
var _dragSourceLine = -1;
var _dragSourceRaw = "";

/* 全局粘贴转发：Live Preview 下焦点常在 CodeMirror，Ctrl+V 到不了 .dt-column */
var _dtMouseX = 0;
var _dtMouseY = 0;
var _dtLastColumnEl = null;
var _dtLastColumnTs = 0;

function findDtWrapperElement(columnEl) {
	var n = columnEl;
	while (n) {
		if (n.classList && n.classList.contains("dt-wrapper")) return n;
		n = n.parentElement;
	}
	return null;
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
		var hi = document.elementFromPoint(_dtMouseX, _dtMouseY);
		rows.push(hi && hi.closest && hi.closest(".dt-column") ? "鼠标指针下面：在分栏格子上 ✓" : "鼠标指针下面：不在分栏上（把鼠标移到紫色格子里再检查）");
	} catch (e3) { rows.push("无法读取鼠标位置"); }
	try {
		if (_dtLastColumnEl && document.body.contains(_dtLastColumnEl)) {
			var sec = Math.floor((Date.now() - _dtLastColumnTs) / 1000);
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
	if (_dtLastColumnEl && !document.body.contains(_dtLastColumnEl)) {
		_dtLastColumnEl = null;
		_dtLastColumnTs = 0;
	}

	var under = null;
	try {
		var topEl = document.elementFromPoint(_dtMouseX, _dtMouseY);
		under = topEl && topEl.closest ? topEl.closest(".dt-column") : null;
	} catch (e1) {}
	if (under) return under;
	if (_dtLastColumnEl && document.body.contains(_dtLastColumnEl)) {
		if (Date.now() - _dtLastColumnTs < 180000) return _dtLastColumnEl;
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
					buildContainer(columns, wrapperEl, wrapperEl._dtCtx, plugin);
					syncToSource(wrapperEl);
					handled = true;
				} else if (isExternalUrl(text) && !/\s/.test(text)) {
					appendToColumn(columns, colIdx, text);
					buildContainer(columns, wrapperEl, wrapperEl._dtCtx, plugin);
					syncToSource(wrapperEl);
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

function buildContainer(columns, el, ctx, plugin) {
	if (_skipRebuild && el._dtBuilt) return;

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
}

/* =============================================================
   Text Column — always contenteditable
   ============================================================= */

function renderTextColumn(col, raw) {
	col.setAttribute("contenteditable", "true");
	col.setAttribute("spellcheck", "false");
	col.setAttribute("tabindex", "0");
	col.classList.add("dt-column--text");

	var display = raw.replace(/<br>/g, "\n");
	if (display) {
		col.innerText = display;
	} else {
		col.setAttribute("data-placeholder", "输入文字，或拖入图片/视频…");
	}
}

/* =============================================================
   Media Column — image thumbnail / video thumbnail + play
   ============================================================= */

function renderMedia(col, media, rawRef, plugin) {
	col.classList.add("dt-column--media");
	col.setAttribute("tabindex", "0");
	col._dtMediaRef = rawRef;

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
		if (media.isUrl) {
			img.setAttribute("referrerpolicy", "no-referrer");
		}
		img.addEventListener("error", function () {
			img.style.display = "none";
			var fallback = document.createElement("div");
			fallback.className = "dt-media-fallback";
			fallback.textContent = "图片加载失败: " + media.file;
			col.appendChild(fallback);
		});
		col.appendChild(img);
	} else if (media.type === "video") {
		var thumb = document.createElement("div");
		thumb.className = "dt-video-thumb";

		var vid = document.createElement("video");
		vid.className = "dt-video-preview";
		vid.src = url;
		vid.muted = true;
		vid.preload = "metadata";
		vid.addEventListener("loadeddata", function () {
			vid.currentTime = 1;
		});
		thumb.appendChild(vid);

		var playBtn = document.createElement("div");
		playBtn.className = "dt-video-play-btn";
		playBtn.innerHTML =
			'<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" ' +
			'viewBox="0 0 24 24" fill="white" stroke="none">' +
			'<polygon points="5,3 19,12 5,21"/></svg>';
		thumb.appendChild(playBtn);

		thumb.addEventListener("click", function (e) {
			e.stopPropagation();
			openVideoPlayer(url, plugin);
		});
		col.appendChild(thumb);
	}
}

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
				col.appendChild(img);
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

function serializeColumnContent(col) {
	var result = [];

	function walk(node) {
		if (node.nodeType === 3) {
			result.push(node.textContent);
		} else if (node.nodeName === "BR") {
			result.push("<br>");
		} else if (node.nodeName === "IMG") {
			var ref = node._dtMediaRef || node.getAttribute("data-media-ref");
			if (ref) result.push(ref);
		} else if (node.classList && node.classList.contains("dt-video-thumb")) {
			var vRef = node._dtMediaRef || node.getAttribute("data-media-ref");
			if (vRef) result.push(vRef);
		} else if (node.classList && node.classList.contains("dt-media-fallback")) {
			/* skip fallback elements */
		} else if (node.nodeType === 1) {
			if (node.nodeName === "DIV") {
				result.push("<br>");
			}
			for (var i = 0; i < node.childNodes.length; i++) {
				walk(node.childNodes[i]);
			}
		}
	}

	for (var i = 0; i < col.childNodes.length; i++) {
		walk(col.childNodes[i]);
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

	var next = media.nextSibling;
	if (next && next.nodeName === "BR") {
		next.parentNode.removeChild(next);
	} else {
		var prev = media.previousSibling;
		if (prev && prev.nodeName === "BR") prev.parentNode.removeChild(prev);
	}
	media.parentNode.removeChild(media);

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
			e.preventDefault();
			document.execCommand("insertLineBreak");
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
					buildContainer(columns, wrapperEl, wrapperEl._dtCtx, plugin);
					syncToSource(wrapperEl);
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

	col.addEventListener("input", function () {
		var stored = serializeColumnContent(col);
		columns[colIdx] = stored;

		if (stored.trim() === "") {
			col.setAttribute("data-placeholder", "输入文字，或拖入图片/视频…");
		} else {
			col.removeAttribute("data-placeholder");
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
	});

	col.addEventListener("blur", function () {
		_activeEditCol = null;
		var stored = serializeColumnContent(col);
		columns[colIdx] = stored;
		if (stored.trim() === "") {
			col.setAttribute("data-placeholder", "输入文字，或拖入图片/视频…");
		}
		debouncedSync(wrapperEl);
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
	_skipRebuild = true;
	syncToSource(wrapperEl);
	setTimeout(function () { _skipRebuild = false; }, 600);
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
		buildContainer(columns, wrapperEl, wrapperEl._dtCtx, plugin);
		syncToSource(wrapperEl);
	});

	strip.appendChild(btn);
	return strip;
}

/* =============================================================
   Drag & Drop
   ============================================================= */

function bindDragDrop(col, columns, colIdx, wrapperEl, plugin) {
	col.addEventListener("dragover", function (e) {
		e.preventDefault(); e.stopPropagation();
		col.classList.add("dt-column--dragover");
	});
	col.addEventListener("dragleave", function () {
		col.classList.remove("dt-column--dragover");
	});
	col.addEventListener("drop", function (e) {
		e.preventDefault(); e.stopPropagation();
		col.classList.remove("dt-column--dragover");
		var dt = e.dataTransfer;
		if (!dt) return;

		var capturedRef = _draggingMedia;
		var capturedFn = _draggedFileName;
		var capturedLine = _dragSourceLine;
		var capturedRaw = _dragSourceRaw;
		_draggingMedia = null;
		_draggedFileName = null;
		_dragSourceLine = -1;
		_dragSourceRaw = "";

		/* 从笔记内拖放（文件库内的本地资源） */
		if (capturedRef) {
			appendToColumn(columns, colIdx, capturedRef);
			buildContainer(columns, wrapperEl, wrapperEl._dtCtx, plugin);
			syncToSource(wrapperEl);
			scheduleErase(plugin, capturedLine, capturedRaw, capturedFn);
			return;
		}

		var plain = (dt.getData("text/plain") || "").trim();
		if (plain) {
			var mediaRef = parseMediaRef(plain);
			if (mediaRef && !mediaRef.isUrl) {
				appendToColumn(columns, colIdx, plain);
				buildContainer(columns, wrapperEl, wrapperEl._dtCtx, plugin);
				syncToSource(wrapperEl);
				scheduleErase(plugin, capturedLine, capturedRaw, capturedFn || getBaseName(normalizeName(mediaRef.file)));
				return;
			}
		}

		/* 从系统/资源管理器拖入文件 */
		if (dt.files && dt.files.length > 0) {
			handleFileDrop(col, dt.files[0], columns, colIdx, wrapperEl, plugin, capturedLine, capturedRaw, capturedFn);
			return;
		}

		/* 从浏览器拖入图片：优先走 HTML（含 <img>），自动下载到本地 */
		var html = dt.getData("text/html");
		var imgFromHtml = html ? extractImageFromHtml(html) : null;
		if (imgFromHtml) {
			if (/^data:image\//i.test(imgFromHtml)) {
				handleDataUriImage(imgFromHtml, columns, colIdx, wrapperEl, plugin);
				return;
			}
			if (/^https?:\/\//i.test(imgFromHtml)) {
				insertRemoteMedia(imgFromHtml, columns, colIdx, wrapperEl, plugin);
				return;
			}
		}

		/* 浏览器拖入会同时给 text/uri-list 与 text/plain（图片URL）。
		   命中已知图片特征 → 立即下载；
		   未命中 → 先按文字插入，再后台 GET 探测自动升级。 */
		var uriList = (dt.getData("text/uri-list") || "").split(/\r?\n/).filter(function (s) {
			return s && !s.startsWith("#");
		});
		var firstUri = uriList[0] || "";
		if (firstUri && /^https?:\/\//i.test(firstUri)) {
			var refUri = parseMediaRef(firstUri);
			if (refUri && refUri.isUrl) {
				insertRemoteMedia(refUri.file, columns, colIdx, wrapperEl, plugin);
				return;
			}
			/* 未识别的 https URL：先文字插入 + 后台探测 */
			appendToColumn(columns, colIdx, firstUri);
			buildContainer(columns, wrapperEl, wrapperEl._dtCtx, plugin);
			syncToSource(wrapperEl);
			var mdViewU = plugin.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
			var targetFileU = mdViewU && mdViewU.file ? mdViewU.file : null;
			maybeUpgradeUrlToImageInBackground(plugin, firstUri, targetFileU);
			return;
		}

		if (plain) {
			if (/^data:image\//i.test(plain)) {
				handleDataUriImage(plain, columns, colIdx, wrapperEl, plugin);
				return;
			}
			var mediaRef2 = parseMediaRef(plain);
			if (mediaRef2 && mediaRef2.isUrl) {
				insertRemoteMedia(mediaRef2.file, columns, colIdx, wrapperEl, plugin);
				return;
			}
			if (mediaRef2) {
				/* 本地资源引用 */
				appendToColumn(columns, colIdx, plain);
				buildContainer(columns, wrapperEl, wrapperEl._dtCtx, plugin);
				syncToSource(wrapperEl);
				return;
			}
			if (isExternalUrl(plain) && !/\s/.test(plain)) {
				/* 未识别的 https 文本 URL：文字插入 + 后台探测 */
				appendToColumn(columns, colIdx, plain);
				buildContainer(columns, wrapperEl, wrapperEl._dtCtx, plugin);
				syncToSource(wrapperEl);
				var mdViewP = plugin.app.workspace.getActiveViewOfType(obsidian.MarkdownView);
				var targetFileP = mdViewP && mdViewP.file ? mdViewP.file : null;
				maybeUpgradeUrlToImageInBackground(plugin, plain, targetFileP);
				return;
			}
			/* 普通文本 */
			appendToColumn(columns, colIdx, plain);
			buildContainer(columns, wrapperEl, wrapperEl._dtCtx, plugin);
			syncToSource(wrapperEl);
		}
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
			var safeName = file.name.replace(/[\\/:*?"<>|]/g, "_");
			var assetsPath = "assets";
			try {
				if (!plugin.app.vault.getAbstractFileByPath(assetsPath)) {
					await plugin.app.vault.createFolder(assetsPath);
				}
			} catch (err) {}

			var filePath = assetsPath + "/" + safeName;
			var existing = plugin.app.vault.getAbstractFileByPath(filePath);
			if (existing) {
				await plugin.app.vault.modifyBinary(existing, ab);
			} else {
				await plugin.app.vault.createBinary(filePath, ab);
			}

			var newRef;
			if (file.type.startsWith("image/") || file.type.startsWith("video/")) {
				newRef = "![[" + safeName + "]]";
			} else {
				newRef = new TextDecoder().decode(ab);
			}

			appendToColumn(columns, colIdx, newRef);
			buildContainer(columns, wrapperEl, wrapperEl._dtCtx, plugin);
			syncToSource(wrapperEl);

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

async function downloadRemoteMediaToVault(plugin, url) {
	try {
		var resp = await obsidian.requestUrl({ url: url, method: "GET", throw: false });
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
 * 锁定到指定文件做替换：先尝试已打开的编辑器（保留光标），失败则改写磁盘内容
 */
async function replacePlaceholderInFile(plugin, targetFile, oldText, newText) {
	if (!targetFile) return false;
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
		if (content.indexOf(oldText) < 0) return false;
		var updated = content.split(oldText).join(newText);
		await plugin.app.vault.modify(targetFile, updated);
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
 * 优先把远程图片下载为本地资源；失败则回退为 ![](url) 远程引用。
 * 立即在 UI 中显示远程图片占位，下载完成后无缝替换为本地引用。
 *
 * 关键设计：异步阶段不再依赖 wrapperEl / columns 这些"会被 Obsidian 重渲染替换掉的对象"，
 * 而是锁定 targetFile，通过 editor 或 vault.modify 直接对文件做文本替换。
 */
function insertRemoteMedia(url, columns, colIdx, wrapperEl, plugin) {
	/* 占位用一个极不易冲突的唯一标识，避免与笔记中其他相同 URL 的引用混淆 */
	var token = "__DT_REMOTE_" + Date.now() + "_" + Math.floor(Math.random() * 1e9) + "__";
	var placeholder = "![](" + url + "#" + token + ")";

	appendToColumn(columns, colIdx, placeholder);
	buildContainer(columns, wrapperEl, wrapperEl._dtCtx, plugin);
	syncToSource(wrapperEl);

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
	var safeName = file.name
		? file.name.replace(/[\\/:*?"<>|]/g, "_")
		: "paste_" + Date.now() + "." + ext;

	var reader = new FileReader();
	reader.onload = async function () {
		try {
			var ab = reader.result;
			var assetsPath = "assets";
			try {
				if (!plugin.app.vault.getAbstractFileByPath(assetsPath)) {
					await plugin.app.vault.createFolder(assetsPath);
				}
			} catch (err) {}

			var filePath = assetsPath + "/" + safeName;
			var existing = plugin.app.vault.getAbstractFileByPath(filePath);
			if (existing) {
				await plugin.app.vault.modifyBinary(existing, ab);
			} else {
				await plugin.app.vault.createBinary(filePath, ab);
			}

			appendToColumn(columns, colIdx, "![[" + safeName + "]]");
			buildContainer(columns, wrapperEl, wrapperEl._dtCtx, plugin);
			syncToSource(wrapperEl);
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
		var replacement = "```" + CODEBLOCK_LANG + "\n" + newBody + "\n```";

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
			if (!range) return;

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
