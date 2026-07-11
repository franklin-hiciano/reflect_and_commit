// ── DSL editor + node canvas ─────────────────────────────────────────────
//
// Replaces the old click-heavy block editor (tree-editor.js) and its
// read-only graph (dsl-graph.js). The raw DSL text (js/tree-model.js) IS
// the tree now — there's no separate array schema to keep in sync. This
// file renders TWO views of that same text side by side:
//   - a plain textarea with a thin "+" gutter next to any question that
//     doesn't lead anywhere yet
//   - an editable node canvas: drag a card's "+" onto empty space to name
//     a new connected question, or onto another card to wire up an
//     existing one; a small recall icon lets any question recall any
//     OTHER question's past answers (not just its own)
// Both write back through window.setDslText(newText, selRange) — app.js
// owns persistence (local + Firestore) and calls window.renderDslEditor()
// after any external change (sign-in, remote sync).
"use strict";

(function () {
  const LINE_H = 21;
  const COL_W = 220, ROW_H = 88, CARD_W = 180, CARD_H = 64, PAD = 26;

  let _pane = "dsl"; // mobile-only pane switcher
  let _recallOpenFor = null; // block name whose recall popover is open
  let _plusDrag = null; // { fromName, x, y } — canvas-local coords
  let _naming = null; // { fromName, x, y } — "type a new question" popover, opened by clicking OR dragging a "+" to empty space
  let _dragFromLine = null; // textarea native drag-reorder source line
  let _historyOpen = false;
  let _cardDrag = null; // { name, x, y } — dragging an existing card onto another to link it
  let _editingName = null; // block name currently being renamed inline on the canvas
  // Paired Editing: when ON, renaming a declaration cascades to every
  // reference and vice versa (already the default behaviour). When OFF, the
  // cascade is suppressed so you can freely rename a single reference without
  // touching the declaration or any other copy. Toggled from the corner button.
  let _pairedEditing = true;

  function TM() { return window.TreeModel; }
  function text() { return window.dslText || ""; }
  function ta() { return document.getElementById("dslTextarea"); }
  function mobile() { return typeof isPhone === "function" ? isPhone() : (window.matchMedia("(pointer: coarse)").matches && window.innerWidth < 820); }

  // ── boot: build the static skeleton once; every subsequent change just
  // re-renders into it. ────────────────────────────────────────────────
  window.initDslEditor = function () {
    const host = document.getElementById("dslHome");
    if (!host || host._built) return;
    host._built = true;
    // no pane titles, no divider — the two squircles (dsl-editor-wrap,
    // canvas-viewport) fill the space themselves; every control that used
    // to live in a header row above them is now a small overlay tucked in
    // a corner instead. Each squircle's OWN scroll region is nested one
    // level in (dsl-editor-scroll / canvas-scroll) so those corner overlays
    // stay put in the viewport instead of scrolling away with the content.
    host.innerHTML =
      '<div class="dsl-pane-switch" id="dslPaneSwitch">' +
        '<button class="dsl-pane-btn" id="paneBtnDsl">dsl editor</button>' +
        '<button class="dsl-pane-btn" id="paneBtnCanvas">node canvas</button>' +
      "</div>" +
      '<div class="dsl-split" id="dslSplit">' +
        '<div class="dsl-pane" id="dslPane">' +
          '<div class="dsl-editor-wrap">' +
            '<div class="squircle-corner-tools">' +
              '<button class="squircle-corner-btn" id="pairedEditingBtn" title="paired editing — editing any reference or declaration also updates all other copies">' +
                '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2"/><rect x="9" y="3" width="12" height="12" rx="2"/></svg>' +
              '</button>' +
              '<button class="squircle-corner-btn" id="canvasPreviewBtn" title="preview — walk through this tree right now, nothing saved">' +
                '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>' +
              '</button>' +
              '<button class="squircle-corner-btn" id="copyDslBtn" title="copy the tree text">' +
                '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>' +
              '</button>' +
              '<button class="squircle-corner-btn" id="historyToggleBtn" title="version history">' +
                '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /><path d="M12 8v4l3 2" /></svg>' +
              '</button>' +
            '</div>' +
            '<div class="history-dropdown" id="historyDropdown">' +
              '<div class="history-snapshots" id="historySnapshots"></div>' +
            "</div>" +
            '<div class="dsl-editor-scroll">' +
              '<div class="dsl-inner" id="dslInner">' +
                '<textarea id="dslTextarea" class="dsl-textarea" spellcheck="false" wrap="off" placeholder="write your first question…"></textarea>' +
              "</div>" +
            "</div>" +
          "</div>" +
        "</div>" +
        '<div class="canvas-pane" id="canvasPane">' +
          '<div class="canvas-viewport" id="canvasViewport">' +
            '<div class="canvas-scroll">' +
              '<div class="canvas-content" id="canvasContent"></div>' +
            "</div>" +
          "</div>" +
          '<div class="dsl-warning" id="dslWarning"></div>' +
        "</div>" +
      "</div>";

    document.getElementById("paneBtnDsl").onclick = () => setPane("dsl");
    document.getElementById("paneBtnCanvas").onclick = () => setPane("canvas");
    document.getElementById("historyToggleBtn").onclick = toggleHistory;
    document.getElementById("canvasPreviewBtn").onclick = startPreview;
    const copyBtn = document.getElementById("copyDslBtn");
    if (copyBtn) copyBtn.onclick = copyDslText;
    const pairedBtn = document.getElementById("pairedEditingBtn");
    pairedBtn.classList.toggle("on", _pairedEditing);
    pairedBtn.onclick = () => {
      _pairedEditing = !_pairedEditing;
      pairedBtn.classList.toggle("on", _pairedEditing);
      pairedBtn.title = _pairedEditing
        ? "paired editing ON — editing any reference or declaration also updates all copies"
        : "paired editing OFF — edits are isolated to the line you type on";
    };

    const el = ta();
    el.addEventListener("input", (e) => {
      const newText = e.target.value;
      const oldText = window.dslText || "";
      const cursor = e.target.selectionStart;
      // only cascade renames to other lines when paired editing is enabled—
      // typing with it OFF just changes this line alone (raw DSL text).
      const finalText = _pairedEditing
        ? window._cascadeRenameIfHeaderEdited(oldText, newText, cursor)
        : newText;
      if (finalText === newText) {
        // textarea already holds finalText; renderDslPane won't reassign
        // el.value (its guard), so the caret stays put on its own.
        window.setDslText(finalText);
        return;
      }
      // A paired-rename cascade rewrote OTHER lines, so finalText differs from
      // what's in the box and renderDslPane will reassign el.value — which
      // drops the caret to the very end (this was the "kicked to the end after
      // one character" bug). The line under the caret is never itself touched
      // by the cascade, so remember the caret as (line, column) and restore it
      // against finalText after the re-render.
      const before = newText.slice(0, cursor);
      const line = (before.match(/\n/g) || []).length;
      const col = cursor - (before.lastIndexOf("\n") + 1);
      window.setDslText(finalText);
      const fLines = finalText.split("\n");
      let off = 0;
      for (let i = 0; i < line && i < fLines.length; i++) off += fLines[i].length + 1;
      off += Math.min(col, (fLines[line] || "").length);
      try { el.setSelectionRange(off, off); } catch (_) {}
    });
    el.addEventListener("dragstart", onDslDragStart);
    el.addEventListener("dragover", (e) => e.preventDefault());
    el.addEventListener("drop", onDslDrop);
  };

  function setPane(p) {
    _pane = p;
    window.renderDslEditor();
  }

  // ── history (version snapshots) — kept here since it's part of the
  // editor's own UI; app.js just persists whatever setDslText hands it. ──
  let _snapshots = [{ ts: Date.now(), text: "" }];
  let _snapIndex = 0;
  let _charAccum = 0;
  let _nextThreshold = pickThreshold();
  function pickThreshold() { return 40 + Math.floor(Math.random() * 41); } // 40-80
  function diffSize(a, b) {
    let i = 0; const n = Math.min(a.length, b.length);
    while (i < n && a[i] === b[i]) i++;
    let j = 0;
    while (j < n - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
    return Math.max(0, a.length - i - j) + Math.max(0, b.length - i - j);
  }
  // extraWeight lets a structural canvas edit (add/delete/connect/rename a
  // node, toggle star/recall, reorder) count as "a bunch of words" even
  // when the raw text diff is small (e.g. adding a node might only insert
  // a couple short lines) — otherwise a run of canvas actions could go a
  // long time without ever crossing the threshold. Typed edits pass no
  // extraWeight and rely on the plain character diff.
  window._noteDslSnapshot = function (oldText, newText, extraWeight) {
    const delta = diffSize(oldText, newText) + (extraWeight || 0);
    if (_snapIndex < _snapshots.length - 1) _snapshots = _snapshots.slice(0, _snapIndex + 1);
    _charAccum += delta;
    if (_charAccum >= _nextThreshold) {
      _snapshots = _snapshots.concat([{ ts: Date.now(), text: newText }]);
      _snapIndex = _snapshots.length - 1;
      _charAccum = 0;
      _nextThreshold = pickThreshold();
    }
  };
  function toggleHistory() {
    _historyOpen = !_historyOpen;
    window.renderDslEditor();
  }

  // ── copy the whole tree text to the clipboard, with a brief confirmation
  // and an execCommand fallback for browsers without the async clipboard API
  // (or where it's blocked). This is what the corner "copy" button does. ──
  function copyDslText() {
    const t = text();
    const btn = document.getElementById("copyDslBtn");
    const flash = () => {
      if (!btn) return;
      btn.classList.add("copied");
      btn.title = "copied";
      clearTimeout(btn._copyTimer);
      btn._copyTimer = setTimeout(() => { btn.classList.remove("copied"); btn.title = "copy the tree text"; }, 1200);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(flash).catch(() => fallbackCopy(t, flash));
    } else {
      fallbackCopy(t, flash);
    }
  }
  function fallbackCopy(t, done) {
    try {
      const scratch = document.createElement("textarea");
      scratch.value = t;
      scratch.style.position = "fixed";
      scratch.style.left = "-9999px";
      document.body.appendChild(scratch);
      scratch.focus();
      scratch.select();
      const ok = document.execCommand && document.execCommand("copy");
      document.body.removeChild(scratch);
      if (ok) done && done();
    } catch (_) {}
  }
  function scrubTo(i) {
    const snap = _snapshots[i];
    if (!snap) return;
    _charAccum += diffSize(text(), snap.text);
    _snapIndex = i;
    window.setDslText(snap.text);
  }

  // ── mutate helper: every canvas/gutter action funnels through here so
  // selection restoration + snapshotting stay in one place. A flat weight
  // of 40 ("a bunch of words") is passed for every one of these structural
  // edits — see _noteDslSnapshot. ─────────────────────────────────────────
  function mutate(newText, selRange) {
    window.setDslText(newText, selRange, 40);
  }

  function restoreSelection(sel) {
    if (!sel) return;
    requestAnimationFrame(() => {
      const el = ta();
      if (!el) return;
      el.focus();
      el.setSelectionRange(sel.selStart, sel.selEnd);
    });
  }
  window._restoreDslSelection = restoreSelection;

  // ── a question's title can appear on two kinds of line: its own
  // declaration (depth 0), or a reference to it elsewhere (depth 1 — a
  // bare next-target, a labelled choice option, or `recall X`). Editing
  // EITHER one now cascades to every other occurrence, so "question 4"
  // showing up in 2 places stays in sync regardless of which copy you
  // touch, instead of only working when you happen to edit the
  // declaration. ───────────────────────────────────────────────────────
  window._cascadeRenameIfHeaderEdited = function (oldText, newText, cursor) {
    const t = TM();
    if (!t) return newText;
    const newLines = newText.split("\n");
    let acc = 0, lineIdx = 0;
    for (let i = 0; i < newLines.length; i++) {
      if (cursor <= acc + newLines[i].length) { lineIdx = i; break; }
      acc += newLines[i].length + 1;
      lineIdx = i;
    }
    const oldLines = oldText.split("\n");
    if (lineIdx >= oldLines.length) return newText;
    const oldLineRaw = oldLines[lineIdx] || "";
    const newLineRaw = newLines[lineIdx] || "";
    if (oldLineRaw === newLineRaw) return newText;
    const indentOf = (s) => (s.match(/^( *)/) || [""])[0].length;
    const oldIndent = indentOf(oldLineRaw), newIndent = indentOf(newLineRaw);
    if (oldIndent !== newIndent) return newText;

    if (oldIndent === 0) {
      // editing the declaration — cascade out to every reference
      const stripStar = (s) => s.trim().replace(/^\*\s+/, "");
      const oldName = stripStar(oldLineRaw), newName = stripStar(newLineRaw);
      if (!oldName || !newName || oldName === newName) return newText;
      return t.renameReferences(newText, oldName, newName, lineIdx);
    }

    // editing a REFERENCE — same identity either way, so cascade the other
    // direction: fix the declaration and every other reference to match
    // what was just typed here, instead of silently detaching this one
    // line from the question it used to point at.
    const oldTarget = t.referenceTargetOf(oldLineRaw.trim());
    const newTarget = t.referenceTargetOf(newLineRaw.trim());
    if (!oldTarget || !newTarget || t.norm(oldTarget) === t.norm(newTarget)) return newText;
    if (!t.resolveName(t.parse(oldText), oldTarget)) return newText; // wasn't actually pointing at a real question
    return t.renameBlockTitle(newText, oldTarget, newTarget, lineIdx);
  };

  function onDslDragStart(e) {
    const el = e.target;
    const pos = el.selectionStart;
    _dragFromLine = el.value.slice(0, pos).split("\n").length - 1;
  }
  function onDslDrop(e) {
    e.preventDefault();
    if (_dragFromLine == null) return;
    const el = e.target;
    const rect = el.getBoundingClientRect();
    const y = e.clientY - rect.top + el.scrollTop - 8;
    const toLine = Math.max(0, Math.floor(y / LINE_H));
    const fromLine = _dragFromLine;
    _dragFromLine = null;
    mutate(TM().moveLine(text(), fromLine, toLine));
  }

  // ── main render ──────────────────────────────────────────────────────
  window.renderDslEditor = function () {
    if (!TM()) return;
    window.initDslEditor();
    const t = text();
    const parsed = TM().parse(t);
    const graph = TM().buildGraph(parsed);
    const dupInfo = TM().findDuplicateTitles(parsed);
    const multiRoots = TM().findMultipleRoots(parsed, graph);

    renderWarning(dupInfo, multiRoots);
    renderPaneSwitch();
    renderDslPane(t);
    renderCanvasPane(parsed, graph, dupInfo);
    renderHistoryRow();
  };

  function renderWarning(dupInfo, multiRoots) {
    const el = document.getElementById("dslWarning");
    // the canvas only ever draws the FIRST root's connected component (see
    // buildCanvas) — the rest of multiRoots are already hidden there rather
    // than drawn as if wired in, so this is just a small heads-up that more
    // exists in the text than what's on screen, not an error to fix.
    const extraRoots = multiRoots.slice(1);
    if (!dupInfo.length && !extraRoots.length) { el.style.display = "none"; return; }
    const parts = [];
    if (dupInfo.length) parts.push(dupInfo.map((d) => '"' + d.name + '"').join(", ") + " defined more than once");
    if (extraRoots.length) parts.push(extraRoots.map((n) => '"' + n + '"').join(", ") + " not connected — hidden from the canvas above until wired in");
    el.textContent = parts.join("; ");
    el.style.display = "block";
  }

  function renderPaneSwitch() {
    const wrap = document.getElementById("dslPaneSwitch");
    const isMobile = mobile();
    wrap.style.display = isMobile ? "flex" : "none";
    document.getElementById("paneBtnDsl").classList.toggle("on", _pane === "dsl");
    document.getElementById("paneBtnCanvas").classList.toggle("on", _pane === "canvas");
    const split = document.getElementById("dslSplit");
    split.classList.toggle("mobile", isMobile);
    document.getElementById("dslPane").style.display = !isMobile || _pane === "dsl" ? "flex" : "none";
    document.getElementById("canvasPane").style.display = !isMobile || _pane === "canvas" ? "flex" : "none";
  }

  function renderDslPane(t) {
    const el = ta();
    if (el.value !== t) el.value = t; // only touches value on external changes — never fights the cursor while typing
    const lineCount = (t.match(/\n/g) || []).length + 1;
    const inner = document.getElementById("dslInner");
    inner.style.height = Math.max(220, (lineCount + 2) * LINE_H) + "px";

    // gutter "+" — one per empty leaf line (a text question with nowhere to
    // go yet), sitting where the destination reference would actually be
    // typed: indented one level, on the line right below the question —
    // not off to the side of the question's own line.
    inner.querySelectorAll(".dsl-gutter-btn").forEach((n) => n.remove());
    const parsed = TM().parse(t);
    parsed.blocks.forEach((b) => {
      const empty = b.type === "text" && !b.next && !b.terminal;
      if (!empty) return;
      const btn = document.createElement("button");
      btn.className = "dsl-gutter-btn";
      btn.title = "add what happens next";
      btn.textContent = "+";
      btn.style.top = ((b.rawLine + 1) * LINE_H + 9) + "px"; // offset by textarea padding-top (8px) + 1px gap
      btn.onclick = () => {
        const uniq = TM().uniqueName(parsed, "new question");
        const res = TM().addConnectedChild(text(), b.name, uniq);
        mutate(res.text, res);
      };
      inner.appendChild(btn);
    });
  }

  // ── canvas ───────────────────────────────────────────────────────────
  // a multi-head tree is an authoring mistake, not something worth drawing
  // as if it were wired in — rather than cluttering the canvas with
  // disconnected extra "heads" (and whatever they lead to), only the first
  // root's connected component is ever drawn here. The DSL text pane still
  // shows everything untouched, so nothing is silently lost — it's just not
  // visualized as part of the tree until it's actually connected to it.
  function reachableFrom(rootName, edges) {
    const outMap = new Map();
    edges.forEach((e) => { if (!outMap.has(e.from)) outMap.set(e.from, []); outMap.get(e.from).push(e.to); });
    const seen = new Set([rootName]);
    const stack = [rootName];
    while (stack.length) {
      const cur = stack.pop();
      (outMap.get(cur) || []).forEach((n) => { if (!seen.has(n)) { seen.add(n); stack.push(n); } });
    }
    return seen;
  }

  function buildCanvas(parsed, graph) {
    const t = TM();
    const dupInfo = t.findDuplicateTitles(parsed);
    const dupNames = new Set(dupInfo.map((d) => t.norm(d.name)));
    const recallOptions = parsed.blocks.map((b) => ({ id: b.name, text: b.name || "(untitled)" }));

    let blocks = parsed.blocks;
    let terminals = graph.terminals;
    if (graph.roots && graph.roots.length > 1) {
      const visible = reachableFrom(graph.roots[0].name, graph.edges);
      blocks = blocks.filter((b) => visible.has(b.name));
      terminals = terminals.filter((tm) => visible.has(tm.from));
    }

    // where a "+" click/drag from this block would actually land: one column
    // over, offset a bit per existing outgoing thing (a real next, a "done"
    // marker, or choice options) so it doesn't sit on top of a card/terminal
    // that's already there. Approximate, not a guarantee — the real
    // tidy-tree layout re-centers parents once a child actually exists —
    // but it's the same math buildGraph itself uses, so it lands right in
    // the common (nothing there yet) case. Shown for every block regardless
    // of whether it already resolves to "done" — same as the classic
    // corner "+", adding another body line there is what turns a dead end
    // into a branching choice.
    function outCountOf(b) {
      if (b.type === "choice") return (b.options || []).length;
      if (b.next) return 1; // a real target or an isDone marker — either way something already renders at col+1/same row
      if (b.terminal) return 1; // apostrophe dead-end with no body still gets its own "done" terminal card there
      return 0;
    }
    const ghostColRow = new Map();
    blocks.forEach((b) => {
      const col = (graph.col.get(b.name) || 0) + 1;
      const row = (graph.row.get(b.name) || 0) + outCountOf(b) * 0.55;
      ghostColRow.set(b.name, { col, row });
    });

    const allRows = blocks.map((b) => graph.row.get(b.name) || 0).concat(terminals.map((tm) => tm.row || 0)).concat([...ghostColRow.values()].map((g) => g.row));
    const allCols = blocks.map((b) => graph.col.get(b.name) || 0).concat(terminals.map((tm) => tm.col || 0)).concat([...ghostColRow.values()].map((g) => g.col));
    const maxCol = allCols.length ? Math.max(...allCols) : 0;
    const minRow = allRows.length ? Math.min(...allRows) : 0;
    const maxRow = allRows.length ? Math.max(...allRows) : 0;
    const totalW = Math.max(360, PAD * 2 + (maxCol + 1) * COL_W);
    const totalH = Math.max(240, PAD * 2 + (maxRow - minRow + 1) * ROW_H);

    const xyByName = new Map();
    blocks.forEach((b) => {
      const col = graph.col.get(b.name) || 0;
      const row = (graph.row.get(b.name) || 0) - minRow;
      const cx = PAD + col * COL_W + CARD_W / 2, cy = PAD + row * ROW_H + CARD_H / 2;
      xyByName.set(b.name, { x: cx - CARD_W / 2, y: cy - CARD_H / 2, cx, cy });
    });
    const nodes = blocks.map((b) => {
      const p = xyByName.get(b.name) || { x: 0, y: 0 };
      const g = ghostColRow.get(b.name);
      const ghost = g ? { x: PAD + g.col * COL_W, y: PAD + (g.row - minRow) * ROW_H } : null;
      return {
        id: b.name, name: b.name, text: b.name || "(untitled)", star: !!b.star, isChoice: b.type === "choice",
        isTerminal: false, isDuplicate: dupNames.has(t.norm(b.name)), recallTarget: b.recallTarget,
        x: p.x, y: p.y, w: CARD_W, h: CARD_H, ghost,
      };
    });
    terminals.forEach((term) => {
      const col = term.col || 0, row = (term.row || 0) - minRow;
      const cx = PAD + col * COL_W + CARD_W / 2, cy = PAD + row * ROW_H + CARD_H / 2;
      xyByName.set(term.id, { x: cx - CARD_W / 2, y: cy - CARD_H / 2, cx, cy });
      nodes.push({ id: term.id, name: null, text: "done", star: false, isChoice: false, isTerminal: true, isDuplicate: false, recallTarget: null, x: cx - CARD_W / 2, y: cy - CARD_H / 2, w: CARD_W, h: CARD_H });
    });

    function edgePath(a, b) {
      const x1 = a.x + CARD_W, x2 = b.x;
      const midX = x1 + (x2 - x1) / 2;
      return "M " + x1 + " " + a.cy + " C " + midX + " " + a.cy + ", " + midX + " " + b.cy + ", " + x2 + " " + b.cy;
    }
    const edges = graph.edges.map((e) => {
      const a = xyByName.get(e.from), b = xyByName.get(e.to);
      return a && b ? { d: edgePath(a, b) } : null;
    }).filter(Boolean);
    terminals.forEach((term) => {
      const a = xyByName.get(term.from), b = xyByName.get(term.id);
      if (a && b) edges.push({ d: edgePath(a, b) });
    });
    const recallEdges = graph.recallEdges.map((e) => {
      const a = xyByName.get(e.from), b = xyByName.get(e.to);
      return a && b ? { d: edgePath(a, b) } : null;
    }).filter(Boolean);
    const ghostEdges = nodes.filter((n) => n.ghost).map((n) => {
      const a = xyByName.get(n.name);
      const b = { x: n.ghost.x, cy: n.ghost.y + CARD_H / 2 };
      return a ? { d: edgePath(a, b) } : null;
    }).filter(Boolean);

    return { nodes, edges, recallEdges, ghostEdges, w: totalW, h: totalH, recallOptions };
  }

  function renderCanvasPane(parsed, graph, dupInfo) {
    const canvas = buildCanvas(parsed, graph);
    const content = document.getElementById("canvasContent");
    content.style.width = canvas.w + "px";
    content.style.height = canvas.h + "px";
    content.innerHTML = "";

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", canvas.w);
    svg.setAttribute("height", canvas.h);
    svg.style.position = "absolute"; svg.style.left = "0"; svg.style.top = "0"; svg.style.pointerEvents = "none";
    canvas.edges.forEach((e) => {
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", e.d); p.setAttribute("fill", "none"); p.setAttribute("stroke", "var(--line)"); p.setAttribute("stroke-width", "1.6");
      svg.appendChild(p);
    });
    canvas.recallEdges.forEach((e) => {
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", e.d); p.setAttribute("fill", "none"); p.setAttribute("stroke", "var(--gold-dim)"); p.setAttribute("stroke-width", "1.4"); p.setAttribute("stroke-dasharray", "3 4");
      svg.appendChild(p);
    });
    canvas.ghostEdges.forEach((e) => {
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", e.d); p.setAttribute("fill", "none"); p.setAttribute("stroke", "var(--line)"); p.setAttribute("stroke-width", "1.2"); p.setAttribute("stroke-dasharray", "1 5");
      svg.appendChild(p);
    });
    if (_plusDrag) {
      const from = canvas.nodes.find((n) => n.name === _plusDrag.fromName);
      if (from) {
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", from.x + CARD_W); line.setAttribute("y1", from.y + CARD_H / 2);
        line.setAttribute("x2", _plusDrag.x); line.setAttribute("y2", _plusDrag.y);
        line.setAttribute("stroke", "var(--ink-dim)"); line.setAttribute("stroke-width", "1.4"); line.setAttribute("stroke-dasharray", "2 4");
        svg.appendChild(line);
      }
    }
    if (_cardDrag) {
      const from = canvas.nodes.find((n) => n.name === _cardDrag.name);
      if (from) {
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", from.x + CARD_W / 2); line.setAttribute("y1", from.y + CARD_H / 2);
        line.setAttribute("x2", _cardDrag.x); line.setAttribute("y2", _cardDrag.y);
        line.setAttribute("stroke", "var(--gold-dim)"); line.setAttribute("stroke-width", "1.4"); line.setAttribute("stroke-dasharray", "2 4");
        svg.appendChild(line);
      }
    }
    content.appendChild(svg);

    canvas.nodes.forEach((n) => content.appendChild(buildCardEl(n, canvas.recallOptions)));

    canvas.nodes.filter((n) => n.ghost).forEach((n) => content.appendChild(buildGhostSlotEl(n)));

    if (_naming) {
      const wrap = document.createElement("div");
      wrap.className = "canvas-naming"; wrap.style.left = _naming.x + "px"; wrap.style.top = _naming.y + "px";
      const input = document.createElement("input");
      input.type = "text"; input.placeholder = "new question…"; input.autofocus = true;
      wrap.appendChild(input);
      content.appendChild(wrap);
      setTimeout(() => input.focus(), 0);
      let done = false;
      const commit = () => {
        if (done) return; done = true;
        const val = input.value.trim();
        const fromName = _naming.fromName;
        _naming = null;
        if (val) {
          const res = TM().addConnectedChild(text(), fromName, val);
          mutate(res.text, res);
        } else window.renderDslEditor();
      };
      const cancel = () => { if (done) return; done = true; _naming = null; window.renderDslEditor(); };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        else if (e.key === "Escape") { e.preventDefault(); cancel(); }
      });
      input.addEventListener("blur", commit);
    }
  }

  function buildCardEl(n, recallOptions) {
    const isTerm = n.isTerminal;
    const card = document.createElement("div");
    card.className = "canvas-card" + (isTerm ? " terminal" : "") + (n.isDuplicate ? " duplicate" : "") + (n.isChoice ? " choice" : "") + (n.star ? " star" : "");
    card.style.left = n.x + "px"; card.style.top = n.y + "px"; card.style.width = n.w + "px"; card.style.height = n.h + "px";
    card.dataset.canvasCard = n.name || "";

    if (n.star) {
      const star = document.createElement("div");
      star.className = "canvas-star-badge"; star.title = "tonight's minimum"; star.textContent = "★";
      card.appendChild(star);
    }

    const label = document.createElement("div");
    label.className = "canvas-card-text";
    if (!isTerm && n.name && _editingName !== n.name) {
      label.classList.add("editable");
      label.title = "click to rename — updates everywhere this question is used";
      label.onclick = (e) => { e.stopPropagation(); _editingName = n.name; window.renderDslEditor(); };
    }
    if (_editingName === n.name && !isTerm) {
      const input = document.createElement("textarea");
      input.className = "canvas-card-text-input"; input.value = n.name; input.rows = 1;
      label.appendChild(input);
      setTimeout(() => { input.focus(); input.select(); }, 0);
      let done = false;
      const commit = () => {
        if (done) return; done = true;
        const val = input.value.trim();
        _editingName = null;
        if (val && val !== n.name) {
          // renameBlockTitle updates the declaration + every reference;
          // when paired editing is off, only update the declaration line
          // (leaves references as-is, effectively detaching this rename).
          if (_pairedEditing) {
            mutate(TM().renameBlockTitle(text(), n.name, val));
          } else {
            // raw text replace of just the declaration line
            const t = text();
            const lines = t.split("\n");
            const parsed = TM().parse(t);
            const block = parsed.blocks.find(b => b.name === n.name);
            if (block != null && lines[block.rawLine] != null) {
              lines[block.rawLine] = lines[block.rawLine].replace(n.name, val);
              mutate(lines.join("\n"));
            } else {
              mutate(TM().renameBlockTitle(t, n.name, val));
            }
          }
        } else window.renderDslEditor();
      };
      const cancel = () => { if (done) return; done = true; _editingName = null; window.renderDslEditor(); };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); commit(); }
        else if (e.key === "Escape") { e.preventDefault(); cancel(); }
      });
      input.addEventListener("blur", commit);
      input.addEventListener("mousedown", (e) => e.stopPropagation());
    } else {
      label.textContent = n.text;
    }
    card.appendChild(label);

    if (n.isChoice) {
      const tag = document.createElement("div");
      tag.className = "canvas-card-tag"; tag.textContent = "choice";
      card.appendChild(tag);
    }
    if (n.isDuplicate) {
      const tag = document.createElement("div");
      tag.className = "canvas-card-tag dup"; tag.textContent = "duplicate title";
      card.appendChild(tag);
    }

    if (!isTerm) {
      const del = document.createElement("button");
      del.className = "canvas-del-btn"; del.title = "delete"; del.textContent = "✕";
      del.onclick = (e) => { e.stopPropagation(); mutate(TM().deleteBlock(text(), n.name)); };
      card.appendChild(del);

      // Right-click to delete (desktop), long-press to delete (mobile/touch)
      let _holdTimer = null;
      card.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        if (confirm('Delete "' + n.name + '"?')) mutate(TM().deleteBlock(text(), n.name));
      });
      card.addEventListener("touchstart", (e) => {
        _holdTimer = setTimeout(() => {
          _holdTimer = null;
          if (confirm('Delete "' + n.name + '"?')) mutate(TM().deleteBlock(text(), n.name));
        }, 700);
      }, { passive: true });
      card.addEventListener("touchend", () => { clearTimeout(_holdTimer); _holdTimer = null; }, { passive: true });
      card.addEventListener("touchmove", () => { clearTimeout(_holdTimer); _holdTimer = null; }, { passive: true });

      const recall = document.createElement("button");
      recall.className = "canvas-recall-btn" + (n.recallTarget ? " on" : "");
      recall.title = "recall another question's past answers";
      recall.innerHTML = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></svg>';
      recall.onclick = (e) => { e.stopPropagation(); _recallOpenFor = _recallOpenFor === n.name ? null : n.name; window.renderDslEditor(); };
      card.appendChild(recall);

      // the "+" itself lives at the ghost slot (see buildGhostSlotEl), drawn
      // at the actual spot the next question would land, not pinned to the
      // card corner — the card body itself is the drag handle for linking
      // this question in elsewhere.
      card.addEventListener("mousedown", (e) => {
        if (e.target.closest(".canvas-card-text, .canvas-del-btn, .canvas-recall-btn, .canvas-recall-popover, textarea, input")) return;
        startCardDrag(e, n.name);
      });
    }

    if (_recallOpenFor === n.name) {
      const pop = document.createElement("div");
      pop.className = "canvas-recall-popover";
      const hdr = document.createElement("div"); hdr.className = "canvas-recall-popover-hdr"; hdr.textContent = "recall answers from…";
      pop.appendChild(hdr);
      const none = document.createElement("button");
      none.className = "canvas-recall-opt none"; none.textContent = "— none —";
      none.onclick = (e) => { e.stopPropagation(); mutate(TM().setRecall(text(), n.name, null)); _recallOpenFor = null; };
      pop.appendChild(none);
      recallOptions.forEach((opt) => {
        const b = document.createElement("button");
        b.className = "canvas-recall-opt"; b.textContent = opt.text;
        b.onclick = (e) => { e.stopPropagation(); mutate(TM().setRecall(text(), n.name, opt.id)); _recallOpenFor = null; };
        pop.appendChild(b);
      });
      card.appendChild(pop);
    }

    return card;
  }

  function canvasWrap() { return document.getElementById("canvasContent"); }

  function startPlusDrag(e, fromName) {
    e.preventDefault();
    const wrap = canvasWrap();
    const rect0 = wrap.getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY;
    let moved = false;
    _plusDrag = { fromName, x: e.clientX - rect0.left, y: e.clientY - rect0.top };
    window.renderDslEditor();
    const onMove = (ev) => {
      if (Math.abs(ev.clientX - startX) > 5 || Math.abs(ev.clientY - startY) > 5) moved = true;
      const r2 = wrap.getBoundingClientRect();
      _plusDrag = { fromName, x: ev.clientX - r2.left, y: ev.clientY - r2.top };
      window.renderDslEditor();
    };
    const onUp = (ev) => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      _plusDrag = null;
      const rect2 = wrap.getBoundingClientRect();
      const dropX = ev.clientX - rect2.left, dropY = ev.clientY - rect2.top;
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const cardEl = el && el.closest ? el.closest("[data-canvas-card]") : null;
      if (cardEl && cardEl.dataset.canvasCard) {
        const targetName = cardEl.dataset.canvasCard;
        if (targetName && targetName !== fromName) mutate(TM().connectExisting(text(), fromName, targetName));
        else window.renderDslEditor();
        return;
      }
      _naming = { fromName, x: dropX, y: dropY };
      window.renderDslEditor();
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  // grabbing an EXISTING card (anywhere but its text/buttons) and dropping it
  // onto another card links it there too — the same relationship
  // connectExisting already builds via dragging a "+" onto an existing card,
  // just initiated from the other end: "grab the question you want to
  // reuse, drop it where it should also happen."
  function startCardDrag(e, name) {
    e.preventDefault();
    const wrap = canvasWrap();
    const rect0 = wrap.getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY;
    let moved = false;
    const onMove = (ev) => {
      if (Math.abs(ev.clientX - startX) > 5 || Math.abs(ev.clientY - startY) > 5) moved = true;
      if (!moved) return;
      const r2 = wrap.getBoundingClientRect();
      _cardDrag = { name, x: ev.clientX - r2.left, y: ev.clientY - r2.top };
      window.renderDslEditor();
    };
    const onUp = (ev) => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      _cardDrag = null;
      if (!moved) { window.renderDslEditor(); return; }
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const cardEl = el && el.closest ? el.closest("[data-canvas-card]") : null;
      const targetName = cardEl && cardEl.dataset.canvasCard;
      if (targetName && targetName !== name) mutate(TM().connectExisting(text(), targetName, name));
      else window.renderDslEditor();
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  }

  // ghost slot: the "+" now lives where the next question would actually be
  // drawn (see buildCanvas's ghostColRow) instead of pinned to the card
  // corner. Both a click and a drag-to-empty-space open the same "type a
  // new question" popover (_naming); dragging it onto an existing card
  // links that question in instead (connectExisting).
  function buildGhostSlotEl(n) {
    const el = document.createElement("div");
    el.className = "canvas-ghost-slot";
    el.style.left = n.ghost.x + "px"; el.style.top = n.ghost.y + "px"; el.style.width = CARD_W + "px"; el.style.height = CARD_H + "px";
    const plus = document.createElement("button");
    plus.className = "canvas-ghost-plus";
    plus.title = "click or drag out to add a connected question, or drag onto another card to link it";
    plus.textContent = "+";
    plus.addEventListener("mousedown", (e) => startPlusDrag(e, n.name));
    el.appendChild(plus);
    return el;
  }

  // ── preview: walk the tree exactly as tonight's reflection would, right
  // from the editor — nothing here touches the real draft, commitments, or
  // Firestore; it's a throwaway local walk so "does my tree actually work"
  // has an instant answer instead of waiting for tonight's notification. ──
  let _preview = null; // { history: [{q, a}], currentName, mode: "question" | "done" }

  window.startPreview = function () {
    const parsed = TM().parse(text());
    const graph = TM().buildGraph(parsed);
    const roots = (graph.roots || []).slice().sort((a, b) => a.rawLine - b.rawLine);
    const first = roots[0] || parsed.blocks[0];
    if (!first) { alert("Write at least one question first."); return; }
    // open the real reflection screen — answers and commitments count
    if (typeof setLastNotif === "function" && typeof openReflection === "function") {
      setLastNotif("preview");
      openReflection();
    }
  };
  function closePreview() {
    _preview = null;
    const el = document.getElementById("treePreviewModal");
    if (el) el.remove();
  }
  function previewNode() {
    return TM().resolveName(TM().parse(text()), _preview.currentName);
  }
  // mirrors app.js's computeNext, but reads the LIVE editor text (not
  // whatever's currently persisted) and needs no draft.answers bookkeeping
  function previewComputeNext(node, optIndex) {
    const parsed = TM().parse(text());
    if (node.type === "text") {
      if (node.terminal || (node.next && node.next.isDone)) return null;
      if (node.next) { const t = TM().resolveName(parsed, node.next.target); return t ? t.name : null; }
      return null;
    }
    const opt = (node.options || [])[optIndex];
    if (!opt || opt.isDone || !opt.target) return null;
    const t = TM().resolveName(parsed, opt.target);
    return t ? t.name : null;
  }
  function previewAdvance(nextName) {
    if (!nextName) { _preview.mode = "done"; renderPreview(); return; }
    _preview.currentName = nextName;
    _preview.answer = "";
    renderPreview();
  }
  function previewEscapeHtml(s) { return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  function renderPreview() {
    let modal = document.getElementById("treePreviewModal");
    if (!modal) {
      modal = document.createElement("div");
      modal.className = "tree-preview-modal"; modal.id = "treePreviewModal";
      document.body.appendChild(modal);
    }
    if (!_preview) { modal.remove(); return; }
    modal.innerHTML = "";
    const card = document.createElement("div"); card.className = "tree-preview-card";
    modal.appendChild(card);

    const close = document.createElement("button");
    close.className = "tree-preview-close"; close.textContent = "✕"; close.title = "exit preview";
    close.onclick = closePreview;
    card.appendChild(close);

    const kicker = document.createElement("div");
    kicker.className = "tree-preview-kicker";
    kicker.textContent = "preview — nothing here is saved";
    card.appendChild(kicker);

    if (_preview.mode === "done") {
      const msg = document.createElement("div");
      msg.className = "tree-preview-done"; msg.textContent = "end of this path — this is where you'd commit to something tomorrow.";
      card.appendChild(msg);
      const again = document.createElement("button");
      again.className = "btn-ghost"; again.textContent = "restart preview";
      again.onclick = window.startPreview;
      card.appendChild(again);
      return;
    }

    const node = previewNode();
    if (!node) { closePreview(); return; }

    if (_preview.history.length) {
      const past = document.createElement("div"); past.className = "tree-preview-history";
      _preview.history.forEach((h) => {
        const item = document.createElement("div"); item.className = "tree-preview-past";
        item.innerHTML = '<div class="tree-preview-past-q">' + previewEscapeHtml(h.q) + '</div><div class="tree-preview-past-a">' + previewEscapeHtml(h.a) + "</div>";
        past.appendChild(item);
      });
      card.appendChild(past);
    }

    const q = document.createElement("div");
    q.className = "tree-preview-question" + (node.star ? " star" : "");
    q.textContent = node.name;
    card.appendChild(q);

    if (node.recallTarget) {
      const parsed = TM().parse(text());
      const t = TM().resolveName(parsed, node.recallTarget);
      let hist = [];
      try { hist = JSON.parse(localStorage.getItem("rc_answer_hist_" + TM().norm(t ? t.name : node.recallTarget)) || "[]"); } catch (_) {}
      const rc = document.createElement("div"); rc.className = "tree-preview-recall";
      rc.textContent = hist.length ? ("past answer: " + hist[0].a) : "no past answers yet";
      card.appendChild(rc);
    }

    if (node.type === "choice") {
      const opts = document.createElement("div"); opts.className = "tree-preview-choices";
      (node.options || []).forEach((opt, i) => {
        const b = document.createElement("button");
        b.className = "tree-preview-choice"; b.textContent = opt.label || ("option " + (i + 1));
        b.onclick = () => {
          _preview.history.push({ q: node.name, a: opt.label || "" });
          previewAdvance(previewComputeNext(node, i));
        };
        opts.appendChild(b);
      });
      card.appendChild(opts);
    } else {
      const input = document.createElement("textarea");
      input.className = "tree-preview-input"; input.placeholder = "type an answer…"; input.value = _preview.answer || "";
      input.oninput = () => { _preview.answer = input.value; };
      card.appendChild(input);
      const next = document.createElement("button");
      next.className = "btn-ghost"; next.textContent = "next";
      next.onclick = () => {
        _preview.history.push({ q: node.name, a: (_preview.answer || "").trim() });
        previewAdvance(previewComputeNext(node, null));
      };
      card.appendChild(next);
      setTimeout(() => input.focus(), 0);
    }
  }

  // first non-empty line of a snapshot, truncated — so the history list reads
  // as "what the tree actually said at that point" instead of a version number.
  function snapshotPreview(t) {
    const firstLine = (t || "").split("\n").map((s) => s.trim()).find((s) => s) || "";
    if (!firstLine) return "(empty)";
    return firstLine.length > 46 ? firstLine.slice(0, 46) + "…" : firstLine;
  }
  function renderHistoryRow() {
    const toggle = document.getElementById("historyToggleBtn");
    const dropdown = document.getElementById("historyDropdown");
    const wrap = document.getElementById("historySnapshots");
    const count = _snapshots.length;
    toggle.classList.toggle("on", _historyOpen);
    toggle.title = "version history — " + count + (count === 1 ? " version" : " versions");
    dropdown.classList.toggle("on", _historyOpen);
    wrap.innerHTML = "";
    if (!_historyOpen) return;
    // newest first — each row shows a truncation of the tree at that saved
    // point plus when it was taken; click to scrub back to it.
    for (let i = _snapshots.length - 1; i >= 0; i--) {
      const snap = _snapshots[i];
      const b = document.createElement("button");
      b.className = "history-snapshot" + (i === _snapIndex ? " on" : "");
      const when = new Date(snap.ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      const preview = snapshotPreview(snap.text);
      const pv = document.createElement("span"); pv.className = "history-snapshot-preview"; pv.textContent = preview;
      const tm = document.createElement("span"); tm.className = "history-snapshot-time"; tm.textContent = when;
      b.appendChild(pv); b.appendChild(tm);
      b.title = preview;
      b.onclick = () => scrubTo(i);
      wrap.appendChild(b);
    }
  }
})();
