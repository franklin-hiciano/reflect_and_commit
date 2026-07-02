// ── Node graph: a live, read-mostly visualization of the tree, sitting full-width
// above the text editor. It never has its own model — everything it draws is derived
// straight from `parsedTree` (the same parse the reflection engine and text editor use)
// so it can't drift out of sync with the source. The one thing it writes back is the
// "+" drag-to-create flow, and that always goes through the normal textarea value +
// _pushUndo + _onSrcChange(true) pipeline, same as typing would.

const NG_ROW = 52; // px per row
const NG_COL = 236; // px per depth column
const NG_CARD_H = 44; // 2 lines tall: title row + controls row
const NG_CARD_W = 208;
const NG_PAD = 18;

let _ngPanX = 20,
  _ngPanY = 16;
let _ngPanDragging = false,
  _ngPanStart = null;
let _ngPlusDrag = null; // { fromId, x, y } — panel-local, unpanned coords
let _ngNaming = null; // { x, y, parentId }
let _ngSelectedId = null; // last-tapped card — purely a visual "you're editing this one" marker
let _ngVertical = false; // depth grows top-to-bottom instead of left-to-right
try {
  _ngVertical = localStorage.getItem("ng_vertical") === "1";
} catch (e) {}

function ngPanel() {
  return document.getElementById("nodeGraphPanel");
}
function ngContent() {
  return document.getElementById("ngContent");
}
function ngSvg() {
  return document.getElementById("ngEdges");
}

// ── shared position math — kept in one place so panning, the "+" drag ghost, the
// naming popup and the minimap all agree on where a card actually is. Each axis's
// spacing constant (NG_COL, NG_ROW) is tied to that axis's own card dimension
// (width, height), not to "depth" vs "sibling" — so flipping `_ngVertical` (which
// just swaps which of col/row drives which axis) doesn't require different numbers. */
function ngCardXY(pos, id) {
  const p = pos[id];
  if (!p) return { x: NG_PAD, y: NG_PAD };
  return _ngVertical
    ? { x: NG_PAD + p.row * NG_COL, y: NG_PAD + p.col * NG_ROW }
    : { x: NG_PAD + p.col * NG_COL, y: NG_PAD + p.row * NG_ROW };
}

// ── derive nodes/edges from parsedTree — no independent state ──────────────────────
function ngNodeLevel(rawLine) {
  const src =
    typeof _activeSrc !== "undefined" ? _activeSrc : window._currentSrc || "";
  const lines = src.split("\n");
  const raw = lines[rawLine] || "";
  const sp = (raw.match(/^(\s*)/) || [""])[0].length;
  return Math.floor(sp / 2);
}

function ngBuildGraph() {
  const tree = typeof parsedTree !== "undefined" ? parsedTree : {};
  const ids = Object.keys(tree).filter((id) => tree[id] && tree[id].rawLine != null);
  if (!ids.length) return { nodes: [], edges: [], roots: [], byId: {}, referenced: new Set() };

  const referenced = new Set();
  const edges = [];
  ids.forEach((id) => {
    const n = tree[id];
    if (n.type === "text" && n.def && n.def !== "done" && tree[n.def]) {
      edges.push({ from: id, to: n.def, label: null });
      referenced.add(n.def);
    }
    if (n.type === "single") {
      (n.opts || []).forEach((o) => {
        if (o.n && o.n !== "done" && tree[o.n]) {
          edges.push({ from: id, to: o.n, label: o.l });
          referenced.add(o.n);
        }
      });
    }
  });

  const roots = ids.filter((id) => ngNodeLevel(tree[id].rawLine) === 0);
  const byId = {};
  ids.forEach((id) => (byId[id] = { id, ...tree[id] }));
  return { nodes: ids.map((id) => byId[id]), edges, roots, byId, referenced };
}

