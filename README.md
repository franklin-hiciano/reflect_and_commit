# Reflect & Commit — DSL editor + node canvas replacement

Replaces the click-heavy block editor (`tree-editor.js` + `dsl-graph.js`)
with the DSL-text editor + editable node canvas prototyped in
`Reflect & Commit.dc.html`. The raw DSL text is now the single source of
truth for the question tree — see `app/js/tree-model.js` for the grammar
and every mutation helper.

## How to apply

Copy everything under `production/app/` on top of your `wisdom_tree/app/`
folder (overwrite in place), **then delete these six files — they're
superseded and no longer loaded by `index.html`:**

- `app/js/dsl.js`
- `app/js/dsl-graph.js`
- `app/js/tree-editor.js`
- `app/js/node-graph.js` (was already dead code, unreferenced)
- `app/js/onboarding.js` (was already dead code, unreferenced)
- `app/js/pwa-install.js` (was already dead code, unreferenced)

Everything else in the repo (`sw.js`, `icons/`, `manifest.json`,
`firebase-messaging-setup.js`, `install/`, `scripts/send-notifications.js`)
is untouched.

## What changed

**Data model.** The question tree used to be an array of `{id, text, type,
options, branches, star, recall}` objects, stored at Firestore
`users/{uid}/state/questions` as `{list: [...]}`. It's now a single DSL
text string, stored at `users/{uid}/state/tree` as `{text: "..."}`. The old
`state/questions` doc is left alone and unused (per your call — no
migration needed, this was test data only).

**Editor.** `app/js/dsl-editor.js` (new) renders two live views of that
same text side by side: a plain textarea with a "+" in the gutter next to
any question that doesn't lead anywhere yet, and an editable node canvas —
drag a card's "+" onto empty space to name a new connected question, or
onto an existing card to wire it up. A version-history slider replaces the
old undo-less editing (snapshots itself every ~150–300 edited characters).
On narrow/coarse-pointer devices the two views become tabs instead of a
side-by-side split.

**Recall, upgraded.** Previously a question could only recall its own past
answers. Now any question can recall any OTHER question's past answers
(the canvas's ↺ icon opens a picker listing every question in the tree,
including itself). Recall is expressed in the DSL as `recall <title>` under
the recalling question. Answer history is still local-only
(`localStorage`, keyed by normalized question title), same as before.

**Reflection engine (`app/js/app.js`).** Walks `TreeModel.parse(dslText)` /
`buildGraph()` by question NAME instead of the old id-keyed
`nodeIndex`/`ensureShape`/`normalizeTree`. `draft.currentId` →
`draft.currentName`; history is an array of names. Everything else —
voice dictation, hold-to-commit, day-after check-in, hand-off between
devices, active-device exclusivity, push notifications — is unchanged.

**Visuals.** No changes — the app's dark/monospace/serif look already
matched the prototype exactly; only the editor's own markup/CSS is new
(`.dsl-*` / `.canvas-*` classes in `style.css`, replacing the old
`.tree-graph` / `.graph-*` / `.tree-editor` / `.t-*` rules).

## Sanity-checked before handoff

Loaded the new `index.html` and, with a hand-set `dslText`, exercised:
gutter "+" (adds a connected question), the recall popover (lists every
other question, sets `recall <title>`), and card delete — all mutate the
DSL text correctly and re-render without console errors. Google
sign-in / Firestore round-trips need a real browser + your Firebase project
to test (can't be done from this sandbox) — test that path once you've
copied the files in.
