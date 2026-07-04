// ── tree-model.js ────────────────────────────────────────────────────────
// The raw DSL TEXT is the single source of truth (per syntax.txt): every
// question is a top-level (unindented) block, identified by its own exact
// title text. A block's body is at most one indent level deep, and each
// body line is either:
//   - a bare reference to another block's title (its plain follow-up, or —
//     with 2+ body lines — one tap-able option among several)
//   - `label > target` (labelled option shorthand)
//   - `recall <title>` (this question recalls that question's past answers)
//   - `done` / `label > done` (ends the reflection here)
// A block with an empty body is just unfinished — nothing to add yet.
// Two blocks sharing the same title is a "multi-head" error (ambiguous —
// which one does a reference to that title mean?).
"use strict";

function tokenizeRaw(text) {
  const rawLines = (text || "").split("\n");
  const items = [];
  rawLines.forEach((raw, i) => {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const m = raw.match(/^( *)/);
    const depth = Math.floor((m ? m[1].length : 0) / 2);
    items.push({ rawLine: i, depth, text: trimmed });
  });
  return { rawLines, items };
}

function isDoneText(s) { return /^(>>\s*)?done$/i.test((s || "").trim()); }
function splitArrow(raw) {
  const i = raw.indexOf(">");
  if (i === -1) return { before: null, after: null };
  return { before: raw.slice(0, i).trim() || null, after: raw.slice(i + 1).trim() };
}
function recallMatch(s) { return /^recall\s+(.+)$/i.exec((s || "").trim()); }
function norm(name) { return (name || "").trim().toLowerCase(); }

// ── parse: text -> flat block list ───────────────────────────────────────
function parse(text) {
  const { rawLines, items } = tokenizeRaw(text);
  const blocks = [];
  const byName = new Map();
  const dupNames = new Set();
  let i = 0;
  while (i < items.length) {
    const it = items[i];
    if (it.depth !== 0) { i++; continue; }
    let t0 = it.text;
    let star = false;
    const starM = t0.match(/^\*\s+(.*)$/);
    if (starM) { star = true; t0 = starM[1]; }
    let name = t0.trim();
    let terminalMark = false;
    if (name.endsWith("'")) { terminalMark = true; name = name.slice(0, -1).trim(); }
    const block = { name, rawLine: it.rawLine, star, type: "text", recallTarget: null, next: null, options: null, terminal: terminalMark, bodyEndRawLine: it.rawLine + 1 };

    let j = i + 1;
    const bodyItems = [];
    while (j < items.length && items[j].depth === 1) { bodyItems.push(items[j]); j++; }
    block.bodyEndRawLine = bodyItems.length ? bodyItems[bodyItems.length - 1].rawLine + 1 : it.rawLine + 1;

    const realBody = [];
    bodyItems.forEach((b) => {
      const rm = recallMatch(b.text);
      if (rm) { block.recallTarget = rm[1].trim(); return; }
      realBody.push(b);
    });

    if (realBody.length === 1) {
      const raw = realBody[0].text;
      if (isDoneText(raw)) block.terminal = true;
      else {
        const { after } = splitArrow(raw);
        const targetText = after != null ? after : raw;
        block.next = isDoneText(targetText) ? { isDone: true } : { target: targetText.trim(), rawLine: realBody[0].rawLine };
      }
    } else if (realBody.length >= 2) {
      block.type = "choice";
      block.options = realBody.map((b) => {
        const raw = b.text;
        if (isDoneText(raw)) return { label: "done", isDone: true, rawLine: b.rawLine };
        const { before, after } = splitArrow(raw);
        if (after != null) return { label: before || after, target: isDoneText(after) ? null : after.trim(), isDone: isDoneText(after), rawLine: b.rawLine };
        return { label: raw, target: raw.trim(), rawLine: b.rawLine };
      });
    }

    const key = norm(name);
    if (key) { if (byName.has(key)) dupNames.add(key); else byName.set(key, block); }
    blocks.push(block);
    i = j;
  }
  return { blocks, byName, dupNames, rawLines, lineCount: rawLines.length };
}

function resolveName(parsed, name) { return name ? parsed.byName.get(norm(name)) : null; }