function ngLayout(graph) {
  const outgoing = {};
  graph.nodes.forEach((n) => (outgoing[n.id] = []));
  graph.edges.forEach((e) => outgoing[e.from] && outgoing[e.from].push(e));

  // a top-level (level-0) line that's ALSO reached by reference from elsewhere
  // in the tree (recall/def reuse — see ngBuildGraph's `referenced` set) is a
  // reusable target, not a second, independent branch of its own. It should
  // show up exactly once, nested under whatever node actually references it —
  // not floating as its own root too. So it's excluded from the DFS start set
  // here; it still renders (it's still in graph.nodes), just only reachable
  // via the edge that points at it.
  const orderedRoots = graph.roots
    .slice()
    .filter((id) => !graph.referenced || !graph.referenced.has(id))
    .sort((a, b) => graph.byId[a].rawLine - graph.byId[b].rawLine);

  // pass 1 — column = depth, via plain DFS (unchanged from before: a node reached
  // by more than one path takes the deepest column it's reached at).
  const col = {};
  function visitCol(id, c, path) {
    if (path.has(id)) return; // cycle guard — draw the edge, don't re-descend
    if (col[id] != null) {
      if (c > col[id]) col[id] = c;
      return;
    }
    col[id] = c;
    const nextPath = new Set(path);
    nextPath.add(id);
    outgoing[id].forEach((e) => visitCol(e.to, c + 1, nextPath));
  }
  orderedRoots.forEach((id) => visitCol(id, 0, new Set()));
  graph.nodes.forEach((n) => {
    if (col[n.id] == null) col[n.id] = 0;
  });

  // pass 2 — row = branch position, tidy-tree style (Reingold–Tilford's core idea):
  // leaves claim rows in visit order, and every parent centers itself on the
  // midpoint of its children's extent. A straight single-child chain stays
  // perfectly flat (midpoint of one child = that child), and a fork sits centered
  // between its branches instead of hugging the topmost one — which is what kept
  // making trees look lopsided.
  const row = {};
  let nextLeafRow = 0;
  const visiting = new Set(); // cycle guard for this pass
  function assignRow(id) {
    if (row[id] != null) return row[id];
    if (visiting.has(id)) return nextLeafRow; // cycle — park it rather than recurse forever
    visiting.add(id);
    const kids = outgoing[id].map((e) => e.to).filter((k) => graph.byId[k]);
    const kidRows = kids.map((k) => assignRow(k));
    const r = kidRows.length
      ? (Math.min(...kidRows) + Math.max(...kidRows)) / 2
      : nextLeafRow++;
    row[id] = r;
    visiting.delete(id);
    return r;
  }
  orderedRoots.forEach((id) => assignRow(id));
  graph.nodes.forEach((n) => {
    if (row[n.id] == null) row[n.id] = nextLeafRow++;
  });

  const pos = {};
  let maxRow = 0;
  graph.nodes.forEach((n) => {
    pos[n.id] = { col: col[n.id], row: row[n.id] };
    if (row[n.id] > maxRow) maxRow = row[n.id];
  });
  return { pos, rowCount: maxRow + 1 };
}

