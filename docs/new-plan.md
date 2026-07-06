# wisdom_tree — New Plan: lower the friction, keep the wisdom

## The corrected north star
The product is not "guided journaling." It's a tool for building and refining
your own **atlas of failure paths** — mapping your states and the ways you fail,
so future-you sees the branch coming. Walking the tree at night is secondary;
*growing the tree* is the value-generating act. (Franklin's own evidence:
improving his agency tree produced more daily value than improving the app.)

## The one design test (apply to every feature)
> Does this lower the cost of **writing down** my map, or the cost of
> **thinking** my map?

Ship the first. Refuse the second. **Automate the transcription, never the
introspection.** The friction worth deleting is syntax, blank pages, and typing.
The friction worth *keeping* — and celebrating — is naming your own states and
paths to failure.

## No LLM in v1 (decided)
An LLM helper is either a fixed procedure — in which case it *is* a meta-tree,
and we should just build the meta-tree — or it has real mapping judgment, which
is hard, one bad prompt from therapist mode, and a skill-crutch (if it catches
your weak question, you never learn to). So: **encode the skill as a tree, not a
model.** A tree has the skill by construction and can never drift. The LLM only
comes back much later, if ever, as an optional sparring partner that critiques a
tree you *already made* — never one that makes it.

## Where this leaves the old plan
Shelve `hermes_laptop/` (the relay) and the Tauri/Playwright do-anything agent —
wrong altitude, a bot acting in the world above the user. Nothing in this plan
needs the relay, Tauri, Playwright, Modal, or any model.

> Security: `modal_deployment/app.py` hardcodes an API key (`freellmapi-…`) and a
> base-URL IP. Rotate + move to a secret before this repo goes anywhere public.

## The metric (deltas, not usage)
You already measure the right thing. `dueCommitment()` + `resolveCheckin()`
track commitment-made → commitment-kept — that resolution *is* the delta.
Surface one number: **commitments kept.** Add a second matching the north star:
**branches you've added to your own map.** Never a streak; keep ignoring DAU.

---

## Phase A — Onboarding IS a meta-tree (delivered + verified)
Onboarding is a **wisdom tree for building wisdom trees**. It walks the intro
video's three steps on the user's *own* problem — situation → 3-4 behaviors →
a nightly question per behavior — and they come out the other side having built,
not watched. Self-demonstrating (first experience of the tool is walking a
tree), skill-by-construction (it's the procedure, encoded), and drift-proof
(it's a tree, not a model). A video stays as *optional* depth: "want to watch me
do it first? 3 min" — offered, never gating.

Delivered in `app/js/meta-tree.js`:
- `META_TREE` — the onboarding tree (linear on purpose; branches are the skill
  ceiling, not the floor). Verified: one root, one `* ` star, ends in `done`.
- `compileQuestionsToTree(questions)` — **deterministic, no model.** Turns the
  nightly questions the user names into their first real tree (linear chain,
  last question starred = tonight's minimum, ends in `done`). Dedupes and strips
  syntax-colliding tokens so the output always parses. This is the piece that
  makes the meta-tree produce a *personal* tree with zero LLM.
- `LAB_STUDENT_EXAMPLE` — the video's example, built *through* the same compiler,
  so it doubles as proof the beginner method compiles to valid DSL with zero
  branches.

Wiring left for Cursor: the 3-step walk UI (reuse the existing composer/voice),
then `setDslText(compileQuestionsToTree(theirAnswers))` and drop them into their
new tree. Ship gate: `verify-meta.js` (all pass).

## Phase B — Prebuilt trees: worked examples up front, adoption only at the exit
A prebuilt tree adopted *as yours* is one-size-fits-all content and kills the
investment — so ration it hard. Two distinct roles:
- **Worked example (free):** show a finished tree *beside* the meta-tree walk —
  the lab-student one — so the user sees the shape without outsourcing the
  thinking. Look-at-one is teaching.
- **Adopt-one (last resort):** only for the user who genuinely can't and is about
  to leave forever — "fine, here's one." Adopt-one is the crutch; keep it at the
  exit door.

Scaffolds available in `app/js/starter-trees.js` (4 trees, all verified against
`TreeModel` via `verify-trees.js`): `avoidance-map`, `decision-premortem`,
`energy-audit`, `end-of-day` (also demonstrates `recall`).

## Phase C — Canvas affordances (the investment-preserving way to edit)
Direct manipulation lets you grow your map without ever typing grammar. Close the
gaps the code review found:
- **Star toggle** — `setStar()` exists but nothing in the canvas calls it.
- **Done/terminal** — add "end path here" (today requires typing `done`).
- **Explicit "branch this"** — choice creation is currently implicit (2nd body
  line); make it visible.

## The flywheel (flagship — the real product)
When a nightly reflection surfaces a failure the tree didn't predict, nudge:
*"your map didn't have a branch for this — add it?"* One tap deep-links the
canvas to that point. Your atlas grows from lived failures; next time it catches
you. Highest-leverage feature and the moat — nobody else has *your* map. This is
also the real teacher: it's how a linear beginner tree earns its first branch,
exactly when the user hits the wall themselves.

---

## Build order for Cursor
1. **Phase A** — the 3-step meta-tree walk UI → `compileQuestionsToTree` →
   `setDslText`. (`meta-tree.js` delivered + verified; only the walk UI remains.)
2. **Home-screen metrics** — "commitments kept" + "branches added."
3. **The flywheel** — post-reflection "add this branch?" nudge → canvas deep-link.
4. **Phase C** — canvas controls for star / done / choice.
5. **Prebuilt trees** — worked example beside onboarding; adopt-one at the exit.

Everything builds on files that already work: `setDslText`, `TreeModel.*`,
`startPreview`, `dueCommitment`/`resolveCheckin`. No relay, Tauri, Playwright, or
model anywhere.
