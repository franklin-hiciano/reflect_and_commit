// ── DSL: plain-text tree <-> question schema ────────────────────────────────
//
// This is the thing that got scrapped in the product pivot and is now being
// brought back, rewritten clean and compiled straight into the SAME schema
// app.js already runs on (id/text/type/options/branches/star/recall). None
// of the reflect/commit/notification/sync code changes — only how a tree
// gets AUTHORED changes, from clicking to typing.
//
// ── the grammar, in full ─────────────────────────────────────────────────
//   # a comment — ignored entirely, same as blank lines (both are purely
//     for your own visual spacing/notes, never structural)
//
//   A question is a line. Indentation is 2 spaces per level and is the ONLY
//   thing that encodes structure — there is no required routing syntax.
//
//   Top-level (unindented) lines are the spine: they run in the order
//   written, straight down, no indentation needed between them. This is
//   deliberate — the common case (one question after another) should need
//   zero syntax, so a plain list of questions IS a working tree.
//
//   Indent lines under a question to add branching:
//     - exactly ONE indented line  -> a follow-up: after this question,
//       that line is asked next (still just one path, purely a way to show
//       the two questions are related; writing it as the next unindented
//       line instead is 100% equivalent).
//     - TWO OR MORE indented lines -> those become tap-able options for this
//       question (multiple choice). Each option can:
//         a) stand alone (no further indentation)      -> choosing it just
//            continues to whatever's next after this question
//         b) have ONE line indented under it            -> that's the
//            follow-up asked after choosing this option
//         c) have TWO+ lines indented under it           -> that option is
//            itself a further branch point (nested choice)
//         d) use "label >> next question text" on one line as shorthand for
//            (b) — purely a compaction, not a different mechanism. You never
//            NEED the arrow; it just saves a line for short trees.
//
//   `recall` on its own line, indented directly under a question, makes that
//   question recall its own past answers when you're asked it again. (Not
//   `@[...]` — that syntax was documented once but never actually built; this
//   is the real, working version: self-recall only, no cross-node targets,
//   matching exactly what the current app can do.)
//
//   `*` at the start of a TOP-LEVEL question marks the nightly minimum — the
//   reflection can stop there and offer to commit. Only one node can be
//   starred; if more than one line uses `*`, the last one wins.
//
//   `done` (bare, or as `>> done`) as the only thing under a question or
//   option marks that path as a hard stop — go straight to commit, never
//   fall through to whatever comes next. You don't have to write this: a
//   path with nothing left just ends the same way. It exists purely so you
//   can SAY "this is supposed to end here" and have the graph view confirm
//   it, rather than re-deriving the fall-through rule in your head.
//
// ── one real constraint worth knowing ────────────────────────────────────
//   A branch's content is one straight chain of questions, optionally ending
//   in one more level of choice. If that inner choice's own options are left
//   empty, they rejoin the OUTER spine (not more content inside the same
//   branch) — this matches how the app has always walked the tree
//   (question -> next sibling in its own list; a branch that runs out just
//   climbs back to whatever follows the choice it came from). For the
//   reflection trees this app is for for (one branch, maybe one follow-up)
//   this is never a real limit in practice.
"use strict";