// ── render ───────────────────────────────────────────────────────────────────────────
window._renderNodeGraph = function () {
  const panel = ngPanel();
  if (!panel) return;
  const graph = ngBuildGraph();
  const { pos, rowCount } = ngLayout(graph);

  let content = ngContent();
  if (!content) return;
  content.innerHTML = "";

  const maxCol = graph.nodes.reduce((m, n) => Math.max(m, pos[n.id].col), 0);
  // axes swap with orientation (see ngCardXY) — so does which count drives which extent
  const w = _ngVertical
    ? NG_PAD * 2 + Math.max(rowCount, 1) * NG_COL
    : NG_PAD * 2 + (maxCol + 1) * NG_COL;
  const h = _ngVertical
    ? NG_PAD * 2 + (maxCol + 1) * NG_ROW
    : NG_PAD * 2 + Math.max(rowCount, 1) * NG_ROW;
  content.style.width = w + "px";
  content.style.height = h + "px";
  content.style.transform = "translate(" + _ngPanX + "px," + _ngPanY + "px)";

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("id", "ngEdges");
  svg.setAttribute("width", w);
  svg.setAttribute("height", h);
  svg.style.position = "absolute";
  svg.style.left = "0";
  svg.style.top = "0";
  svg.style.pointerEvents = "none";

  function cardXY(id) {
    return ngCardXY(pos, id);
  }

  graph.edges.forEach((e) => {
    const a = cardXY(e.from),
      b = cardXY(e.to);
    // exit/enter points sit on whichever edge cards actually grow toward: the
    // right/left edges in horizontal mode, the bottom/top edges in vertical mode
    const x1 = _ngVertical ? a.x + NG_CARD_W / 2 : a.x + NG_CARD_W,
      y1 = _ngVertical ? a.y + NG_CARD_H : a.y + NG_CARD_H / 2;
    const x2 = _ngVertical ? b.x + NG_CARD_W / 2 : b.x,
      y2 = _ngVertical ? b.y : b.y + NG_CARD_H / 2;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    let d;
    if (_ngVertical) {
      if (x1 === x2) {
        d = "M" + x1 + "," + y1 + " L " + x2 + "," + y2;
      } else {
        // rigid elbow: out downward, turn once at the midpoint row, into the child
        const midY = y1 + (y2 - y1) / 2;
        d =
          "M" + x1 + "," + y1 +
          " L " + x1 + "," + midY +
          " L " + x2 + "," + midY +
          " L " + x2 + "," + y2;
      }
    } else if (y1 === y2) {
      // straight shot — same row, no elbow needed
      d = "M" + x1 + "," + y1 + " L " + x2 + "," + y2;
    } else {
      // rigid elbow: out horizontally, turn once at the midpoint column, into the child
      const midX = x1 + (x2 - x1) / 2;
      d =
        "M" + x1 + "," + y1 +
        " L " + midX + "," + y1 +
        " L " + midX + "," + y2 +
        " L " + x2 + "," + y2;
    }
    path.setAttribute("d", d);
    path.setAttribute("class", "ng-edge");
    svg.appendChild(path);
  });

  content.appendChild(svg);

  graph.nodes.forEach((n) => {
    const { x, y } = cardXY(n.id);
    const card = document.createElement("div");
    card.className = "ng-node" + (n.id === _ngSelectedId ? " selected" : "");
    card.style.left = x + "px";
    card.style.top = y + "px";
    card.style.width = NG_CARD_W + "px";
    card.style.height = NG_CARD_H + "px";
    card.dataset.id = n.id;

    const rowTop = document.createElement("div");
    rowTop.className = "ng-row-top";

    const icon = document.createElement("span");
    icon.className = "ng-type-icon";
    icon.innerHTML =
      n.type === "single"
        ? '<svg viewBox="0 0 16 16" width="11" height="11"><circle cx="8" cy="3.5" r="1.6" fill="currentColor"/><circle cx="3.5" cy="12.5" r="1.6" fill="currentColor"/><circle cx="12.5" cy="12.5" r="1.6" fill="currentColor"/><path d="M8 5.1 L4 11 M8 5.1 L12 11" stroke="currentColor" stroke-width="1.1" fill="none"/></svg>'
        : '<svg viewBox="0 0 16 16" width="11" height="11"><path d="M2 4h12M2 8h9M2 12h6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';
    rowTop.appendChild(icon);

    const title = document.createElement("span");
    title.className = "ng-title";
    title.textContent = n.title;
    rowTop.appendChild(title);

    card.appendChild(rowTop);

    const rowBottom = document.createElement("div");
    rowBottom.className = "ng-row-bottom";

    const plus = document.createElement("button");
    plus.className = "ng-plus";
    plus.type = "button";
    plus.title = "drag to add a question";
    plus.textContent = "+";
    plus.addEventListener("pointerdown", (e) => ngStartPlusDrag(e, n.id));
    rowBottom.appendChild(plus);

    const recalls = window._effectiveRecallSources
      ? window._effectiveRecallSources(n.title)
      : [];
    const recall = document.createElement("button");
    recall.className = "ng-recall" + (recalls.length ? " on" : "");
    recall.type = "button";
    recall.title = recalls.length
      ? "recalling answers from: " + recalls.join(", ")
      : "recall past answers from another question";
    recall.innerHTML = "↻";
    recall.addEventListener("pointerdown", (e) => e.stopPropagation());
    recall.addEventListener("click", (e) => {
      e.stopPropagation();
      const cur = window._effectiveRecallSources
        ? window._effectiveRecallSources(n.title)
        : [];
      if (cur.length) {
        if (window.clearRecalls) clearRecalls(n.title);
        window._renderNodeGraph();
      } else {
        openRecallDropdown(n.title, recall, cur);
      }
    });
    rowBottom.appendChild(recall);

    card.appendChild(rowBottom);

    // ── hold to erase (own timer per card, cancelled by release/drift/the plus
    // and recall buttons) — a plain click still navigates/edits normally ─────────────
    let pressTimer = null;
    let pressStart = null;
    let longPressFired = false;
    function cancelPress() {
      clearTimeout(pressTimer);
      pressTimer = null;
      pressStart = null;
      card.classList.remove("pressing");
    }
    card.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".ng-plus") || e.target.closest(".ng-recall")) return;
      longPressFired = false;
      pressStart = { x: e.clientX, y: e.clientY };
      card.classList.add("pressing");
      pressTimer = setTimeout(() => {
        longPressFired = true;
        cancelPress();
        ngDeleteNode(n.id);
      }, 550);
    });
    card.addEventListener("pointerup", cancelPress);
    card.addEventListener("pointerleave", cancelPress);
    card.addEventListener("pointermove", (e) => {
      if (!pressStart) return;
      const dx = e.clientX - pressStart.x,
        dy = e.clientY - pressStart.y;
      // generous enough to absorb natural finger drift during a hold on a touchscreen
      if (Math.abs(dx) + Math.abs(dy) > 12) cancelPress();
    });

    card.addEventListener("click", (e) => {
      if (e.target.closest(".ng-plus") || e.target.closest(".ng-recall")) return;
      if (_ngPanDragging || longPressFired) return;
      ngSelectNode(n.id);
      navigateToLine(n.rawLine);
    });

    content.appendChild(card);
  });

  ngRenderMinimap(graph, pos, w, h);
  const vToggle = document.getElementById("ngVerticalToggle");
  if (vToggle) vToggle.classList.toggle("on", _ngVertical);
};

