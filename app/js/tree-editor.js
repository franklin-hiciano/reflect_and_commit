// ── Tree editor: the low-attention block editor ────────────────────────────
//
// This replaces the old click-heavy list (drag handle + star + recall +
// delete + split/merge icons + a modal "edit mode") with the same underlying
// idea, restyled and simplified:
//   - always live — there's no edit-mode toggle to remember you're in
//   - drag any row by its handle to reorder it (Pointer Events, same
//     technique the old editor used — works for mouse, trackpad, touch)
//   - a thin "+" sits in every gap between rows (and at the start/end of any
//     list, including an as-yet-empty one); tapping it drops in a small
//     inline textbox right there — type and hit enter, no dialog, no syntax
//   - an option that already leads somewhere doesn't get a "+" for its own
//     follow-up (nothing to add) — the "+" only shows up on bare options
//   - recall / star / delete are small icons that only need one tap; nothing
//     here requires knowing the text grammar in dsl.js at all. That grammar
//     still exists as an EXPORT/IMPORT format (see "paste tree" / "copy as
//     text" in the topbar) for backup or writing a tree elsewhere, but nobody
//     has to touch it to use the app day to day.
//
// Operates directly on the same `questions` array / `persistQuestions()` /
// `ensureShape()` / `normalizeTree()` app.js already has — nothing about the
// reflect/commit/sync engine changes.