// ── graph: DFS column (depth from a root) + tidy-tree row (Reingold–Tilford
// style centering), same core idea as the app's previous node-graph.js —
// now keyed by block NAME instead of an internal id, since name is the only
// stable identity a reference line can carry. ──────────────────────────
function buildGraph(parsed) {
  const { blocks } = parsed;
  const outgoing = new Map();
  const referenced = new Set();
  blocks.forEach((b) => {
    const out = [];
    if (b.type === "text") {
      if (b.next && !b.next.isDone) {
        const t = resolveName(parsed, b.next.target);
        if (t) { out.push({ to: t.name, label: null }); referenced.add(norm(t.name)); }
      }
    } else {
      (b.options || []).forEach((opt) => {
        if (opt.isDone || !opt.target) return;
        const t = resolveName(parsed, opt.target);
        if (t) { out.push({ to: t.name, label: opt.label }); referenced.add(norm(t.name)); }
      });
    }
    outgoing.set(b.name, out);
  });

  const roots = blocks.filter((b) => !referenced.has(norm(b.name)));
  const col = new Map();
  function visitCol(name, c, path) {
    if (path.has(name)) return;
    if (col.has(name) && col.get(name) >= c) return;
    col.set(name, c);
    const next = new Set(path); next.add(name);
    (outgoing.get(name) || []).forEach((e) => visitCol(e.to, c + 1, next));
  }
  roots.forEach((b) => visitCol(b.name, 0, new Set()));
  blocks.forEach((b) => { if (!col.has(b.name)) col.set(b.name, 0); });

  const row = new Map();
  let nextLeaf = 0;
  const visiting = new Set();
  function assignRow(name) {
    if (row.has(name)) return row.get(name);
    if (visiting.has(name)) return nextLeaf;
    visiting.add(name);
    const kids = (outgoing.get(name) || []).map((e) => e.to).filter((k) => parsed.byName.get(norm(k)));
    const kidRows = kids.map((k) => assignRow(k));
    const r = kidRows.length ? (Math.min(...kidRows) + Math.max(...kidRows)) / 2 : nextLeaf++;
    row.set(name, r);
    visiting.delete(name);
    return r;
  }
  roots.forEach((b) => assignRow(b.name));
  blocks.forEach((b) => { if (!row.has(b.name)) row.set(b.name, nextLeaf++); });

  const edges = [];
  blocks.forEach((b) => (outgoing.get(b.name) || []).forEach((e) => edges.push({ from: b.name, to: e.to, label: e.label })));
  const recallEdges = [];
  blocks.forEach((b) => { if (b.recallTarget) { const t = resolveName(parsed, b.recallTarget); if (t) recallEdges.push({ from: b.name, to: t.name }); } });
  const terminals = [];
  blocks.forEach((b) => {
    if (b.type === "text" && (b.terminal || (b.next && b.next.isDone))) terminals.push({ id: "__done__" + b.name, from: b.name, label: null, col: (col.get(b.name) || 0) + 1, row: row.get(b.name) });
    if (b.type === "choice") (b.options || []).forEach((opt, oi) => { if (opt.isDone) terminals.push({ id: "__done__" + b.name + "_" + oi, from: b.name, label: opt.label, col: (col.get(b.name) || 0) + 1, row: row.get(b.name) + oi * 0.4 }); });
  });

  return { col, row, edges, recallEdges, terminals, roots };
}

// ── text mutation helpers — all operate on the raw string, all return a
// NEW string (never mutate in place). Line numbers are looked up fresh via
// parse() each time so callers never have to keep their own bookkeeping. ──
function linesOf(text) { return (text || "").split("\n"); }
function joinLines(lines) { return lines.join("\n"); }

function trimTrailingBlank(lines) {
  while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
  return lines;
}

function charOffsetOfLine(text, rawLine) {
  const lines = linesOf(text);
  let off = 0;
  for (let i = 0; i < rawLine && i < lines.length; i++) off += lines[i].length + 1;
  return off;
}

function appendNewBlock(text, name) {
  const lines = trimTrailingBlank(linesOf(text));
  if (lines.length) lines.push("");
  lines.push(name);
  const newText = joinLines(lines) + "\n";
  const rawLine = lines.length - 1;
  const start = charOffsetOfLine(newText, rawLine);
  return { text: newText, rawLine, selStart: start, selEnd: start + name.length };
}

// insert a bare reference (or brand-new block + reference) as fromName's
// next body line. If fromName already has exactly one real body line, the
// new line becomes a second option (auto-promoting it to a choice — no
// relabeling needed, 2+ body lines just *are* a choice per the grammar).
function insertBodyLine(text, fromName, lineText) {
  const parsed = parse(text);
  const block = resolveName(parsed, fromName);
  const lines = linesOf(text);
  if (!block) return text;
  const insertAt = block.bodyEndRawLine;
  lines.splice(insertAt, 0, "  " + lineText);
  return joinLines(lines);
}