// ── selection — a lightweight "you just tapped this one" marker, independent of
// text-editor cursor state. Only touches the DOM (no full re-render needed). ────────
function ngSelectNode(id) {
  _ngSelectedId = id;
  const content = ngContent();
  if (!content) return;
  content.querySelectorAll(".ng-node.selected").forEach((el) => el.classList.remove("selected"));
  const el = content.querySelector('[data-id="' + CSS.escape(id) + '"]');
  if (el) el.classList.add("selected");
}

// ── "rightmost" node — the deepest node in the tree (max depth/col); ties broken by
// whichever is topmost (lowest row). This is what the floating "+" fab extends —
// adding onto one specific node is what the node's own "+" is for. ─────────────────
function ngRightmostNode() {
  const graph = ngBuildGraph();
  if (!graph.nodes.length) return null;
  const { pos } = ngLayout(graph);
  let best = null,
    bestCol = -1,
    bestRow = Infinity;
  graph.nodes.forEach((n) => {
    const p = pos[n.id];
    if (!p) return;
    if (p.col > bestCol || (p.col === bestCol && p.row < bestRow)) {
      bestCol = p.col;
      bestRow = p.row;
      best = n.id;
    }
  });
  return best;
}

window._ngAddFromRightmost = function () {
  const id = ngRightmostNode();
  if (!id) return;
  const graph = ngBuildGraph();
  const { pos } = ngLayout(graph);
  const anchor = ngCardXY(pos, id);
  const panel = ngPanel();
  const rect = panel ? panel.getBoundingClientRect() : { width: 400, height: 300 };

  let x, y;
  if (_ngVertical) {
    x = anchor.x + NG_CARD_W / 2 + _ngPanX;
    y = anchor.y + NG_CARD_H + 40 + _ngPanY;
  } else {
    x = anchor.x + NG_CARD_W + 40 + _ngPanX;
    y = anchor.y + NG_CARD_H / 2 + _ngPanY;
  }
  // keep the naming popup on-screen even if the rightmost node is currently panned
  // out of view
  x = Math.max(20, Math.min(x, rect.width - 20));
  y = Math.max(20, Math.min(y, rect.height - 20));

  ngSelectNode(id);
  ngOpenNaming(x, y, id);
};

// ── minimap — only shown once the tree has outgrown the panel, top-right ───────────
function ngRenderMinimap(graph, pos, w, h) {
  const wrap = document.getElementById("ngMinimap");
  const svg = document.getElementById("ngMinimapSvg");
  const panel = ngPanel();
  if (!wrap || !svg || !panel) return;
  const rect = panel.getBoundingClientRect();
  const big = rect.width > 0 && (w > rect.width * 1.15 || h > rect.height * 1.15);
  wrap.classList.toggle("show", big);
  if (!big) {
    svg.innerHTML = "";
    return;
  }

  svg.setAttribute("viewBox", "0 0 " + w + " " + h);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  let s = "";
  graph.nodes.forEach((n) => {
    const p = ngCardXY(pos, n.id);
    s +=
      '<rect x="' + p.x + '" y="' + p.y + '" width="' + NG_CARD_W + '" height="' + NG_CARD_H +
      '" rx="4" style="fill:var(--border3)"></rect>';
  });
  const strokeW = Math.max(w, h) / 80;
  s +=
    '<rect id="ngMinimapViewport" x="0" y="0" width="0" height="0" ' +
    'style="fill:none;stroke:var(--accent);stroke-width:' + strokeW + '"></rect>';
  svg.innerHTML = s;
  // cache the panel size the viewport rect was built for, and draw the initial box —
  // subsequent pans just update this rect's attrs instead of re-rendering the whole map
  svg.dataset.panelW = rect.width;
  svg.dataset.panelH = rect.height;
  ngUpdateMinimapViewport();
}

