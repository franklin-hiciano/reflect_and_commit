// ── Graph view: a live, read-only picture of the tree ──────────────────────
//
// This exists for one reason: Franklin's actual complaint was that building
// a branching tree took "lots of attention... predicting your own behavior"
// — i.e. holding the whole shape of the tree in your head just to know
// where a path ends up. This panel removes that entirely: it's a pure
// function of `questions` (via RCDsl.buildGraphModel), re-drawn after every
// edit, so the shape is always just *there* to look at instead of derived.
// It never writes anything back — the block editor above/below it is the
// only thing that mutates the tree.

(function () {
  const ROW_H = 74;
  const COL_W = 196;
  const CARD_W = 168;
  const CARD_H = 46;
  const PAD = 20;

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function render(host, questions) {
    if (!host) return;
    if (!window.RCDsl) { host.innerHTML = ""; return; }
    const model = window.RCDsl.buildGraphModel(questions || []);
    host.innerHTML = "";
    if (!model.nodes.length) {
      const empty = document.createElement("div");
      empty.className = "graph-empty";
      empty.textContent = "add a question below and the shape of your tree shows up here";
      host.appendChild(empty);
      return;
    }
    const maxRow = Math.max(0, ...model.nodes.map((n) => n.row));
    // group by row so each row's cards can be centered as their own group —
    // a lone branch pair shouldn't hug the left edge just because some
    // other row in the tree is wider
    const byRow = new Map();
    model.nodes.forEach((n) => { if (!byRow.has(n.row)) byRow.set(n.row, []); byRow.get(n.row).push(n); });
    let maxRowCount = 1;
    byRow.forEach((list) => { maxRowCount = Math.max(maxRowCount, list.length); });
    const totalW = PAD * 2 + maxRowCount * COL_W;
    const totalH = PAD * 2 + (maxRow + 1) * ROW_H;

    const wrap = document.createElement("div");
    wrap.className = "graph-scroll";
    wrap.style.setProperty("--w", totalW + "px");
    wrap.style.setProperty("--h", totalH + "px");

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", totalW);
    svg.setAttribute("height", totalH);
    svg.classList.add("graph-edges");

    const xyById = new Map();
    byRow.forEach((list, row) => {
      list.sort((a, b) => a.seq - b.seq);
      const rowW = list.length * COL_W;
      const rowStartX = (totalW - rowW) / 2;
      list.forEach((n, i) => {
        const cx = rowStartX + i * COL_W + COL_W / 2;
        const cy = PAD + row * ROW_H + CARD_H / 2;
        xyById.set(n.id, { cx, cy, x: cx - CARD_W / 2, y: cy - CARD_H / 2 });
      });
    });

    // edges first (under the cards)
    model.edges.forEach((e) => {
      const a = xyById.get(e.from), b = xyById.get(e.to);
      if (!a || !b) return;
      const y1 = a.cy + CARD_H / 2, y2 = b.cy - CARD_H / 2;
      const midY = (y1 + y2) / 2;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      const d = `M ${a.cx} ${y1} C ${a.cx} ${midY}, ${b.cx} ${midY}, ${b.cx} ${y2}`;
      path.setAttribute("d", d);
      path.setAttribute("class", "graph-edge" + (e.dashed ? " dashed" : ""));
      svg.appendChild(path);
      if (e.label) {
        const t = document.createElementNS("http://www.w3.org/2000/svg", "text");
        t.setAttribute("x", (a.cx + b.cx) / 2);
        t.setAttribute("y", midY - 4);
        t.setAttribute("class", "graph-edge-label");
        t.setAttribute("text-anchor", "middle");
        t.textContent = e.label;
        svg.appendChild(t);
      }
    });
    wrap.appendChild(svg);

    model.nodes.forEach((n) => {
      const xy = xyById.get(n.id);
      if (!xy) return;
      const card = document.createElement("div");
      card.className = "graph-card" + (n.type === "terminal" ? " terminal" : "") + (n.type === "choice" ? " choice" : "") + (n.star ? " star" : "");
      card.style.left = xy.x + "px";
      card.style.top = xy.y + "px";
      card.style.width = CARD_W + "px";
      card.style.height = CARD_H + "px";
      const label = n.type === "terminal" ? n.text : (n.text || "(untitled)");
      card.innerHTML = `<span class="graph-card-text">${esc(label.length > 46 ? label.slice(0, 45) + "…" : label)}</span>` +
        (n.recall ? '<span class="graph-badge" title="recalls past answers">↺</span>' : "") +
        (n.star ? '<span class="graph-badge" title="tonight\'s minimum">★</span>' : "");
      wrap.appendChild(card);
    });

    host.appendChild(wrap);
  }

  window._renderTreeGraph = function () {
    render(document.getElementById("treeGraph"), window.questions);
  };
})();