function addConnectedChild(text, fromName, newName) {
  const t1 = insertBodyLine(text, fromName, newName);
  const appended = appendNewBlock(t1, newName);
  return appended;
}

function connectExisting(text, fromName, targetName) {
  const parsed = parse(text);
  const block = resolveName(parsed, fromName);
  if (!block || norm(fromName) === norm(targetName)) return text;
  // already there?
  const already =
    (block.next && norm(block.next.target) === norm(targetName)) ||
    (block.options || []).some((o) => norm(o.target) === norm(targetName));
  if (already) return text;
  return insertBodyLine(text, fromName, targetName);
}

// remove a block entirely (header + body), and clean up any reference /
// recall lines elsewhere in the document that pointed at it.
function deleteBlock(text, name) {
  const parsed = parse(text);
  const block = resolveName(parsed, name);
  if (!block) return text;
  let lines = linesOf(text);
  lines.splice(block.rawLine, block.bodyEndRawLine - block.rawLine);
  // re-parse after the cut and strip now-dangling references to `name`
  const key = norm(name);
  const parsed2 = parse(joinLines(lines));
  const toDrop = new Set();
  parsed2.blocks.forEach((b) => {
    if (b.recallTarget && norm(b.recallTarget) === key) toDrop.add(b.recallTarget && findRecallLine(b));
  });
  // simplest robust approach: re-render body lines for every block, dropping
  // any body/recall line whose target matches the removed name, then splice
  // those lines out (by rawLine, descending so indices stay valid).
  const linesArr = linesOf(joinLines(lines));
  const doomed = [];
  parsed2.blocks.forEach((b) => {
    if (b.recallTarget && norm(b.recallTarget) === key) {
      for (let r = b.rawLine + 1; r < b.bodyEndRawLine; r++) {
        if (recallMatch((linesArr[r] || "").trim())) doomed.push(r);
      }
    }
    if (b.type === "text" && b.next && !b.next.isDone && norm(b.next.target) === key) doomed.push(b.next.rawLine);
    if (b.type === "choice") (b.options || []).forEach((o) => { if (!o.isDone && o.target && norm(o.target) === key) doomed.push(o.rawLine); });
  });
  doomed.sort((a, c) => c - a).forEach((r) => linesArr.splice(r, 1));
  return joinLines(linesArr);
}
function findRecallLine() { return null; }

function setStar(text, name) {
  const parsed = parse(text);
  const lines = linesOf(text);
  const key = norm(name);
  parsed.blocks.forEach((b) => {
    const isTarget = norm(b.name) === key;
    const cur = lines[b.rawLine];
    const stripped = cur.replace(/^(\s*)\*\s+/, "$1");
    if (isTarget) {
      const turningOn = !b.star;
      lines[b.rawLine] = turningOn ? stripped.replace(/^(\s*)/, "$1* ") : stripped;
    } else if (b.star) {
      lines[b.rawLine] = stripped;
    }
  });
  return joinLines(lines);
}

function setRecall(text, name, targetNameOrNull) {
  const parsed = parse(text);
  const block = resolveName(parsed, name);
  if (!block) return text;
  const lines = linesOf(text);
  // find existing recall line within this block's body
  let recallRaw = -1;
  for (let r = block.rawLine + 1; r < block.bodyEndRawLine; r++) {
    if (recallMatch((lines[r] || "").trim())) { recallRaw = r; break; }
  }
  if (targetNameOrNull == null) {
    if (recallRaw >= 0) lines.splice(recallRaw, 1);
    return joinLines(lines);
  }
  const newLine = "  recall " + targetNameOrNull;
  if (recallRaw >= 0) lines[recallRaw] = newLine;
  else lines.splice(block.rawLine + 1, 0, newLine);
  return joinLines(lines);
}