// cheap per-frame update of just the viewport-outline rect — called continuously while
// panning so the minimap tracks the canvas live, instead of only on full re-renders
function ngUpdateMinimapViewport() {
  const svg = document.getElementById("ngMinimapSvg");
  const vp = document.getElementById("ngMinimapViewport");
  if (!svg || !vp) return;
  const vw = Number(svg.dataset.panelW) || 0;
  const vh = Number(svg.dataset.panelH) || 0;
  vp.setAttribute("x", -_ngPanX);
  vp.setAttribute("y", -_ngPanY);
  vp.setAttribute("width", vw);
  vp.setAttribute("height", vh);
}

function ngMinimapPanTo(e) {
  const svg = document.getElementById("ngMinimapSvg");
  const panel = ngPanel();
  if (!svg || !panel || typeof svg.createSVGPoint !== "function") return;
  const ctm = svg.getScreenCTM();
  if (!ctm) return;
  const pt = svg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const loc = pt.matrixTransform(ctm.inverse());
  const rect = panel.getBoundingClientRect();
  _ngPanX = rect.width / 2 - loc.x;
  _ngPanY = rect.height / 2 - loc.y;
  const content = ngContent();
  if (content) content.style.transform = "translate(" + _ngPanX + "px," + _ngPanY + "px)";
  ngUpdateMinimapViewport();
}

function ngBindMinimap() {
  const wrap = document.getElementById("ngMinimap");
  if (!wrap || wrap._ngBound) return;
  wrap._ngBound = true;
  let dragging = false;
  wrap.addEventListener("pointerdown", (e) => {
    dragging = true;
    wrap.setPointerCapture(e.pointerId);
    ngMinimapPanTo(e);
  });
  wrap.addEventListener("pointermove", (e) => {
    if (dragging) ngMinimapPanTo(e);
  });
  wrap.addEventListener("pointerup", () => (dragging = false));
  wrap.addEventListener("pointerleave", () => (dragging = false));
}

// ── vertical/horizontal orientation toggle ──────────────────────────────────────────
window._ngToggleVertical = function () {
  _ngVertical = !_ngVertical;
  try {
    localStorage.setItem("ng_vertical", _ngVertical ? "1" : "0");
  } catch (e) {}
  window._renderNodeGraph();
};

// ── hold-to-erase: removes the node's own line plus its whole subtree, so no
// indented children are left dangling under nothing. Goes through the same
// undo/onSrcChange pipeline as every other graph-driven edit. ──────────────────────
function ngDeleteNode(id) {
  const t = ta();
  const tree = typeof parsedTree !== "undefined" ? parsedTree : {};
  const node = tree[id];
  if (!t || !node || node.rawLine == null) return;

  const src = t.value;
  const rawLines = src.split("\n");
  const items = ngLineItems(src);
  const idx = items.findIndex((it) => it.rawLine === node.rawLine);
  if (idx < 0) return;

  const endIdx = ngSubtreeEndIdx(items, idx);
  const rawStart = items[idx].rawLine;
  const rawEnd = ngRawEndFor(items, endIdx, rawLines);

  rawLines.splice(rawStart, rawEnd - rawStart);

  if (typeof _pushUndo === "function") _pushUndo(t.value);
  t.value = rawLines.join("\n");
  if (_ngSelectedId === id) _ngSelectedId = null;
  if (window._onSrcChange) window._onSrcChange(true);
}

