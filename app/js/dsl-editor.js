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
  let _dragFromLine = null; // textarea native drag-reorder source line
  let _historyOpen = false;
  let _cardDrag = null; // { name, x, y } — dragging an existing card onto another to link it
  // 2D canvas pan offset — applied as a CSS transform on #canvasContent, on
  // TOP of its auto-centering margins. Previously panning worked by setting
  // .canvas-scroll's native scrollLeft/scrollTop, which only has any visible
  // effect when the tree's actual content is BIGGER than the viewport (i.e.
  // there's real scrollable overflow to move within) — for any small/
  // medium tree that already fits on screen, scrollWidth/scrollHeight are
  // ~equal to clientWidth/clientHeight, so dragging did nothing visible at
  // all. That was the "still can't 2D drag" bug. A transform-based offset
  // has no such ceiling — it can move any amount in any direction
  // regardless of content size.
  let _canvasPan = { x: 0, y: 0 };
  function applyCanvasPan() {
    const content = document.getElementById("canvasContent");
    if (content) content.style.transform = "translate(" + _canvasPan.x + "px, " + _canvasPan.y + "px)";
  }
  let _editingName = null; // block name currently being renamed inline on the canvas (only reachable via "+" creating a brand-new node now — see §3d/§3e)
  let _selectedCard = null; // block name whose metadata panel (kind + recall status) is showing, toggled by a plain click on the card
  // Renaming a declaration OR any reference always cascades to every other
  // occurrence of that title, so the two views never drift out of sync.

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
          '<div class="dsl-pane-label">your questions</div>' +
          '<div class="dsl-editor-wrap">' +
            '<div class="dsl-editor-scroll">' +
              '<div class="dsl-inner" id="dslInner">' +
                '<div class="dsl-highlight" id="dslHighlight" aria-hidden="true"></div>' +
                '<textarea id="dslTextarea" class="dsl-textarea" spellcheck="false" wrap="soft" placeholder="write your first question…"></textarea>' +
                '<div class="dsl-ref-controls" id="dslRefControls" aria-hidden="true"></div>' +
              "</div>" +
            "</div>" +
            // copy/delete-all toolbar removed entirely per later ask — the
            // only remaining control on the editor itself is history, below.
            //
            // history control: lives at the bottom, shifted in a bit from
            // the left edge, below the editor's bottom edge, invisible until
            // you hover that strip (see .dsl-history-zone in style.css).
            '<div class="dsl-history-zone" id="dslHistoryZone">' +
              '<button class="squircle-corner-btn dsl-history-btn" id="historyToggleBtn" title="version history">' +
                '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /><path d="M12 8v4l3 2" /></svg>' +
              '</button>' +
              '<div class="history-dropdown" id="historyDropdown">' +
                '<div class="history-snapshots" id="historySnapshots"></div>' +
              "</div>" +
            "</div>" +
          "</div>" +
        "</div>" +
        '<div class="canvas-pane" id="canvasPane">' +
          '<div class="canvas-viewport" id="canvasViewport">' +
            '<div class="canvas-scroll">' +
              '<div class="canvas-content" id="canvasContent"></div>' +
            "</div>" +
            // §3c: canvas dissolves near the screen's right edge only,
            // aligned to the DSL editor's own top/bottom box — every other
            // edge is a hard cutoff via .canvas-scroll's overflow:hidden,
            // no gradient needed there. See the .canvas-fade rules in
            // style.css for why this is a gradient overlay, not mask-image.
            // Fixed in the viewport (sibling of canvas-scroll, not
            // canvas-content), so it doesn't pan with the tree.
            '<div class="canvas-fade canvas-fade-right"></div>' +
          "</div>" +
          '<div class="dsl-warning" id="dslWarning"></div>' +
        "</div>" +
      "</div>";

    document.getElementById("paneBtnDsl").onclick = () => setPane("dsl");
    document.getElementById("paneBtnCanvas").onclick = () => setPane("canvas");
    document.getElementById("historyToggleBtn").onclick = toggleHistory;

    const el = ta();
    el.addEventListener("input", (e) => {
      const newText = e.target.value;
      const oldText = window.dslText || "";
      const cursor = e.target.selectionStart;
      // editing any reference or the declaration always cascades so every
      // occurrence of a title stays in sync (this used to be a toggle).
      const finalText = window._cascadeRenameIfHeaderEdited(oldText, newText, cursor);
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

    // grab-a-line dragging inside the DSL editor: press on a line, move
    // vertically past a small threshold, drop on the target line — no text
    // selection needed (moveLine handles declaration vs reference semantics).
    let _lineDrag = null;
    const yToLine = (clientY) => {
      const rect = el.getBoundingClientRect();
      const y = clientY - rect.top + el.scrollTop - 14; // padding-top
      const mm = el.clientWidth ? measureLineTops(el.value, el) : null;
      if (!mm) return Math.max(0, Math.floor(y / LINE_H));
      let idx = 0;
      for (let i = 0; i < mm.tops.length; i++) if (mm.tops[i] <= y) idx = i;
      return idx;
    };
    el.addEventListener("mousedown", (e) => {
      // Only arm line-drag when the press starts near the LEFT EDGE of a line
      // (declaration column or the 2ch body-indent column) — this is the same
      // zone the gutter "+" buttons live in. A mousedown anywhere else in the
      // line is normal text-selection/caret placement and must be left alone.
      // Previously this armed on every mousedown in the textarea, so any
      // vertical drag-select of multiple lines (a completely normal text
      // selection) got reinterpreted as "move this line" on mouseup —
      // silently discarding the selection and reordering DSL text. That was
      // the "canvas and selection is broken" bug.
      // Vertical dragging still works in BOTH senses: dragging near the left
      // edge still moves/reorders the line (this listener), and dragging
      // ANYWHERE else — including a vertical multi-line drag — still does
      // normal browser text selection, because outside this 32px zone we
      // never touch the event at all.
      const rect = el.getBoundingClientRect();
      const nearLineStart = (e.clientX - rect.left) <= 32; // padding(14px) + ~2ch indent
      if (!nearLineStart) { _lineDrag = null; return; }
      _lineDrag = { y0: e.clientY, from: yToLine(e.clientY), active: false };
    });
    window.addEventListener("mousemove", (e) => {
      if (!_lineDrag) return;
      if (!_lineDrag.active && Math.abs(e.clientY - _lineDrag.y0) > 9) {
        _lineDrag.active = true;
        el.classList.add("line-dragging");
      }
    });
    window.addEventListener("mouseup", (e) => {
      if (!_lineDrag) return;
      const d = _lineDrag; _lineDrag = null;
      el.classList.remove("line-dragging");
      if (!d.active) return; // plain click — caret behaves normally
      const to = yToLine(e.clientY);
      if (to === d.from) return;
      const caret = el.selectionStart;
      mutate(TM().moveLine(text(), d.from, to));
      try { el.setSelectionRange(caret, caret); } catch (_) {}
    });

    // clicking anywhere outside an open recall menu closes it (recall stays in
    // whatever on/off state it's in — the button, not the outside click, toggles).
    document.addEventListener("mousedown", (e) => {
      if (_recallOpenFor == null) return;
      if (e.target.closest && e.target.closest(".canvas-recall-popover, .canvas-recall-btn")) return;
      _recallOpenFor = null;
      window.renderDslEditor();
    });

    // drag anywhere on empty canvas to PAN it (left/right and up/down) — the
    // scroll container persists across re-renders so this is wired once here.
    // Transform-based (see _canvasPan/applyCanvasPan above), NOT native
    // scrollLeft/scrollTop — the old scroll-based approach only visibly
    // moved when the tree was bigger than the viewport.
    const scroll = document.querySelector(".canvas-scroll");
    if (scroll) {
      let pan = null;
      scroll.addEventListener("mousedown", (e) => {
        if (e.target.closest("[data-canvas-card], .canvas-ghost-slot, .canvas-recall-popover, button, textarea, input")) return;
        pan = { x: e.clientX, y: e.clientY, px: _canvasPan.x, py: _canvasPan.y };
        scroll.classList.add("grabbing");
        e.preventDefault();
      });
      window.addEventListener("mousemove", (e) => {
        if (!pan) return;
        // drag pans the canvas in BOTH dimensions, unbounded
        _canvasPan.x = pan.px + (e.clientX - pan.x);
        _canvasPan.y = pan.py + (e.clientY - pan.y);
        applyCanvasPan();
      });
      window.addEventListener("mouseup", () => { if (pan) { pan = null; scroll.classList.remove("grabbing"); } });

      // The ONLY way to move the canvas is 2D drag — .canvas-scroll is
      // `overflow: hidden` now (was `auto`), so native
      // wheel/trackpad/scrollbar/touch scrolling is structurally impossible,
      // not just prevented. These listeners are a defensive backstop in
      // case any browser still tries to scroll a hidden-overflow box (rare,
      // but cheap to guard against).
      scroll.addEventListener("wheel", (e) => { e.preventDefault(); }, { passive: false });
      scroll.addEventListener("touchmove", (e) => { if (pan) e.preventDefault(); }, { passive: false });
    }
  };

  function setPane(p) {
    _pane = p;
    window.renderDslEditor();
  }

  // ── history (version snapshots) — kept here since it's part of the
  // editor's own UI; app.js just persists whatever setDslText hands it. ──
  // history is stored as PER-TREE DIFFS, persisted permanently (localStorage):
  // {base, patches:[{t, p, s, x}]} — p/s = common prefix/suffix lengths, x = the
  // replaced middle. Snapshot texts are rebuilt by replaying patches from base.
  const HIST_KEY = "rc_tree_history";
  function computePatch(a, b) {
    let i = 0; const n = Math.min(a.length, b.length);
    while (i < n && a[i] === b[i]) i++;
    let j = 0;
    while (j < n - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
    return { p: i, s: j, x: b.slice(i, b.length - j) };
  }
  function applyPatch(a, pt) { return a.slice(0, pt.p) + pt.x + a.slice(a.length - pt.s); }
  function loadPersistedSnapshots() {
    try {
      const h = JSON.parse(localStorage.getItem(HIST_KEY) || "null");
      if (!h || !Array.isArray(h.patches)) return [{ ts: 0, text: "" }];
      const out = [{ ts: h.baseTs || 0, text: h.base || "" }];
      let cur = h.base || "";
      h.patches.forEach((pt) => { cur = applyPatch(cur, pt); out.push({ ts: pt.t, text: cur }); });
      return out;
    } catch (_) { return [{ ts: 0, text: "" }]; }
  }
  function persistSnapshot(prevText, newText, ts) {
    try {
      let h = JSON.parse(localStorage.getItem(HIST_KEY) || "null");
      if (!h || !Array.isArray(h.patches)) h = { base: prevText, baseTs: 0, patches: [] };
      h.patches.push({ t: ts, ...computePatch(prevText, newText) });
      // cap: fold the oldest patches into the base so the store stays bounded
      while (h.patches.length > 400) { h.base = applyPatch(h.base, h.patches[0]); h.baseTs = h.patches[0].t; h.patches.shift(); }
      localStorage.setItem(HIST_KEY, JSON.stringify(h));
    } catch (_) {}
  }
  let _snapshots = loadPersistedSnapshots();
  let _snapIndex = _snapshots.length - 1;
  let _charAccum = 0;
  let _nextThreshold = pickThreshold();
  function pickThreshold() { return 60; } // steady boundary — no randomness
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
      const prev = _snapshots[_snapshots.length - 1] ? _snapshots[_snapshots.length - 1].text : "";
      const ts = Date.now();
      _snapshots = _snapshots.concat([{ ts, text: newText }]);
      _snapIndex = _snapshots.length - 1;
      _charAccum = 0;
      _nextThreshold = pickThreshold();
      persistSnapshot(prev, newText, ts); // permanent, as a diff
    }
  };
  function toggleHistory() {
    _historyOpen = !_historyOpen;
    window.renderDslEditor();
  }

  // copyDslText/fallbackCopy/deleteAllText removed along with the
  // copy/delete-all toolbar buttons — deletion still works from the DSL
  // text itself (select + delete), version history still holds prior
  // snapshots to scrub back to.
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
    // disconnected second-heads are NOT flagged with a "hidden" message anymore —
    // instead their text is shown a little greyed in the DSL editor until wired
    // in (see renderDslPane). Only a genuine authoring error (a duplicate title)
    // still warrants a warning here.
    if (!dupInfo.length) { el.style.display = "none"; return; }
    el.textContent = dupInfo.map((d) => '"' + d.name + '"').join(", ") + " defined more than once";
    el.style.display = "block";
  }

  function renderPaneSwitch() {
    const wrap = document.getElementById("dslPaneSwitch");
    const isMobile = mobile();
    // mobile is READ-ONLY: no pane switcher, no DSL editor — just the tree,
    // rendered vertically. You edit on desktop.
    wrap.style.display = "none";
    const split = document.getElementById("dslSplit");
    split.classList.toggle("mobile", isMobile);
    document.getElementById("dslPane").style.display = isMobile ? "none" : "flex";
    document.getElementById("canvasPane").style.display = "flex";
  }

  // measure the pixel top of each logical line as the textarea ACTUALLY renders
  // it (now that wrap is on, one logical line can occupy several visual rows, so
  // rawLine*LINE_H no longer locates it). A hidden mirror matched to the
  // textarea's content box wraps identically, so its per-line offsets are exact.
  function measureLineTops(t, el) {
    const cs = getComputedStyle(el);
    const mirror = document.createElement("div");
    const st = mirror.style;
    st.position = "absolute"; st.visibility = "hidden"; st.left = "-9999px"; st.top = "0";
    st.boxSizing = "border-box"; st.width = el.clientWidth + "px";
    st.fontFamily = cs.fontFamily; st.fontSize = cs.fontSize; st.lineHeight = cs.lineHeight;
    st.letterSpacing = cs.letterSpacing; st.padding = cs.padding;
    st.whiteSpace = "pre-wrap"; st.wordBreak = "break-word"; st.overflowWrap = "break-word";
    const rows = t.split("\n").map((ln) => {
      const d = document.createElement("div");
      d.textContent = ln.length ? ln : "​"; // keep empty lines a full row tall
      mirror.appendChild(d);
      return d;
    });
    document.body.appendChild(mirror);
    const tops = rows.map((d) => d.offsetTop);
    const bottoms = rows.map((d) => d.offsetTop + d.offsetHeight);
    const total = mirror.scrollHeight;
    document.body.removeChild(mirror);
    return { tops, bottoms, total };
  }

  function renderDslPane(t) {
    const el = ta();
    if (el.value !== t) el.value = t; // only touches value on external changes — never fights the cursor while typing
    const inner = document.getElementById("dslInner");
    // measure real wrapped-line positions; fall back to LINE_H math if the pane
    // isn't laid out yet (clientWidth 0, e.g. hidden mobile pane).
    const m = el.clientWidth ? measureLineTops(t, el) : null;
    const lineCount = (t.match(/\n/g) || []).length + 1;
    // size to content (the editor grows DOWNWARD from the top now, so it never
    // takes more room than the text needs); a small floor keeps an empty editor
    // tappable.
    inner.style.height = Math.max(LINE_H + 16, m ? m.total : (lineCount + 1) * LINE_H) + "px";

    const parsed = TM().parse(t);

    // §3e: one highlight band per block, spanning its declaration line AND
    // every reference/recall line under it as a SINGLE encapsulating shape —
    // a node and everything that points back to it read as one thing, not
    // two different shades. Painted BEHIND the (transparent-background)
    // textarea via #dslHighlight, pointer-events:none throughout, so the
    // real text stays fully editable/selectable on top and nothing here
    // ever intercepts a click. True per-line font-size/truncation for
    // references isn't achievable in a plain <textarea> (it only ever
    // renders one uniform font for its whole value) — this single-band
    // grouping is the closest encapsulation available without moving to a
    // contenteditable-based editor, which would be a bigger, separately-
    // decided rewrite.
    const hl = document.getElementById("dslHighlight");
    if (hl) {
      hl.innerHTML = "";
      if (m) {
        parsed.blocks.forEach((b) => {
          if (b.rawLine >= m.tops.length) return;
          const lastLine = Math.min(b.bodyEndRawLine - 1, m.tops.length - 1);
          if (lastLine < b.rawLine) return;
          const band = document.createElement("div");
          band.className = "dsl-hl-band";
          band.style.top = m.tops[b.rawLine] + "px";
          band.style.height = (m.bottoms[lastLine] - m.tops[b.rawLine]) + "px";
          hl.appendChild(band);
        });
      }
    }

    // hover-× to detach a single reference line, without touching the
    // target block or any other reference to it. Lives ABOVE the textarea
    // (unlike the highlight bands behind it) so it's actually clickable —
    // pointer-events:none on the container keeps every other pixel
    // click-through to the textarea beneath; only the small per-row hover
    // zone near the right edge (not the whole row — that would block
    // clicking into the reference text itself) opts back in.
    const refCtl = document.getElementById("dslRefControls");
    if (refCtl) {
      refCtl.innerHTML = "";
      if (m) {
        parsed.blocks.forEach((b) => {
          for (let r = b.rawLine + 1; r < b.bodyEndRawLine && r < m.tops.length; r++) {
            const info = TM().sourceInfoAt(t, r);
            if (!info || info.kind === "header") continue;
            const zone = document.createElement("div");
            zone.className = "dsl-ref-x-zone";
            zone.style.top = m.tops[r] + "px";
            zone.style.height = (m.bottoms[r] - m.tops[r]) + "px";
            const x = document.createElement("button");
            x.className = "dsl-ref-x";
            x.title = "remove this reference";
            x.textContent = "✕";
            x.onclick = ((rawLine) => (e) => {
              e.stopPropagation();
              mutate(TM().detachReference(text(), rawLine));
            })(r);
            zone.appendChild(x);
            refCtl.appendChild(zone);
          }
        });
      }
    }

    // gutter "+" — one per empty leaf line (a text question with nowhere to
    // go yet), sitting on the line right below the question where the next
    // reference would be typed.
    inner.querySelectorAll(".dsl-gutter-btn").forEach((n) => n.remove());
    parsed.blocks.forEach((b) => {
      const empty = b.type === "text" && !b.next && !b.terminal;
      if (!empty) return;
      const btn = document.createElement("button");
      btn.className = "dsl-gutter-btn";
      btn.title = "add what happens next";
      btn.textContent = "+";
      // sit AFTER the whole body (a recall line is body, not a destination) —
      // pinning to rawLine+1 put the "+" on top of the recall line and made
      // finished-looking questions appear to sprout stray plus buttons.
      const rowIdx = b.bodyEndRawLine;
      const belowTop = m
        ? (rowIdx < m.tops.length ? m.tops[rowIdx] : m.bottoms[m.bottoms.length - 1])
        : rowIdx * LINE_H + 9;
      btn.style.top = belowTop + "px";
      btn.onclick = () => {
        const uniq = TM().uniqueName(parsed, "new question");
        const res = TM().addConnectedChild(text(), b.name, uniq);
        mutate(res.text, res);
      };
      inner.appendChild(btn);
    });

    // the ONE other visible "+": at the very bottom of the whole document,
    // to start a new disconnected/next top-level thought. Clicking it
    // inserts relative to the CURRENT CURSOR position, not always the
    // physical end of a (possibly long) document — see
    // insertNewBlockAfter's comment in tree-model.js.
    const endBtn = document.createElement("button");
    endBtn.className = "dsl-gutter-btn dsl-gutter-btn-end";
    endBtn.title = "start a new question";
    endBtn.textContent = "+";
    endBtn.style.top = (m ? m.total : lineCount * LINE_H) + "px";
    endBtn.onclick = () => {
      const caret = el.selectionStart != null ? el.selectionStart : text().length;
      const before = text().slice(0, caret);
      const atRawLine = (before.match(/\n/g) || []).length;
      const uniq = TM().uniqueName(parsed, "new question");
      const res = TM().insertNewBlockAfter(text(), atRawLine, uniq);
      mutate(res.text, res);
    };
    inner.appendChild(endBtn);
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

    let blocks = parsed.blocks;
    let terminals = graph.terminals;
    if (graph.roots && graph.roots.length > 1) {
      const visible = reachableFrom(graph.roots[0].name, graph.edges);
      blocks = blocks.filter((b) => visible.has(b.name));
      terminals = terminals.filter((tm) => visible.has(tm.from));
    }

    // recall options are only the questions actually IN this tree — disconnected
    // second-heads (hidden from the canvas) must not show up as recall targets.
    const recallOptions = blocks.map((b) => ({ id: b.name, text: b.name || "(untitled)" }));

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
    // where a "+" from this block would add its NEXT child. If the block already
    // has children (a next, choice options, or a done terminal), the ghost slot
    // must sit BELOW the lowest of them so it never overlaps an existing branch;
    // an empty leaf's first child goes straight across at the same row.
    const ghostColRow = new Map();
    blocks.forEach((b) => {
      const col = (graph.col.get(b.name) || 0) + 1;
      const myRow = graph.row.get(b.name) || 0;
      const childRows = [];
      (graph.edges || []).forEach((e) => { if (e.from === b.name) { const r = graph.row.get(e.to); if (r != null) childRows.push(r); } });
      terminals.forEach((tm) => { if (tm.from === b.name && tm.row != null) childRows.push(tm.row); });
      const row = childRows.length ? Math.max(myRow, ...childRows) + 0.9 : myRow;
      ghostColRow.set(b.name, { col, row });
    });

    const allRows = blocks.map((b) => graph.row.get(b.name) || 0).concat(terminals.map((tm) => tm.row || 0)).concat([...ghostColRow.values()].map((g) => g.row));
    const allCols = blocks.map((b) => graph.col.get(b.name) || 0).concat(terminals.map((tm) => tm.col || 0)).concat([...ghostColRow.values()].map((g) => g.col));
    const maxCol = allCols.length ? Math.max(...allCols) : 0;
    const minRow = allRows.length ? Math.min(...allRows) : 0;
    const maxRow = allRows.length ? Math.max(...allRows) : 0;
    // mobile renders the tree VERTICALLY (depth flows downward, branches fan
    // sideways); desktop keeps the horizontal left→right layout.
    const V = mobile();
    const V_COLW = CARD_W + 14, V_ROWH = CARD_H + 36;
    const totalW = V
      ? Math.max(320, PAD * 2 + (maxRow - minRow + 1) * V_COLW)
      : Math.max(360, PAD * 2 + (maxCol + 1) * COL_W);
    const totalH = V
      ? Math.max(240, PAD * 2 + (maxCol + 1) * V_ROWH)
      : Math.max(240, PAD * 2 + (maxRow - minRow + 1) * ROW_H);

    const xyByName = new Map();
    blocks.forEach((b) => {
      const col = graph.col.get(b.name) || 0;
      const row = (graph.row.get(b.name) || 0) - minRow;
      const cx = V ? PAD + row * V_COLW + CARD_W / 2 : PAD + col * COL_W + CARD_W / 2;
      const cy = V ? PAD + col * V_ROWH + CARD_H / 2 : PAD + row * ROW_H + CARD_H / 2;
      xyByName.set(b.name, { x: cx - CARD_W / 2, y: cy - CARD_H / 2, cx, cy });
    });
    // a node is a LEAF (unfinished path) if nothing leads out of it — no next,
    // no choice options, no "done". Those are the highest-leverage places to
    // extend, so only they show a persistent "+"; interior nodes reveal theirs
    // on hover.
    const hasChild = new Set();
    const childrenOf = new Map();
    graph.edges.forEach((e) => { hasChild.add(e.from); if (!childrenOf.has(e.from)) childrenOf.set(e.from, []); childrenOf.get(e.from).push(e.to); });
    terminals.forEach((tm) => hasChild.add(tm.from));
    const nodes = blocks.map((b) => {
      const p = xyByName.get(b.name) || { x: 0, y: 0 };
      const g = ghostColRow.get(b.name);
      const ghost = g ? { x: PAD + g.col * COL_W, y: PAD + (g.row - minRow) * ROW_H } : null;
      return {
        id: b.name, name: b.name, text: b.name || "(untitled)", star: !!b.star, isChoice: b.type === "choice",
        isTerminal: false, isDuplicate: dupNames.has(t.norm(b.name)), recallTarget: b.recallTarget, isLeaf: !hasChild.has(b.name),
        children: childrenOf.get(b.name) || [],
        x: p.x, y: p.y, w: CARD_W, h: CARD_H, ghost: V ? null : ghost, // read-only mobile: no hypotheticals
      };
    });
    terminals.forEach((term) => {
      const col = term.col || 0, row = (term.row || 0) - minRow;
      const cx = V ? PAD + row * V_COLW + CARD_W / 2 : PAD + col * COL_W + CARD_W / 2;
      const cy = V ? PAD + col * V_ROWH + CARD_H / 2 : PAD + row * ROW_H + CARD_H / 2;
      xyByName.set(term.id, { x: cx - CARD_W / 2, y: cy - CARD_H / 2, cx, cy });
      nodes.push({ id: term.id, name: null, text: "done", star: false, isChoice: false, isTerminal: true, isDuplicate: false, recallTarget: null, x: cx - CARD_W / 2, y: cy - CARD_H / 2, w: CARD_W, h: CARD_H });
    });

    function edgePath(a, b) {
      if (V) {
        const y1 = a.y + CARD_H, y2 = b.y;
        const midY = y1 + (y2 - y1) / 2;
        return "M " + a.cx + " " + y1 + " C " + a.cx + " " + midY + ", " + b.cx + " " + midY + ", " + b.cx + " " + y2;
      }
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
    const recallEdges = graph.recallEdges
      .filter((e) => t.norm(e.from) !== t.norm(e.to)) // a question recalling its OWN answers draws no edge
      .map((e) => {
        const a = xyByName.get(e.from), b = xyByName.get(e.to);
        return a && b ? { d: edgePath(a, b) } : null;
      }).filter(Boolean);
    const ghostEdges = nodes.filter((n) => n.ghost).map((n) => {
      const a = xyByName.get(n.name);
      const b = { x: n.ghost.x, cy: n.ghost.y + CARD_H / 2 };
      return a ? { d: edgePath(a, b), name: n.name, isLeaf: n.isLeaf } : null;
    }).filter(Boolean);

    return { nodes, edges, recallEdges, ghostEdges, w: totalW, h: totalH, recallOptions };
  }

  function renderCanvasPane(parsed, graph, dupInfo) {
    const canvas = buildCanvas(parsed, graph);
    const content = document.getElementById("canvasContent");
    content.style.width = canvas.w + "px";
    content.style.height = canvas.h + "px";
    // center the tree in the viewport when it fits, but leave margins at 0 when
    // it's bigger so BOTH axes stay fully scrollable (CSS flex/grid centering was
    // clipping the scrollable area — this JS approach never does).
    const scrollEl = document.querySelector(".canvas-scroll");
    if (scrollEl) {
      const vw = scrollEl.clientWidth, vh = scrollEl.clientHeight;
      const editorW = mobile() ? 0 : vw * 0.45; // the DSL editor covers the left 45% on desktop
      // vertically: tree center sits ~62% up from the bottom (38% from the top) —
      // one tunable number.
      const TREE_CENTER_FROM_TOP = 0.38;
      content.style.marginTop = Math.max(0, vh * TREE_CENTER_FROM_TOP - canvas.h / 2) + "px";
      // horizontally: place it in the space to the RIGHT of the editor so the
      // leftmost node clears it; you can still drag/scroll it left under the editor.
      content.style.marginLeft = (editorW + Math.max(0, ((vw - editorW) - canvas.w) / 2)) + "px";
    }
    // reapply the persisted pan offset on top of the margins above — the
    // margins set the DEFAULT (0,0-pan) position, the transform is
    // whatever the user has dragged to since. innerHTML below only clears
    // children, not this element's own inline transform, but setting it
    // explicitly here keeps pan correct even if something else ever resets
    // canvasContent's style.
    applyCanvasPan();
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
      // interior (non-leaf) ghost paths are hidden alongside their "+", so the
      // canvas isn't full of dashed lines pointing at nothing; both appear on
      // hover of the source card.
      p.setAttribute("class", "ghost-edge" + (e.isLeaf ? "" : " interior")); if (e.name != null) p.dataset.ghostFor = e.name;
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
  }

  function buildCardEl(n, recallOptions) {
    const isTerm = n.isTerminal;
    const card = document.createElement("div");
    card.className = "canvas-card" + (isTerm ? " terminal" : "") + (n.isDuplicate ? " duplicate" : "") + (n.isChoice ? " choice" : "") + (_selectedCard === n.name && !isTerm ? " selected" : "");
    card.style.left = n.x + "px"; card.style.top = n.y + "px"; card.style.width = n.w + "px"; card.style.height = n.h + "px";
    card.dataset.canvasCard = n.name || "";

    // §3d: the canvas is view-only now — no more click-a-card's-text-to-
    // rename. All real authoring happens in the DSL editor. Clicking a card
    // (below) toggles a metadata readout above it instead (kind + recall
    // status). The _editingName inline-textarea branch right below is KEPT
    // — it's still how a brand-new node (created via "+") gets its first
    // name typed in, which is a separate, still-valid flow (see §3e for
    // where "+" moves next; not touched by this pass).
    const label = document.createElement("div");
    label.className = "canvas-card-text";
    if (_editingName === n.name && !isTerm) {
      label.classList.add("editing"); // un-clamps the label so the input gets the whole card, not one line
      const input = document.createElement("textarea");
      input.className = "canvas-card-text-input"; input.value = n.name; input.rows = 1;
      label.appendChild(input);
      // focus and drop the caret at the END (not select-all — selecting the
      // whole thing on every click was the jarring bit).
      setTimeout(() => { input.focus(); const L = input.value.length; input.setSelectionRange(L, L); }, 0);
      let done = false;
      let curName = n.name;                 // the block's title as it evolves
      const originalText = text();          // to restore on cancel
      // LIVE: every keystroke renames the block (and all its references) and
      // pushes the new text straight into the DSL editor, WITHOUT rebuilding the
      // canvas (which would kill this input). The full re-render happens on
      // commit. This is what makes node edits show up in the DSL immediately.
      input.addEventListener("input", () => {
        const val = input.value.trim();
        if (!val || val === curName) return;
        const newText = TM().renameBlockTitle(text(), curName, val);
        window.dslText = newText;
        const dta = ta();
        if (dta && dta.value !== newText) dta.value = newText;
        curName = val;
      });
      const commit = () => {
        if (done) return; done = true;
        _editingName = null;
        if (text() !== originalText) mutate(text()); // persist + full re-render
        else window.renderDslEditor();
      };
      const cancel = () => {
        if (done) return; done = true; _editingName = null;
        window.dslText = originalText;
        const dta = ta(); if (dta) dta.value = originalText;
        window.renderDslEditor();
      };
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

    if (n.isDuplicate) {
      const tag = document.createElement("div");
      tag.className = "canvas-card-tag dup"; tag.textContent = "duplicate title";
      card.appendChild(tag);
    }

    // §3d node metadata — ALWAYS visible now (was gated behind clicking the
    // card to "select" it). Two independent floating labels rather than one
    // panel: the kind reads above the card at all times; the memory/recall
    // status sits beside its own toggle button below, since that's the
    // thing it's actually describing. Both read-only — the recall STATE is
    // changed via the dedicated bottom-left button, not from here.
    if (!isTerm && !mobile()) {
      const kind = document.createElement("div");
      kind.className = "canvas-card-kind";
      kind.textContent = n.isChoice ? "multiple choice" : "text response";
      card.appendChild(kind);
    }

    if (!isTerm && !mobile()) { // mobile is read-only: no recall/drag/hover affordances, no delete at all (deletion happens in the DSL editor now)
      const recall = document.createElement("button");
      // bottom-LEFT now (was middle-right) — still its own independently
      // clickable toggle, separate from the whole-card click that shows/
      // hides the metadata panel above.
      recall.className = "canvas-recall-btn" + (n.recallTarget ? " on" : "");
      recall.title = "recall past answers (from this question, or another)";
      recall.innerHTML = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></svg>';
      // The recall button is an on/off toggle. OFF → turn ON (purple), defaulting
      // to this question's own past answers, and open the menu to pick another.
      // ON → turn OFF (not purple) and close. Clicking OUTSIDE just closes the
      // menu, leaving recall on (see the document handler in initDslEditor).
      recall.onclick = (e) => {
        e.stopPropagation();
        if (n.recallTarget) {
          _recallOpenFor = null;
          mutate(TM().setRecall(text(), n.name, null));
        } else {
          _recallOpenFor = n.name;
          mutate(TM().setRecall(text(), n.name, n.name)); // default: recall own answers
        }
      };
      card.appendChild(recall);

      // memory status — ALWAYS visible now (was hidden inside the metadata
      // panel that only showed on click), sitting directly beside its own
      // button rather than floating disconnected above the card.
      const recallStatus = document.createElement("div");
      recallStatus.className = "canvas-card-recall-status" + (n.recallTarget ? " on" : "");
      recallStatus.textContent = n.recallTarget ? "memory enabled" : "memory disabled";
      card.appendChild(recallStatus);

      // the "+" itself lives at the ghost slot (see buildGhostSlotEl), drawn
      // at the actual spot the next question would land, not pinned to the
      // card corner — the card body itself is the drag handle for linking
      // this question in elsewhere, AND (on a plain click with no drag
      // movement) toggles a selection border — see the `!moved` branch in
      // startCardDrag's mouseup handler.
      card.addEventListener("mousedown", (e) => {
        if (e.target.closest(".canvas-card-text, .canvas-recall-btn, .canvas-recall-popover, textarea, input")) return;
        startCardDrag(e, n.name);
      });

      // hovering a card reveals its (otherwise hidden) interior "+" AND the path
      // to it. A short hide-delay bridges the gap between card and slot so you
      // can actually move onto the "+" and click it (its own :hover then keeps
      // it up). Revealing a parent's BRANCH slot also suppresses its children's
      // continuation slots, so two hypotheticals never stack on the same spot.
      const esc = (window.CSS && CSS.escape ? CSS.escape(n.name) : n.name);
      const slotFor = (nm) => document.querySelector('.canvas-ghost-slot[data-ghost-slot-for="' + (window.CSS && CSS.escape ? CSS.escape(nm) : nm) + '"]');
      const ghostEdgeEl = () => {
        const svg = document.querySelector(".canvas-content svg");
        return svg ? Array.from(svg.querySelectorAll("path.ghost-edge")).find((p) => p.dataset.ghostFor === n.name) : null;
      };
      let hideTimer = null;
      let suppressed = [];
      const reveal = () => {
        clearTimeout(hideTimer);
        const s = slotFor(n.name); if (s) s.classList.add("reveal");
        const e2 = ghostEdgeEl(); if (e2) e2.classList.add("reveal");
        // the hovered node's hypothetical has PRIORITY: suppress every OTHER
        // slot (and its path) that geometrically overlaps this one, whether it
        // belongs to a child, sibling, or anything else.
        if (n.ghost) {
          const svg = document.querySelector(".canvas-content svg");
          document.querySelectorAll(".canvas-ghost-slot").forEach((os) => {
            const nm = os.dataset.ghostSlotFor;
            if (!nm || nm === n.name) return;
            const ox = parseFloat(os.style.left), oy = parseFloat(os.style.top);
            if (Math.abs(ox - n.ghost.x) < CARD_W && Math.abs(oy - n.ghost.y) < CARD_H) {
              os.classList.add("suppressed");
              const oe = svg && Array.from(svg.querySelectorAll("path.ghost-edge")).find((p) => p.dataset.ghostFor === nm);
              if (oe) oe.classList.add("suppressed");
              suppressed.push(nm);
            }
          });
        }
      };
      const hideSoon = () => {
        hideTimer = setTimeout(() => {
          const s = slotFor(n.name); if (s) s.classList.remove("reveal");
          const e2 = ghostEdgeEl(); if (e2) e2.classList.remove("reveal");
          const svg = document.querySelector(".canvas-content svg");
          suppressed.forEach((nm) => {
            const os = slotFor(nm); if (os) os.classList.remove("suppressed");
            const oe = svg && Array.from(svg.querySelectorAll("path.ghost-edge")).find((p) => p.dataset.ghostFor === nm);
            if (oe) oe.classList.remove("suppressed");
          });
          suppressed = [];
        }, 900); // generous — enough time to travel from the card to the "+"
      };
      card.addEventListener("mouseenter", reveal);
      card.addEventListener("mouseleave", hideSoon);
      // keep it up while the pointer is on the "+" itself
      const mySlot = slotFor(n.name);
      if (mySlot) { mySlot.addEventListener("mouseenter", () => clearTimeout(hideTimer)); mySlot.addEventListener("mouseleave", hideSoon); }
    }

    if (_recallOpenFor === n.name) {
      const pop = document.createElement("div");
      pop.className = "canvas-recall-popover";
      // header — .canvas-recall-popover-hdr already existed in style.css but
      // nothing ever created the element, so this menu was rendering as a
      // bare option list with no label at all. Filling that gap in.
      const hdr = document.createElement("div");
      hdr.className = "canvas-recall-popover-hdr";
      hdr.textContent = "recall answers from:";
      pop.appendChild(hdr);
      // single-select menu, checkmark on the current target. Picking an option
      // just changes which question's answers are recalled and keeps the menu
      // open (close by clicking off, or toggle the whole thing off via the
      // recall button). Default target is this question itself.
      const selected = n.recallTarget ? TM().norm(n.recallTarget) : TM().norm(n.name);
      recallOptions.forEach((opt) => {
        const b = document.createElement("button");
        const isSel = TM().norm(opt.id) === selected;
        b.className = "canvas-recall-opt" + (isSel ? " sel" : "");
        const lbl = document.createElement("span"); lbl.className = "canvas-recall-opt-label"; lbl.textContent = opt.text;
        const chk = document.createElement("span"); chk.className = "canvas-recall-opt-check"; chk.textContent = isSel ? "✓" : "";
        b.appendChild(lbl); b.appendChild(chk);
        b.onclick = (e) => {
          e.stopPropagation();
          mutate(TM().setRecall(text(), n.name, opt.id));
        };
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
      // click, or drag to empty space: create a generic connected question
      // immediately and drop straight into an inline editor on it — no
      // separate "type a name" popover step.
      const uniq = TM().uniqueName(TM().parse(text()), "new question");
      const res = TM().addConnectedChild(text(), fromName, uniq);
      _editingName = uniq;
      mutate(res.text, res);
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
      // a plain click (no drag movement) toggles the metadata panel — §3d:
      // clicking a node shows/hides its kind + recall status above it.
      if (!moved) { _selectedCard = _selectedCard === name ? null : name; window.renderDslEditor(); return; }
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
  // corner. Both a click and a drag-to-empty-space create the new question
  // immediately and drop straight into an inline rename on the card itself
  // (_editingName, see startPlusDrag's onUp) — no separate "type a name"
  // popover step anymore (that was `_naming`, removed as dead code: nothing
  // ever set it to a truthy value). Dragging the "+" onto an existing card
  // links that question in instead (connectExisting).
  function buildGhostSlotEl(n) {
    const el = document.createElement("div");
    // only LEAF nodes show a persistent "+"; interior nodes' slots stay hidden
    // until you hover the source card (see buildCardEl), keeping the canvas from
    // filling up with low-leverage hypotheticals.
    el.className = "canvas-ghost-slot" + (n.isLeaf ? "" : " interior");
    if (n.name != null) el.dataset.ghostSlotFor = n.name;
    el.style.left = n.ghost.x + "px"; el.style.top = n.ghost.y + "px"; el.style.width = CARD_W + "px"; el.style.height = CARD_H + "px";
    const plus = document.createElement("button");
    plus.className = "canvas-ghost-plus";
    plus.title = "click or drag out to add a connected question, or drag onto another card to link it";
    plus.textContent = "+";
    plus.addEventListener("mousedown", (e) => startPlusDrag(e, n.name));
    // hovering the "+" makes the dashed path to this hypothetical node turn
    // solid and a little bolder, so you can see exactly where it would attach.
    const ghostPath = () => {
      const svg = document.querySelector(".canvas-content svg");
      if (!svg) return null;
      return Array.from(svg.querySelectorAll("path.ghost-edge")).find((p) => p.dataset.ghostFor === n.name) || null;
    };
    plus.addEventListener("mouseenter", () => {
      const p = ghostPath();
      if (p) { p.setAttribute("stroke", "var(--ink-dim)"); p.setAttribute("stroke-width", "2.2"); p.removeAttribute("stroke-dasharray"); }
    });
    plus.addEventListener("mouseleave", () => {
      const p = ghostPath();
      if (p) { p.setAttribute("stroke", "var(--line)"); p.setAttribute("stroke-width", "1.2"); p.setAttribute("stroke-dasharray", "1 5"); }
    });
    el.appendChild(plus);
    return el;
  }

  // ── preview: walk the tree exactly as tonight's reflection would, right
  // from the editor — nothing here touches the real draft, commitments, or
  // Firestore; it's a throwaway local walk so "does my tree actually work"
  // has an instant answer instead of waiting for tonight's notification. ──

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