// reorder: cut a whole block's lines out and reinsert immediately before
// `beforeName` (or at the end if beforeName is null) — pure organization,
// no semantic change to any reference.
function reorderBlock(text, name, beforeName) {
  const parsed = parse(text);
  const block = resolveName(parsed, name);
  if (!block) return text;
  const lines = linesOf(text);
  const chunk = lines.slice(block.rawLine, block.bodyEndRawLine);
  lines.splice(block.rawLine, block.bodyEndRawLine - block.rawLine);
  if (norm(name) === norm(beforeName)) return joinLines(lines);
  const parsed2 = parse(joinLines(lines));
  const target = beforeName ? resolveName(parsed2, beforeName) : null;
  let insertAt = target ? target.rawLine : lines.length;
  // keep a blank separator line between blocks
  const before = lines.slice(0, insertAt);
  const after = lines.slice(insertAt);
  trimTrailingBlank(before);
  const needsBlankBefore = before.length > 0;
  const needsBlankAfter = after.length > 0 && after[0].trim() !== "";
  const merged = before.concat(needsBlankBefore ? [""] : [], chunk, needsBlankAfter ? [""] : [], after);
  return joinLines(merged);
}

// pull the referenced title out of a body line, if it even IS shaped like a
// reference (recall X / label > X / bare X) — returns null for "done" and
// other non-reference lines, so a caller can tell "not a link" from "a link
// to something that doesn't exist." Same per-line target logic parse() uses
// for a block's own next/options, exposed so other code (the reference-edit
// cascade below) doesn't have to re-derive it.
function referenceTargetOf(lineTrimmed) {
  const rm = recallMatch(lineTrimmed);
  if (rm) return rm[1].trim();
  const { after } = splitArrow(lineTrimmed);
  if (after != null) return isDoneText(after) ? null : after.trim();
  if (isDoneText(lineTrimmed)) return null;
  return lineTrimmed.trim() || null;
}

// rewrite every bare/label/recall reference to `oldName` (except the lines
// at `skipRawLines` — the header when cascading FROM a title edit, or the
// reference line itself when cascading FROM a reference edit) to `newName`.
// Keeps every other mention alive when you edit either the declaration or
// any one reference — "the text IS the identity" otherwise risks silently
// orphaning everything else that pointed at the old name.
function renameReferences(text, oldName, newName, skipRawLines) {
  const skip = new Set(Array.isArray(skipRawLines) ? skipRawLines : [skipRawLines]);
  const lines = linesOf(text);
  const oldKey = norm(oldName);
  if (!oldKey) return text;
  for (let i = 0; i < lines.length; i++) {
    if (skip.has(i)) continue;
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const indentM = raw.match(/^( *)/);
    const depth = Math.floor(indentM[1].length / 2);
    if (depth === 0) continue;
    const rm = recallMatch(trimmed);
    if (rm) { if (norm(rm[1].trim()) === oldKey) lines[i] = raw.slice(0, indentM[1].length) + "recall " + newName; continue; }
    const { before, after } = splitArrow(trimmed);
    if (after != null) { if (norm(after) === oldKey) lines[i] = raw.slice(0, indentM[1].length) + (before ? before + " > " : "> ") + newName; continue; }
    if (norm(trimmed) === oldKey) lines[i] = raw.slice(0, indentM[1].length) + newName;
  }
  return joinLines(lines);
}

// renaming a block's title directly (e.g. clicking a canvas card's text and
// typing) needs the same reference-cascade as editing the header line in the
// textarea — this is that same operation, callable from anywhere a caller
// already knows which block it means to rename rather than having to infer
// it from a cursor position (see app.js's _cascadeRenameIfHeaderEdited,
// which is the textarea-specific wrapper around the same renameReferences).
function renameBlockTitle(text, oldName, newName, extraSkipRawLine) {
  const parsed = parse(text);
  const block = resolveName(parsed, oldName);
  newName = (newName || "").trim();
  if (!block || !newName || norm(oldName) === norm(newName)) return text;
  const lines = linesOf(text);
  // re-derive the header's own star/terminal-mark from its raw text (not
  // block.terminal, which is also true for a plain "done" body line and
  // would wrongly append a trailing ' here if trusted directly)
  let t0 = (lines[block.rawLine] || "").trim();
  const starM = t0.match(/^\*\s+(.*)$/);
  if (starM) t0 = starM[1];
  const hadApostrophe = t0.endsWith("'");
  lines[block.rawLine] = (block.star ? "* " : "") + newName + (hadApostrophe ? "'" : "");
  const skips = extraSkipRawLine != null ? [block.rawLine, extraSkipRawLine] : block.rawLine;
  return renameReferences(joinLines(lines), oldName, newName, skips);
}