// ── panning ──────────────────────────────────────────────────────────────────────────
function ngBindPanel() {
  const panel = ngPanel();
  if (!panel || panel._ngBound) return;
  panel._ngBound = true;

  panel.addEventListener("pointerdown", (e) => {
    if (
      e.target.closest(".ng-node") ||
      e.target.closest(".ng-naming") ||
      e.target.closest(".ng-minimap") ||
      e.target.closest(".ng-vertical-toggle") ||
      e.target.closest(".ng-add-fab-wrap") ||
      e.target.closest(".mobile-dock-flip")
    )
      return;
    // panning the empty canvas must never blur the text editor — that's what would
    // silently dismiss the on-screen keyboard on mobile. Only the dedicated
    // down-chevron button (window._ngDismissKeyboard) is allowed to do that.
    e.preventDefault();
    _ngPanDragging = false;
    _ngPanStart = { x: e.clientX, y: e.clientY, panX: _ngPanX, panY: _ngPanY };
    panel.setPointerCapture(e.pointerId);
  });
  panel.addEventListener("pointermove", (e) => {
    if (_ngPlusDrag) {
      ngUpdatePlusDrag(e);
      return;
    }
    if (!_ngPanStart) return;
    const dx = e.clientX - _ngPanStart.x,
      dy = e.clientY - _ngPanStart.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) _ngPanDragging = true;
    if (!_ngPanDragging) return;
    _ngPanX = _ngPanStart.panX + dx;
    _ngPanY = _ngPanStart.panY + dy;
    const content = ngContent();
    if (content) content.style.transform = "translate(" + _ngPanX + "px," + _ngPanY + "px)";
    ngUpdateMinimapViewport();
  });
  panel.addEventListener("pointerup", (e) => {
    if (_ngPlusDrag) {
      ngEndPlusDrag(e);
      return;
    }
    _ngPanStart = null;
    setTimeout(() => (_ngPanDragging = false), 0);
  });
  panel.addEventListener("pointerleave", (e) => {
    if (!_ngPlusDrag) _ngPanStart = null;
  });
}

// ── "+" drag → create a node ────────────────────────────────────────────────────────
function ngStartPlusDrag(e, fromId) {
  e.preventDefault();
  e.stopPropagation();
  const panel = ngPanel();
  const rect = panel.getBoundingClientRect();
  _ngPlusDrag = {
    fromId,
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  };
  panel.setPointerCapture(e.pointerId);
  ngRenderDragGhost();
}
function ngUpdatePlusDrag(e) {
  if (!_ngPlusDrag) return;
  const panel = ngPanel();
  const rect = panel.getBoundingClientRect();
  _ngPlusDrag.x = e.clientX - rect.left;
  _ngPlusDrag.y = e.clientY - rect.top;
  ngRenderDragGhost();
}
function ngRenderDragGhost() {
  let ghost = document.getElementById("ngDragGhost");
  const panel = ngPanel();
  if (!ghost) {
    ghost = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    ghost.setAttribute("id", "ngDragGhost");
    ghost.style.position = "absolute";
    ghost.style.inset = "0";
    ghost.style.width = "100%";
    ghost.style.height = "100%";
    ghost.style.pointerEvents = "none";
    ghost.style.zIndex = "5";
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("id", "ngDragLine");
    line.setAttribute("class", "ng-drag-line");
    ghost.appendChild(line);
    panel.appendChild(ghost);
  }
  const graph = ngBuildGraph();
  const { pos } = ngLayout(graph);
  const p = pos[_ngPlusDrag.fromId];
  if (!p) return;
  const anchor = ngCardXY(pos, _ngPlusDrag.fromId);
  const x1 = _ngVertical
    ? anchor.x + NG_CARD_W / 2 + _ngPanX
    : anchor.x + NG_CARD_W + _ngPanX;
  const y1 = _ngVertical
    ? anchor.y + NG_CARD_H + _ngPanY
    : anchor.y + NG_CARD_H / 2 + _ngPanY;
  const line = document.getElementById("ngDragLine");
  if (line) {
    line.setAttribute("x1", x1);
    line.setAttribute("y1", y1);
    line.setAttribute("x2", _ngPlusDrag.x);
    line.setAttribute("y2", _ngPlusDrag.y);
  }
}
function ngEndPlusDrag(e) {
  const drag = _ngPlusDrag;
  _ngPlusDrag = null;
  const ghost = document.getElementById("ngDragGhost");
  if (ghost) ghost.remove();
  if (!drag) return;

  const panel = ngPanel();
  const rect = panel.getBoundingClientRect();
  if (
    e.clientX < rect.left ||
    e.clientX > rect.right ||
    e.clientY < rect.top ||
    e.clientY > rect.bottom
  ) {
    return; // dropped outside the panel — cancel
  }
  if (e.target.closest(".ng-node")) return; // dropping onto an existing node isn't wired up yet

  ngOpenNaming(drag.x, drag.y, drag.fromId);
}