(function (global) {
  const DSL_INDENT = 2;

  function dslLevel(rawLine) {
    const m = rawLine.match(/^( *)/);
    return Math.floor((m ? m[1].length : 0) / DSL_INDENT);
  }

  function isRecallLine(s) {
    return /^recall(\s+_)?$/i.test((s || "").trim());
  }
  function isDoneText(s) {
    return /^done$/i.test((s || "").trim());
  }
  // first `>>` splits a line into an optional label and the text after it.
  // `before` is null when the arrow is the very first thing on the line
  // (no label given, e.g. a bare continuation written the old explicit way).
  function splitArrow(raw) {
    const i = raw.indexOf(">>");
    if (i === -1) return { before: null, after: null };
    const before = raw.slice(0, i).trim();
    const after = raw.slice(i + 2).trim();
    return { before: before || null, after };
  }

  let _idSeed = 0;
  function newId() {
    _idSeed++;
    return "q_" + Date.now().toString(36) + "_" + _idSeed.toString(36) + "_" + Math.random().toString(36).slice(2, 6);
  }

  function tokenize(src) {
    const rawLines = (src || "").split("\n");
    const items = []; // { text, level, lineNo }
    rawLines.forEach((raw, i) => {
      const tr = raw.trim();
      if (!tr || tr.startsWith("#")) return;
      items.push({ text: tr, level: dslLevel(raw), lineNo: i });
    });
    const childList = items.map(() => []);
    const stack = [];
    for (let i = 0; i < items.length; i++) {
      const lv = items[i].level;
      while (stack.length && items[stack[stack.length - 1]].level >= lv) stack.pop();
      if (stack.length) childList[stack[stack.length - 1]].push(i);
      stack.push(i);
    }
    return { items, childList };
  }

  // Builds exactly one node (plus, if it's the start of a continuation
  // chain, every node that chain folds in after it) for the "slot" defined
  // by `idx`'s own children. `textOverride` supplies the node's text when it
  // came from an arrow shorthand on the line that POINTS at idx, rather than
  // idx's own line text (idx's *children* still come from idx regardless).
  function buildNodeFrom(idx, textOverride, ctx, warnings) {
    const item = ctx.items[idx];
    let text = textOverride != null ? textOverride : item.text;
    let star = false;
    if (textOverride == null && item.level === 0) {
      const m = text.match(/^\*\s+(.*)$/);
      if (m) { star = true; text = m[1]; }
    }
    const kids = ctx.childList[idx] || [];
    let recall = false;
    const realKidIdxs = [];
    kids.forEach((ci) => {
      if (isRecallLine(ctx.items[ci].text)) recall = true;
      else realKidIdxs.push(ci);
    });
    const node = { id: newId(), text: text.trim(), type: "text", recall };
    if (star) node.star = true;

    if (realKidIdxs.length === 0) {
      return [node];
    }

    if (realKidIdxs.length === 1) {
      const ci = realKidIdxs[0];
      const raw = ctx.items[ci].text;
      if (isDoneText(raw)) { node.terminal = true; return [node]; }
      const { after } = splitArrow(raw);
      if (after != null && isDoneText(after)) { node.terminal = true; return [node]; }
      const rest = buildNodeFrom(ci, after, ctx, warnings);
      return [node, ...rest];
    }

    // 2+ real children => this question becomes multiple choice.
    node.type = "choice";
    node.options = [];
    node.branches = [[], []];
    realKidIdxs.forEach((ci, k) => {
      const exit = k === 0 ? 0 : 1; // schema supports two lanes (A/B); every
      // option beyond the first two shares lane B, same as the click editor
      // already allowed ("any number of options, each pointing at A or B").
      const raw = ctx.items[ci].text;
      if (isDoneText(raw)) { node.options.push({ label: raw, exit, terminal: true }); return; }
      const { before, after } = splitArrow(raw);
      const label = before != null ? before : raw;

      if (after != null) {
        if (isDoneText(after)) { node.options.push({ label, exit, terminal: true }); return; }
        const sub = buildNodeFrom(ci, after, ctx, warnings);
        node.branches[exit].push(...sub);
        node.options.push({ label, exit });
        return;
      }

      const ownKids = (ctx.childList[ci] || []).filter((gc) => !isRecallLine(ctx.items[gc].text));
      if (!ownKids.length) {
        node.options.push({ label, exit }); // bare label, nothing nested -> falls through when chosen
        return;
      }
      if (ownKids.length === 1) {
        const only = ownKids[0];
        const ot = ctx.items[only].text;
        if (isDoneText(ot)) { node.options.push({ label, exit, terminal: true }); return; }
        const { after: oa } = splitArrow(ot);
        const sub = buildNodeFrom(only, oa, ctx, warnings);
        node.branches[exit].push(...sub);
        node.options.push({ label, exit });
        return;
      }
      // 2+ grandchildren under a bare label: no separate title line was
      // given for this nested branch point, so the label text doubles as
      // that question's title too (write your own title line if you don't
      // want that — see README).
      const sub = buildNodeFrom(ci, null, ctx, warnings);
      node.branches[exit].push(...sub);
      node.options.push({ label, exit });
    });
    if (realKidIdxs.length > 2 && !warnings._warnedMultiOption) {
      warnings._warnedMultiOption = true;
      warnings.push("a question has more than 2 options — every option past the first two shares the second branch (B)");
    }
    return [node];
  }

  function parseDSL(src) {
    const { items, childList } = tokenize(src);
    const ctx = { items, childList };
    const warnings = [];
    const questions = [];
    items.forEach((it, idx) => {
      if (it.level !== 0) return;
      questions.push(...buildNodeFrom(idx, null, ctx, warnings));
    });
    // exactly one star, ever — last one marked wins, matching the old
    // click-editor's own enforcement (toggling star unstarred every other node)
    let starIdx = -1;
    questions.forEach((q, i) => { if (q.star) starIdx = i; });
    questions.forEach((q, i) => { q.star = i === starIdx; });
    return { questions, warnings };
  }

  // ── serializer: questions -> text ──────────────────────────────────────
  // Root-level entries are written flat (no indentation needed to chain —
  // matches the parser's own root rule). Anything nested (branch content)
  // chains via progressive indentation, since inside a branch two same-level
  // lines would be read as 2+ options, not "then, then."
  function serializeDSL(questions) {
    const lines = [];
    function ind(n) { return "  ".repeat(Math.max(0, n)); }

    function emitOne(node, level) {
      const starMark = level === 0 && node.star ? "* " : "";
      lines.push(ind(level) + starMark + (node.text || "").replace(/\n/g, " ").trim());
      if (node.recall) lines.push(ind(level + 1) + "recall");
      if (node.type === "choice") {
        (node.options || []).forEach((opt) => {
          const exit = opt.exit === 1 ? 1 : 0;
          const branch = (node.branches && node.branches[exit]) || [];
          lines.push(ind(level + 1) + (opt.label || ""));
          if (opt.terminal) {
            lines.push(ind(level + 2) + ">> done");
          } else {
            emitChain(branch, level + 2);
          }
        });
      } else if (node.terminal) {
        lines.push(ind(level + 1) + ">> done");
      }
    }

    // a "chain" is a flat array meant to be walked in order. At the root,
    // each entry is its own unindented block (blank-line separated). Inside
    // a branch, entries after the first progressively deepen so they parse
    // back as continuations rather than sibling options.
    function emitChain(list, level) {
      (list || []).forEach((node, i) => emitOne(node, level + i));
    }

    (questions || []).forEach((node, i) => {
      emitOne(node, 0);
      if (i < questions.length - 1) lines.push("");
    });
    return lines.join("\n") + (lines.length ? "\n" : "");
  }

  // ── graph model: derive a node/edge list purely from `questions`, for the
  // read-only visualization. No independent state — same principle the old
  // node-graph.js used ("it never has its own model"), just cleaner, and
  // laid out by an actual topological pass rather than raw indentation:
  // `row` means "step number in the walk," so two branches that fork always
  // reconverge visually BELOW whichever one had more follow-up questions,
  // instead of overlapping. That's the one property that actually matters
  // for reading a branch at a glance — see where it lands, not how deep the
  // text was indented.
  function buildGraphModel(questions) {
    const nodes = [];
    const edges = [];
    let seq = 0;
    let commitUsed = false;

    function nodeRef(n, row) {
      const ref = { id: n.id, text: n.text, type: n.type, recall: !!n.recall, star: !!n.star, terminal: !!n.terminal, row, seq: seq++ };
      nodes.push(ref);
      return ref;
    }

    // Lays out one flat list (root spine, or any branch's own content)
    // starting at `row` ("row" = step number in the walk, not text indent).
    // Returns { firstId, endRow, pending }: `pending` is any empty-branch
    // rejoin inside this list that couldn't be pointed anywhere yet because
    // the list ended before we learned what comes next — the caller (root
    // call, or an enclosing layout()) wires those once it knows.
    function layout(list, row) {
      let prevId = null, firstId = null;
      let pending = [];
      let endRow = row;
      for (let i = 0; i < list.length; i++) {
        const n = list[i];
        const ref = nodeRef(n, endRow);
        if (firstId == null) firstId = ref.id;
        if (prevId) edges.push({ from: prevId, to: ref.id, label: null, dashed: false });
        pending.forEach((p) => edges.push({ from: p.fromId, to: ref.id, label: p.label, dashed: true }));
        pending = [];
        prevId = ref.id;
        endRow += 1;

        if (n.type === "choice") {
          const forkRow = endRow;
          const branchEnds = [];
          (n.options || []).forEach((opt) => {
            const exit = opt.exit === 1 ? 1 : 0;
            const branch = (n.branches && n.branches[exit]) || [];
            if (opt.terminal) {
              const term = { id: ref.id + "_term_" + exit, text: "done", type: "terminal", row: forkRow, seq: seq++ };
              nodes.push(term);
              edges.push({ from: ref.id, to: term.id, label: opt.label, dashed: false });
              branchEnds.push(forkRow + 1);
            } else if (branch.length) {
              const sub = layout(branch, forkRow);
              edges.push({ from: ref.id, to: sub.firstId, label: opt.label, dashed: false });
              sub.pending.forEach((p) => pending.push(p));
              branchEnds.push(sub.endRow);
            } else {
              pending.push({ fromId: ref.id, label: opt.label });
              branchEnds.push(forkRow);
            }
          });
          endRow = Math.max(endRow, ...branchEnds);
        } else if (i === list.length - 1 && !n.terminal) {
          // the list ran out with nothing more to ask: whoever called us
          // needs to know this path falls through to whatever comes next
          // (a plain question with no forced stop always does). A choice
          // node handles this itself via its branches' own pending list, so
          // this only applies to an ordinary trailing question.
          pending.push({ fromId: ref.id, label: null });
        }
      }
      return { firstId, endRow, pending };
    }

    if (questions && questions.length) {
      const result = layout(questions, 0);
      const commit = { id: "__commit__", text: "commit", type: "terminal", row: result.endRow, seq: seq++ };
      nodes.push(commit);
      result.pending.forEach((p) => edges.push({ from: p.fromId, to: commit.id, label: p.label, dashed: true }));
    }
    return { nodes, edges };
  }

  global.RCDsl = { parseDSL, serializeDSL, buildGraphModel, isRecallLine, isDoneText };
  if (typeof module !== "undefined" && module.exports) module.exports = global.RCDsl;
})(typeof window !== "undefined" ? window : globalThis);
