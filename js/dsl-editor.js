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
  let _naming = null; // { fromName, x, y }
  let _dragFromLine = null; // textarea native drag-reorder source line
  let _historyOpen = false;

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
    host.innerHTML =
      '<div class="dsl-warning" id="dslWarning"></div>' +
      '<div class="dsl-pane-switch" id="dslPaneSwitch">' +
        '<button class="dsl-pane-btn" id="paneBtnDsl">dsl editor</button>' +
        '<button class="dsl-pane-btn" id="paneBtnCanvas">node canvas</button>' +
      "</div>" +
      '<div class="dsl-split" id="dslSplit">' +
        '<div class="dsl-pane" id="dslPane">' +
          '<div class="pane-label">dsl editor</div>' +
          '<div class="dsl-editor-wrap">' +
            '<div class="dsl-inner" id="dslInner">' +
              '<textarea id="dslTextarea" class="dsl-textarea" spellcheck="false" placeholder="write your first question…"></textarea>' +
            "</div>" +
          "</div>" +
        "</div>" +
        '<div class="canvas-pane" id="canvasPane">' +
          '<div class="pane-label">node canvas</div>' +
          '<div class="canvas-viewport" id="canvasViewport">' +
            '<div class="canvas-content" id="canvasContent"></div>' +
          "</div>" +
        "</div>" +
      "</div>" +
      '<div class="tree-history-row" id="treeHistoryRow">' +
        '<button class="btn-quiet" id="historyToggleBtn">history ▸</button>' +
        '<input type="range" class="history-slider" id="treeHistorySlider" min="0" max="0" value="0" style="display:none" />' +
        '<span class="history-label" id="treeHistoryLabel"></span>' +
      "</div>";

    document.getElementById("paneBtnDsl").onclick = () => setPane("dsl");
    document.getElementById("paneBtnCanvas").onclick = () => setPane("canvas");
    document.getElementById("historyToggleBtn").onclick = toggleHistory;
    document.getElementById("treeHistorySlider").oninput = (e) => scrubTo(Number(e.target.value));

    const el = ta();
    el.addEventListener("input", (e) => {
      const newText = e.target.value;
      const oldText = window.dslText || "";
      const cursor = e.target.selectionStart;
      const finalText = window._cascadeRenameIfHeaderEdited(oldText, newText, cursor);
      window.setDslText(finalText);
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
  function pickThreshold() { return 150 + Math.floor(Math.random() * 151); }
  function diffSize(a, b) {
    let i = 0; const n = Math.min(a.length, b.length);
    while (i < n && a[i] === b[i]) i++;
    let j = 0;
    while (j < n - i && a[a.length - 1 - j] === b[b.length - 1 - j]) j++;
    return Math.max(0, a.length - i - j) + Math.max(0, b.length - i - j);
  }
  window._noteDslSnapshot = function (oldText, newText) {
    const delta = diffSize(oldText, newText);
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
  function scrubTo(i) {
    const snap = _snapshots[i];
    if (!snap) return;
    _charAccum += diffSize(text(), snap.text);
    _snapIndex = i;
    window.setDslText(snap.text);
  }

  // ── mutate helper: every canvas/gutter action funnels through here so
  // selection restoration + snapshotting stay in one place. ──────────────
  function mutate(newText, selRange) {
    window.setDslText(newText, selRange);
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

  // ── renaming a top-level question's own title cascades to every
  // reference to it elsewhere in the doc, so editing a title never
  // silently orphans an existing connection. ─────────────────────────────
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
    if (indentOf(oldLineRaw) !== 0 || indentOf(newLineRaw) !== 0) return newText;
    const stripStar = (s) => s.trim().replace(/^\*\s+/, "");
    const oldName = stripStar(oldLineRaw), newName = stripStar(newLineRaw);
    if (!oldName || !newName || oldName === newName) return newText;
    return t.renameReferences(newText, oldName, newName, lineIdx);
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
    if (!dupInfo.length && !multiRoots.length) { el.style.display = "none"; return; }
    const parts = [];
    if (dupInfo.length) parts.push(dupInfo.map((d) => '"' + d.name + '"').join(", ") + " defined more than once");
    if (multiRoots.length) parts.push('multiple starting points (' + multiRoots.map((n) => '"' + n + '"').join(", ") + ") — connect them into one tree");
    el.textContent = "⚠ multi-head tree: " + parts.join("; ");
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

    // gutter "+" — one per empty leaf line (a text question with nowhere to go yet)
    inner.querySelectorAll(".dsl-gutter-btn").forEach((n) => n.remove());
    const parsed = TM().parse(t);
    parsed.blocks.forEach((b) => {
      const empty = b.type === "text" && !b.next && !b.terminal;
      if (!empty) return;
      const btn = document.createElement("button");
      btn.className = "dsl-gutter-btn";
      btn.title = "add what happens next";
      btn.textContent = "+";
      btn.style.top = (b.rawLine * LINE_H) + "px";
      btn.onclick = () => {
        const uniq = TM().uniqueName(parsed, "new question");
        const res = TM().addConnectedChild(text(), b.name, uniq);
        mutate(res.text, res);
      };
      inner.appendChild(btn);
    });
  }

  // ── canvas ───────────────────────────────────────────────────────────
  function buildCanvas(parsed, graph) {
    const t = TM();
    const dupInfo = t.findDuplicateTitles(parsed);
    const dupNames = new Set(dupInfo.map((d) => t.norm(d.name)));
    const recallOptions = parsed.blocks.map((b) => ({ id: b.name, text: b.name || "(untitled)" }));

    const allRows = parsed.blocks.map((b) => graph.row.get(b.name) || 0).concat(graph.terminals.map((tm) => tm.row || 0));
    const allCols = parsed.blocks.map((b) => graph.col.get(b.name) || 0).concat(graph.terminals.map((tm) => tm.col || 0));
    const maxCol = allCols.length ? Math.max(...allCols) : 0;
    const minRow = allRows.length ? Math.min(...allRows) : 0;
    const maxRow = allRows.length ? Math.max(...allRows) : 0;
    const totalW = Math.max(360, PAD * 2 + (maxCol + 1) * COL_W);
    const totalH = Math.max(240, PAD * 2 + (maxRow - minRow + 1) * ROW_H);

    const xyByName = new Map();
    parsed.blocks.forEach((b) => {
      const col = graph.col.get(b.name) || 0;
      const row = (graph.row.get(b.name) || 0) - minRow;
      const cx = PAD + col * COL_W + CARD_W / 2, cy = PAD + row * ROW_H + CARD_H / 2;
      xyByName.set(b.name, { x: cx - CARD_W / 2, y: cy - CARD_H / 2, cx, cy });
    });
    const nodes = parsed.blocks.map((b) => {
      const p = xyByName.get(b.name) || { x: 0, y: 0 };
      return {
        id: b.name, name: b.name, text: b.name || "(untitled)", star: !!b.star, isChoice: b.type === "choice",
        isTerminal: false, isDuplicate: dupNames.has(t.norm(b.name)), recallTarget: b.recallTarget,
        x: p.x, y: p.y, w: CARD_W, h: CARD_H,
      };
    });
    graph.terminals.forEach((term) => {
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
    graph.terminals.forEach((term) => {
      const a = xyByName.get(term.from), b = xyByName.get(term.id);
      if (a && b) edges.push({ d: edgePath(a, b) });
    });
    const recallEdges = graph.recallEdges.map((e) => {
      const a = xyByName.get(e.from), b = xyByName.get(e.to);
      return a && b ? { d: edgePath(a, b) } : null;
    }).filter(Boolean);

    return { nodes, edges, recallEdges, w: totalW, h: totalH, recallOptions };
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
    content.appendChild(svg);

    canvas.nodes.forEach((n) => content.appendChild(buildCardEl(n, canvas.recallOptions)));

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
    label.className = "canvas-card-text"; label.textContent = n.text;
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

      const recall = document.createElement("button");
      recall.className = "canvas-recall-btn" + (n.recallTarget ? " on" : "");
      recall.title = "recall another question's past answers";
      recall.innerHTML = '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></svg>';
      recall.onclick = (e) => { e.stopPropagation(); _recallOpenFor = _recallOpenFor === n.name ? null : n.name; window.renderDslEditor(); };
      card.appendChild(recall);

      const plus = document.createElement("button");
      plus.className = "canvas-plus-btn"; plus.title = "drag out to add a connected question"; plus.textContent = "+";
      plus.addEventListener("mousedown", (e) => startPlusDrag(e, n.name));
      card.appendChild(plus);
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
    _plusDrag = { fromName, x: e.clientX - rect0.left, y: e.clientY - rect0.top };
    window.renderDslEditor();
    const onMove = (ev) => {
      const r2 = wrap.getBoundingClientRect();
      _plusDrag = { fromName, x: ev.clientX - r2.left, y: ev.clientY - r2.top };
      window.renderDslEditor();
    };
    const onUp = (ev) => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      const rect2 = wrap.getBoundingClientRect();
      const dropX = ev.clientX - rect2.left, dropY = ev.clientY - rect2.top;
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      const cardEl = el && el.closest ? el.closest("[data-canvas-card]") : null;
      _plusDrag = null;
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

  function renderHistoryRow() {
    const toggle = document.getElementById("historyToggleBtn");
    const slider = document.getElementById("treeHistorySlider");
    const label = document.getElementById("treeHistoryLabel");
    const count = _snapshots.length;
    label.textContent = count + (count === 1 ? " version" : " versions");
    toggle.textContent = _historyOpen ? "history ▾" : "history ▸";
    slider.style.display = _historyOpen ? "" : "none";
    slider.max = Math.max(0, count - 1);
    slider.value = _snapIndex;
  }

  // ── copy/paste-as-text — the editor already IS text, so these are trivial ──
  window.copyTreeAsText = async function () {
    try { await navigator.clipboard.writeText(text()); } catch (e) {}
    return text();
  };
  window.pasteTreeFromText = function (t, skipConfirm) {
    if (t == null) return;
    if (!skipConfirm && text().trim() && !confirm("Replace your current questions with the pasted tree?")) return;
    window.setDslText(t);
  };
})();