function findDuplicateTitles(parsed) {
  const groups = new Map();
  parsed.blocks.forEach((b) => {
    const key = norm(b.name);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(b);
  });
  const out = [];
  groups.forEach((list, key) => { if (list.length > 1) out.push({ name: list[0].name, count: list.length }); });
  return out;
}

// "trees starting from multiple heads are a no go" — a well-formed tree has
// exactly one entry point. More than one root (a block nobody points to)
// means two or more disconnected chains.
function findMultipleRoots(parsed, graph) {
  if (!graph.roots || graph.roots.length <= 1) return [];
  return graph.roots.map((b) => b.name);
}

function uniqueName(parsed, base) {
  const existing = new Set((parsed.blocks || []).map((b) => norm(b.name)));
  let n = 1;
  while (existing.has(norm(base + " " + n))) n++;
  return base + " " + n;
}

// ── drag-and-drop within the text editor: grab a question wherever it
// appears (its declaration, or a bare reference to it) and drop it either
// at the top level (its declaration relocates there — "text organization")
// or inside another question's body (a reference to it appears there,
// unless one's already there — non-destructive). Works the same starting
// from either kind of line, in either direction. ─────────────────────────
function sourceInfoAt(text, rawLine) {
  const parsed = parse(text);
  for (const b of parsed.blocks) { if (rawLine === b.rawLine) return { kind: "header", name: b.name }; }
  const lines = linesOf(text);
  const raw = (lines[rawLine] || "").trim();
  if (!raw || raw.startsWith("#")) return null;
  const rm = recallMatch(raw);
  if (rm) return { kind: "recall", name: rm[1].trim() };
  const { after } = splitArrow(raw);
  const targetText = after != null ? after : raw;
  if (isDoneText(targetText)) return null;
  return { kind: "reference", name: targetText.trim() };
}

function dropContext(text, rawLine) {
  const parsed = parse(text);
  for (const b of parsed.blocks) { if (rawLine === b.rawLine) return { mode: "declaration", beforeName: b.name }; }
  for (const b of parsed.blocks) { if (rawLine > b.rawLine && rawLine < b.bodyEndRawLine) return { mode: "reference", enclosingName: b.name }; }
  // an empty-bodied leaf has no "inside" row yet — dropping on the row
  // immediately below its header still means "make this its first step"
  for (const b of parsed.blocks) { if (b.bodyEndRawLine === b.rawLine + 1 && rawLine === b.rawLine + 1) return { mode: "reference", enclosingName: b.name }; }
  const next = parsed.blocks.find((b) => b.rawLine >= rawLine);
  return { mode: "declaration", beforeName: next ? next.name : null };
}

function blockHasBody(block) {
  return !!(block && (block.next || block.terminal || (block.options && block.options.length) || block.recallTarget));
}

function moveLine(text, fromRawLine, toRawLine) {
  const src = sourceInfoAt(text, fromRawLine);
  if (!src) return text;
  const ctx = dropContext(text, toRawLine);

  if (src.kind === "header") {
    if (ctx.mode === "reference") {
      const block = resolveName(parse(text), src.name);
      if (blockHasBody(block)) return text; // refuse to demote a real declaration and lose its body
      const stripped = deleteBlock(text, src.name);
      return connectExisting(stripped, ctx.enclosingName, src.name);
    }
    return reorderBlock(text, src.name, ctx.beforeName);
  }

  // dragging a bare reference / recall line — remove just that one line, then apply the destination
  const lines = linesOf(text);
  lines.splice(fromRawLine, 1);
  let working = joinLines(lines);
  if (ctx.mode === "declaration") {
    const existing = resolveName(parse(working), src.name);
    if (existing) return reorderBlock(working, src.name, ctx.beforeName);
    const res = appendNewBlock(working, src.name);
    return reorderBlock(res.text, src.name, ctx.beforeName);
  }
  if (norm(ctx.enclosingName) === norm(src.name)) return text; // can't reference itself
  return connectExisting(working, ctx.enclosingName, src.name);
}

const TreeModel = {
  parse, resolveName, buildGraph,
  appendNewBlock, addConnectedChild, connectExisting, deleteBlock,
  setStar, setRecall, reorderBlock, insertBodyLine, renameReferences, renameBlockTitle, referenceTargetOf,
  findDuplicateTitles, findMultipleRoots, uniqueName,
  sourceInfoAt, dropContext, moveLine,
  isDoneText, norm,
};

if (typeof module !== "undefined" && module.exports) module.exports = TreeModel;
if (typeof window !== "undefined") window.TreeModel = TreeModel;