function ngOpenNaming(x, y, parentId) {
  ngCloseNaming();
  const panel = ngPanel();
  const wrap = document.createElement("div");
  wrap.className = "ng-naming";
  wrap.style.left = x + "px";
  wrap.style.top = y + "px";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "new question…";
  wrap.appendChild(input);
  panel.appendChild(wrap);
  _ngNaming = { el: wrap, parentId };
  setTimeout(() => input.focus(), 0);

  // removing the input mid-keydown can synchronously fire a native "blur" on it
  // (Chromium does this), which would otherwise re-enter this same commit/cancel
  // logic — `done` makes commit/cancel run at most once no matter how they're
  // triggered.
  let done = false;
  function commit() {
    if (done) return;
    done = true;
    const title = input.value.trim();
    ngCloseNaming();
    if (title) ngCreateChildNode(parentId, title);
  }
  function cancel() {
    if (done) return;
    done = true;
    ngCloseNaming();
  }

  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") commit();
    else if (e.key === "Escape") cancel();
  });
  input.addEventListener("blur", commit);
}
function ngCloseNaming() {
  const cur = _ngNaming;
  _ngNaming = null;
  if (cur && cur.el && cur.el.parentNode) cur.el.remove();
}

// ── text splicing: insert a new node under `parentId`, boilerplating multi-choice
// syntax the moment a parent that already has one destination gets a second ──────────
function ngLineItems(src) {
  const items = [];
  (src || "").split("\n").forEach((line, i) => {
    const tr = line.trim();
    if (!tr || tr.startsWith("#")) return;
    const sp = (line.match(/^(\s*)/) || [""])[0].length;
    items.push({ text: tr, level: Math.floor(sp / 2), rawLine: i });
  });
  return items;
}
function ngChildList(items) {
  const childList = items.map(() => []);
  const stk = [];
  for (let i = 0; i < items.length; i++) {
    const lv = items[i].level;
    while (stk.length && items[stk[stk.length - 1]].level >= lv) stk.pop();
    if (stk.length) childList[stk[stk.length - 1]].push(i);
    stk.push(i);
  }
  return childList;
}
function ngSubtreeEndIdx(items, idx) {
  const lv = items[idx].level;
  let j = idx + 1;
  while (j < items.length && items[j].level > lv) j++;
  return j;
}
// ── raw-line boundary for an item-index end, without trusting rawLines.length as
// the "end of real content" fallback. A textarea value that ends with a trailing
// newline splits into a spurious empty trailing element (`"a\n".split("\n")` →
// `["a", ""]`) that ngLineItems correctly ignores (blank lines aren't items) but
// which still inflates rawLines.length by one — so falling back to rawLines.length
// inserted new content one line PAST the real last line, leaving a stray blank
// line before it (this is the "+" button's "two newlines then option n" bug). ────
function ngRawEndFor(items, endIdx, rawLines) {
  if (endIdx < items.length) return items[endIdx].rawLine;
  return items.length ? items[items.length - 1].rawLine + 1 : rawLines.length;
}

function ngCreateChildNode(parentId, title) {
  const t = ta();
  const tree = typeof parsedTree !== "undefined" ? parsedTree : {};
  const parent = tree[parentId];
  if (!t || !parent || parent.rawLine == null) return;

  const src = t.value;
  const rawLines = src.split("\n");
  const items = ngLineItems(src);
  const childList = ngChildList(items);
  const pIdx = items.findIndex((it) => it.rawLine === parent.rawLine);
  if (pIdx < 0) return;

  const level = items[pIdx].level;
  const kids = childList[pIdx];
  const indent = (n) => "  ".repeat(n);
  let newSrc;
  let newLineRaw; // rawLine the new title itself lands on, once all splices settle

  if (kids.length === 0) {
    const insertAt = parent.rawLine + 1;
    rawLines.splice(insertAt, 0, indent(level + 1) + title);
    newSrc = rawLines.join("\n");
    newLineRaw = insertAt;
  } else if (kids.length === 1) {
    const childIdx = kids[0];
    const endIdx = ngSubtreeEndIdx(items, childIdx);
    const childStartRaw = items[childIdx].rawLine;
    const rawEnd = ngRawEndFor(items, endIdx, rawLines);

    for (let r = childStartRaw; r < rawEnd; r++) {
      if (rawLines[r] != null) rawLines[r] = "  " + rawLines[r];
    }
    rawLines.splice(childStartRaw, 0, indent(level + 1) + "option 1");
    rawLines.splice(rawEnd + 1, 0, indent(level + 1) + "option 2", indent(level + 2) + title);
    newSrc = rawLines.join("\n");
    newLineRaw = rawEnd + 2; // "option 1" shifted everything below down by one first
  } else {
    const lastChildIdx = kids[kids.length - 1];
    const endIdx = ngSubtreeEndIdx(items, lastChildIdx);
    const rawEnd = ngRawEndFor(items, endIdx, rawLines);
    const n = kids.length + 1;
    rawLines.splice(rawEnd, 0, indent(level + 1) + "option " + n, indent(level + 2) + title);
    newSrc = rawLines.join("\n");
    newLineRaw = rawEnd + 1;
  }

  if (typeof _pushUndo === "function") _pushUndo(t.value);
  t.value = newSrc;
  if (window._onSrcChange) window._onSrcChange(true);

  // a freshly created node is empty of any real thought yet — drop straight into
  // editing it, same as tapping an existing card does
  const newId = ngNodeIdAtRawLine(newLineRaw);
  if (newId) ngSelectNode(newId);
  navigateToLine(newLineRaw);
}

