// meta-tree.js — Onboarding IS a wisdom tree for building wisdom trees.
//
// No LLM. The skill is encoded as the meta-tree's fixed questions (a universal
// procedure — same three steps for everyone, exactly like the intro video), and
// the user's answers are entirely personal. A deterministic compiler turns the
// nightly questions they name into their first real tree — one-size-fits-all
// procedure, personal output, and it can never drift into therapist mode
// because it is a tree, not a model.

// The meta-tree the user walks on first run. Linear on purpose: branches are the
// skill ceiling, not the floor. Answering the starred (last) question sends them
// to commit — their first behavior. Valid wisdom_tree DSL.
const META_TREE = [
  "what's one situation you want to go better than it's going?",
  "  what would going well look like a few weeks from now?",
  "",
  "what would going well look like a few weeks from now?",
  "  what's getting in the way right now?",
  "",
  "what's getting in the way right now?",
  "  what 3 or 4 behaviors would fix most of it?",
  "",
  "what 3 or 4 behaviors would fix most of it?",
  "  for each behavior, what could you ask yourself every night to stay on it?",
  "",
  "* for each behavior, what could you ask yourself every night to stay on it?",
  "  done",
].join("\n");

// Deterministic: the user's list of nightly questions -> valid starter DSL.
// Linear chain; the last question is starred (tonight's minimum) and ends in
// `done`. No model anywhere. Dedupes (duplicate titles are a parse error) and
// drops lines that would collide with DSL syntax, so the output always parses.
function compileQuestionsToTree(questions) {
  const seen = new Set();
  const qs = (questions || [])
    .map((s) => (s || "").trim())
    // strip leading tokens that would change a title's meaning in the grammar
    .map((s) => s.replace(/^[*#]\s*/, "").replace(/^recall\s+/i, "").trim())
    // a bare ">" would be read as a label>target option; keep titles clean
    .filter((s) => s && !s.includes(">"))
    .filter((s) => {
      const k = s.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

  if (!qs.length) return "";
  const lines = [];
  qs.forEach((q, i) => {
    const isLast = i === qs.length - 1;
    lines.push((isLast ? "* " : "") + q);
    lines.push(isLast ? "  done" : "  " + qs[i + 1]);
    lines.push("");
  });
  return lines.join("\n").trim() + "\n";
}

// The intro video's lab-student example, built THROUGH the same compiler — so it
// doubles as proof that the beginner method compiles to valid DSL with zero
// branches. Shown as a worked example beside the meta-tree, never handed over as
// the user's own tree.
const LAB_STUDENT_EXAMPLE = compileQuestionsToTree([
  "what did you finish before leaving today?",
  "did you deliberately learn something today?",
  "did you solve a problem yourself before asking your mentor?",
  "what responsibilities are you planning to assume next?",
]);

if (typeof module !== "undefined" && module.exports) {
  module.exports = { META_TREE, compileQuestionsToTree, LAB_STUDENT_EXAMPLE };
}
if (typeof window !== "undefined") {
  window.META_TREE = META_TREE;
  window.compileQuestionsToTree = compileQuestionsToTree;
  window.LAB_STUDENT_EXAMPLE = LAB_STUDENT_EXAMPLE;
}