(function () {
  let _insertBox = null; // { close() } for whichever inline "+" box is open

  function closeInsertBox() {
    if (_insertBox) { _insertBox.close(); _insertBox = null; }
  }

  function icon(name) {
    const paths = {
      recall: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>',
      star: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8.3 2.5h7.4L21 7.8v7.4L15.7 21H8.3L3 15.2V7.8L8.3 2.5z"/></svg>',
      starOutline: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M8.3 2.5h7.4L21 7.8v7.4L15.7 21H8.3L3 15.2V7.8L8.3 2.5z"/></svg>',
      del: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
      plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
      branch: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3v7a4 4 0 0 0 4 4h4M6 3a2 2 0 1 1 0 .001zM18 6a2 2 0 1 1 0-.001zM18 18a2 2 0 1 1 0-.001z"/><path d="M18 8v6"/></svg>',
    };
    return paths[name] || "";
  }
  function btn(cls, title, html, fn) {
    const b = document.createElement("button");
    b.className = "t-icon " + cls; if (title) b.title = title;
    b.innerHTML = html; b.onclick = (e) => { e.stopPropagation(); fn(); };
    return b;
  }
  // a couple of controls (add/remove branching) read clearer as a short word
  // than as another small glyph next to delete's ✕ — easy to mistake one X
  // for another at this size.
  function textBtn(cls, title, label, fn) {
    const b = document.createElement("button");
    b.className = "t-textbtn " + cls; if (title) b.title = title;
    b.textContent = label; b.onclick = (e) => { e.stopPropagation(); fn(); };
    return b;
  }

  // ── inline "+" gap: renders as a thin hairline; hover reveals a small +;
  // click swaps it for a one-line textbox. `onCommit(text)` inserts at this
  // exact position in whichever flat list owns the gap. ────────────────────
  function buildGap(onCommit) {
    const gap = document.createElement("div"); gap.className = "t-gap";
    const plus = document.createElement("button"); plus.className = "t-gap-plus"; plus.innerHTML = icon("plus");
    gap.appendChild(plus);
    plus.onclick = (e) => {
      e.stopPropagation();
      closeInsertBox();
      gap.classList.add("open");
      plus.style.display = "none";
      const box = document.createElement("input");
      box.className = "t-gap-input"; box.placeholder = "type a question…";
      gap.appendChild(box);
      box.focus();
      // Enter, Escape, and blur all want to "finish" this box, and removing
      // it from the DOM (below) itself triggers a blur — without a guard
      // that's a re-entrant double call (and a removeChild on an
      // already-detached node). One flag makes every path after the first
      // a no-op.
      let finished = false;
      const finish = (commit) => {
        if (finished) return;
        finished = true;
        const v = box.value.trim();
        gap.classList.remove("open"); plus.style.display = "";
        if (box.parentElement) gap.removeChild(box);
        _insertBox = null;
        if (commit && v) onCommit(v);
      };
      box.onkeydown = (ev) => {
        if (ev.key === "Enter") { ev.preventDefault(); finish(true); }
        else if (ev.key === "Escape") { ev.preventDefault(); finish(false); }
      };
      box.onblur = () => finish(true);
      _insertBox = { close: () => finish(false) };
    };
    return gap;
  }

  function newNode(text) {
    return { id: "q_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7), text: text || "", recall: false, type: "text" };
  }

  // ── renders one flat list (the root spine, or any branch's own content)
  // as rows-with-gaps. `list` is the actual array — mutations splice it in
  // place, then persistQuestions()+re-render. `depth` is visual indent only.
  function buildFlatList(list, depth, isRoot, onListChanged) {
    const wrap = document.createElement("div"); wrap.className = "t-list"; wrap.style.setProperty("--depth", depth);
    wrap.appendChild(buildGap((text) => { list.splice(0, 0, newNode(text)); onListChanged(); }));
    list.forEach((node, i) => {
      wrap.appendChild(buildRow(node, list, i, depth, isRoot, onListChanged));
      wrap.appendChild(buildGap((text) => { list.splice(i + 1, 0, newNode(text)); onListChanged(); }));
    });
    return wrap;
  }

  function wireDragRow(handle, row, list, index, onListChanged) {
    handle.style.touchAction = "none";
    let dragging = false, startY = 0, siblingRows = [], container = null;
    const onMove = (e) => {
      if (!dragging) return;
      const dy = e.clientY - startY;
      row.style.transform = `translateY(${dy}px)`;
      document.querySelectorAll(".t-row.drag-over,.t-row.drag-over-below").forEach((n) => n.classList.remove("drag-over", "drag-over-below"));
      for (const sib of siblingRows) {
        if (sib === row) continue;
        const rect = sib.getBoundingClientRect();
        if (e.clientY >= rect.top && e.clientY <= rect.bottom) {
          sib.classList.add(e.clientY - rect.top < rect.height / 2 ? "drag-over" : "drag-over-below");
          break;
        }
      }
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      row.style.transform = ""; row.classList.remove("dragging-active");
      const target = document.querySelector(".t-row.drag-over,.t-row.drag-over-below");
      let to = index;
      if (target) {
        const targetIndex = siblingRows.indexOf(target);
        const before = target.classList.contains("drag-over");
        to = targetIndex + (before ? 0 : 1);
        if (to > index) to--;
      }
      document.querySelectorAll(".t-row.drag-over,.t-row.drag-over-below").forEach((n) => n.classList.remove("drag-over", "drag-over-below"));
      if (to !== index) { const [moved] = list.splice(index, 1); list.splice(to, 0, moved); onListChanged(); }
      else onListChanged(false); // no reorder happened; nothing to re-render/persist
    };
    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault(); closeInsertBox();
      dragging = true; startY = e.clientY;
      container = row.parentElement;
      siblingRows = Array.from(container.children).filter((el) => el.classList.contains("t-row"));
      row.classList.add("dragging-active");
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
    });
  }

  function buildRow(node, list, index, depth, isRoot, onListChanged) {
    if (typeof ensureShape === "function") ensureShape(node, isRoot);
    const row = document.createElement("div"); row.className = "t-row" + (node.type === "choice" ? " is-choice" : "");

    const head = document.createElement("div"); head.className = "t-row-head";
    const handle = document.createElement("button"); handle.className = "t-drag"; handle.textContent = "⋮⋮"; handle.title = "drag to reorder";
    wireDragRow(handle, row, list, index, onListChanged);
    head.appendChild(handle);

    if (isRoot) {
      const star = btn("t-star" + (node.star ? " on" : ""), "tonight's minimum — reflection can stop here", icon(node.star ? "star" : "starOutline"), () => {
        const wasOn = node.star;
        (window.questions || []).forEach((q) => (q.star = false));
        node.star = !wasOn;
        onListChanged();
      });
      head.appendChild(star);
    }

    const input = document.createElement("input"); input.className = "t-text"; input.value = node.text || ""; input.placeholder = "write a question…";
    input.oninput = () => { node.text = input.value; onListChanged(false, true); };
    head.appendChild(input);

    head.appendChild(btn("t-recall" + (node.recall ? " on" : ""), "recall past answers to this question", icon("recall"), () => { node.recall = !node.recall; onListChanged(); }));

    if (node.type === "choice") {
      head.appendChild(textBtn("t-merge", "back to a single path — removes both branches", "merge", () => {
        const hasContent = (node.branches || []).some((br) => (br || []).length);
        if (hasContent && !confirm("Remove both paths and their follow-up questions?")) return;
        node.type = "text"; delete node.options; delete node.branches; delete node.terminal;
        onListChanged();
      }));
    } else {
      head.appendChild(textBtn("t-addpath", "split into two paths (yes / no)", "+path", () => {
        node.type = "choice"; node.options = [{ label: "yes", exit: 0 }, { label: "no", exit: 1 }]; node.branches = [[], []];
        onListChanged();
      }));
    }
    head.appendChild(btn("t-del", "remove this question", icon("del"), () => {
      list.splice(index, 1); onListChanged();
    }));
    row.appendChild(head);

    if (node.type === "choice") row.appendChild(buildOptions(node, onListChanged));
    return row;
  }

  function buildOptions(node, onListChanged) {
    const box = document.createElement("div"); box.className = "t-options";
    node.options.forEach((opt, oi) => {
      const exit = opt.exit === 1 ? 1 : 0;
      const branch = node.branches[exit] || (node.branches[exit] = []);
      const hasDestination = opt.terminal || branch.length > 0;

      const row = document.createElement("div"); row.className = "t-opt";
      const lbl = document.createElement("input"); lbl.className = "t-opt-label"; lbl.value = opt.label || ""; lbl.placeholder = "option";
      lbl.oninput = () => { opt.label = lbl.value; onListChanged(false, true); };
      row.appendChild(lbl);

      if (opt.terminal) {
        const badge = document.createElement("span"); badge.className = "t-terminal-badge"; badge.textContent = "ends the reflection";
        row.appendChild(badge);
        row.appendChild(btn("t-del", "undo — let this option continue instead", icon("del"), () => { delete opt.terminal; onListChanged(); }));
      } else {
        row.appendChild(btn("t-endhere", "end the reflection here instead of continuing", "done", () => { opt.terminal = true; onListChanged(); }));
      }
      if (node.options.length > 2) row.appendChild(btn("t-del", "remove option", icon("del"), () => { node.options.splice(oi, 1); onListChanged(); }));
      box.appendChild(row);

      if (!hasDestination) {
        // nothing here yet -- the ONE place a "+" adds this option's first
        // follow-up. Once it has content this whole affordance disappears;
        // further additions happen via the normal gaps inside t-branch below.
        const add = document.createElement("button"); add.className = "t-opt-addfirst";
        add.innerHTML = icon("plus") + "<span>add what happens next</span>";
        add.onclick = () => { branch.push(newNode("")); onListChanged(true, false, true); };
        box.appendChild(add);
      } else if (!opt.terminal) {
        box.appendChild(buildFlatList(branch, 1, false, onListChanged));
      }
    });
    if (node.options.length > 2) {
      const note = document.createElement("div"); note.className = "t-opt-note";
      note.textContent = "options past the first two share path B's follow-up";
      box.appendChild(note);
    }
    const addOpt = document.createElement("button"); addOpt.className = "t-opt-add-new"; addOpt.textContent = "+ another option";
    addOpt.onclick = () => {
      // this button only ever fires once there are already 2 options (a
      // fresh choice starts with exactly yes/no via t-addpath) — the schema
      // only has two real lanes, so every option past the first two shares
      // lane B with "no" rather than silently overwriting lane A's content.
      const exit = node.options.length < 2 ? node.options.length : 1;
      node.options.push({ label: "", exit });
      if (!node.branches[exit]) node.branches[exit] = [];
      onListChanged();
    };
    box.appendChild(addOpt);
    return box;
  }

  // ── boot: render the whole tree from `questions`, focusing a freshly
  // created row's text field when asked to. ─────────────────────────────
  window.renderTreeEditor = function (opts) {
    const host = document.getElementById("treeEditor");
    if (!host) return;
    closeInsertBox();
    const focusLast = opts && opts.focusNew;
    const scrollTop = host.scrollTop;
    host.innerHTML = "";
    if (typeof normalizeTree === "function") normalizeTree(window.questions);
    const list = buildFlatList(window.questions, 0, true, (persist, liveTyping, focusNewRow) => {
      if (persist !== false && typeof persistQuestions === "function") persistQuestions();
      window.renderTreeEditor({ focusNew: focusNewRow });
      if (typeof window._renderTreeGraph === "function") window._renderTreeGraph();
    });
    host.appendChild(list);
    host.scrollTop = scrollTop;
    if (focusLast) {
      const inputs = host.querySelectorAll(".t-text");
      const last = inputs[inputs.length - 1];
      if (last) { last.focus(); last.selectionStart = last.selectionEnd = last.value.length; }
    }
    if (typeof window._renderTreeGraph === "function") window._renderTreeGraph();
  };

  // ── paste / copy as text — the DSL from dsl.js, kept as an optional
  // interchange format rather than the primary way to edit. ───────────────
  window.copyTreeAsText = async function () {
    if (!window.RCDsl) return;
    const text = window.RCDsl.serializeDSL(window.questions || []);
    try { await navigator.clipboard.writeText(text); }
    catch (e) { /* clipboard permissions vary by browser; fall back silently */ }
    return text;
  };
  // `skipConfirm`: the "paste tree" modal in the UI already IS the explicit,
  // deliberate action of replacing the tree, so it passes true here to avoid
  // stacking a second native confirm() on top of a dialog the person just
  // opened on purpose.
  window.pasteTreeFromText = function (text, skipConfirm) {
    if (!window.RCDsl || !text) return;
    const { questions: parsed, warnings } = window.RCDsl.parseDSL(text);
    if (!parsed.length) return;
    if (!skipConfirm && window.questions && window.questions.length && !confirm("Replace your current questions with the pasted tree?")) return;
    window.questions = parsed;
    if (typeof persistQuestions === "function") persistQuestions();
    window.renderTreeEditor();
    return warnings;
  };
})();