function ngNodeIdAtRawLine(rawLine) {
  const tree = typeof parsedTree !== "undefined" ? parsedTree : {};
  return Object.keys(tree).find((k) => tree[k] && tree[k].rawLine === rawLine) || null;
}

// ── click-to-navigate: jump the text editor to a node's line, select its text (so
// typing immediately replaces it — tapping a card starts editing right away) and
// pin the recall gutter button open. No editing UI lives on the graph card itself. ──
function navigateToLine(rawLine) {
  const t = ta();
  if (!t || rawLine == null) return;
  const lines = t.value.split("\n");
  let offset = 0;
  for (let i = 0; i < rawLine && i < lines.length; i++) offset += lines[i].length + 1;
  const lineText = lines[rawLine] || "";
  const leading = (lineText.match(/^\s*/) || [""])[0].length;

  t.focus();
  t.selectionStart = offset + leading;
  t.selectionEnd = offset + lineText.length;
  t.scrollTop = Math.max(0, PAD + rawLine * LH - t.clientHeight / 2);
  syncScroll();

  const bar = lhl();
  if (bar) {
    bar.style.top = PAD + rawLine * LH - t.scrollTop + "px";
    bar.style.height = LH + "px";
    bar.style.left = "0";
    bar.style.right = "0";
    bar.style.display = "block";
  }

  _hoverLineIdx = rawLine;
  renderHoverBtns(false);
}
window._ngRepositionLineHl = function () {
  const bar = lhl();
  const t = ta();
  if (!bar || !t || bar.style.display === "none") return;
  if (_hoverLineIdx < 0) return;
  bar.style.top = PAD + _hoverLineIdx * LH - t.scrollTop + "px";
};

(function () {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      ngBindPanel();
      ngBindMinimap();
    });
  } else {
    ngBindPanel();
    ngBindMinimap();
  }
})();

// ── mobile: flip which edge the compact 10% editor sliver docks to ─────────────────
// Canvas is always 90vw, editor always 10vw — neither pane's own size ever changes,
// so nothing inside them (the textarea, the graph) reflows or rewraps. Flipping just
// slides the whole rigid two-pane assembly via transform, toggled by one class.
window._toggleMobileDock = function () {
  const split = document.getElementById("editorSplit");
  if (!split) return;
  const flipped = split.classList.toggle("flipped");
  const label = document.getElementById("mobileDockFlipLabel");
  const arrow = document.getElementById("mobileDockFlipArrow");
  if (label) label.textContent = flipped ? "editor" : "canvas";
  if (arrow) arrow.textContent = flipped ? "←" : "→";
  // the dock-toggle bar and floating fabs live outside .editor-split (they're fixed
  // to the viewport, not the pane), so they need their own signal for which side the
  // 10vw editor sliver is currently docked to, to keep clear of it either way
  document.body.classList.toggle("ng-flipped", flipped);
};

// ── keeps the add-fab clear of the on-screen keyboard — the only floating control
// that moves; undo/redo/history, the dock toggle and the "get the app" fab all stay
// put so the layout doesn't jump around while typing. (Dismissing the keyboard is
// the OS keyboard's own job — every mobile keyboard ships its own down-chevron.) ────
function ngHandleViewportResize() {
  const wrap = document.getElementById("ngAddFabWrap");
  if (!window.visualViewport) return;
  const vv = window.visualViewport;
  const overlap = window.innerHeight - (vv.height + vv.offsetTop);
  const keyboardOpen = overlap > 60;
  if (wrap) wrap.style.transform = keyboardOpen ? "translateY(-" + overlap + "px)" : "";
}
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", ngHandleViewportResize);
  window.visualViewport.addEventListener("scroll", ngHandleViewportResize);
}
