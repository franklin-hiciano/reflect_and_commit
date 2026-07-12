# wisdom_tree UI update — handoff doc

Written for a fresh chat with zero memory of the prior session. Read this whole
doc before touching code — **especially §0 below, a session-2 addendum** — then
§2/§3 for the detailed done/not-done breakdown. It supersedes
`docs/ui-update-plan.md` (kept in the repo for the original design reasoning —
streak philosophy, notification architecture, etc. — but its UI-mechanics
sections are stale; this doc is the current source of truth for what's built
vs. not).

**Repo:** `/Users/franklin/Documents/projects/wisdom_tree` (device path, reached
via the remote-devices bridge). App lives in `app/`: `index.html`,
`style.css`, `js/app.js`, `js/dsl-editor.js`, `js/tree-model.js`,
`js/meta-tree.js`, `js/starter-trees.js`, `firebase-init.js`.

**⚠️ TWO index.html files — edit BOTH, always** (found this session, not
previously documented here): the repo root's `index.html` (Vercel/web build,
paths like `app/style.css`) and `app/index.html` (Capacitor `webDir`, paths
like `style.css`) are **separately tracked files with independent git
history**, not a build artifact of one another. They'd drifted before this
session — root was missing the entire `#homePill` block (it only existed in
`app/index.html`), so the commitment pill silently never rendered on the web
build. Fixed this session (see §0), but **every future markup change needs to
land in both files identically** or they'll drift again. `app.js`/`style.css`/
`dsl-editor.js` etc. are genuinely shared (referenced by both HTML files via
relative paths) — only the two `index.html` files themselves are duplicated.

**Workflow used all session:** stage device files → edit a local copy →
`node --check` for JS syntax + brace-balance check for CSS → `SendUserFile` →
`device_commit_files` with `force: true` back to the same device path. No live
browser/Firebase available in the sandbox — everything is syntax-verified, not
click-tested. **Assume visual bugs exist that only show up on-device.**

---

## 0. Session 2 update (this session) — read this first

Picked up mid-flight: a session-1 uncommitted diff in `app.js` (the
`routeAfterAuth` "time first" notif-gate routing change) plus the backlog
below in §3. Worked top-down per §7's suggested order, verifying each chunk
with `node --check`/brace-balance and shipping incrementally. **None of this
has been click-tested on-device yet** — same caveat as everything else in this
doc.

**Done this session:**
- **Finished the in-flight notif-gate change.** `_markNotifValidated`
  (`app/firebase-init.js`) now writes `localStorage['rc_notif_validated']='1'`
  immediately (local-first, before the remote Firestore write even lands) —
  this was the missing write-side session 1 flagged (`isNotifValidated()` was
  already reading the flag, just nothing ever set it). Verified the full
  `routeAfterAuth` → `goToNotifySetup()` (time picker) → `goToNotifPermission()`
  → `requestNotifPermissionOnboard()` chain is wired consistently in both
  `index.html` files.
- **Bug #2 (canvas/selection broken) — fixed.** Root cause confirmed: the
  DSL textarea's line-drag `mousedown` handler (`dsl-editor.js`) armed
  `_lineDrag` on every mousedown anywhere in the textarea, so any normal
  multi-line text selection (vertical mouse movement > 9px) got
  reinterpreted on mouseup as "move this line" — silently discarding the
  selection and reordering DSL text. Fixed by only arming line-drag when the
  mousedown's x-coordinate is within 32px of the left edge (the gutter/
  indent column) — normal text selection anywhere else in a line is now
  untouched.
- **Bug #1 (native canvas scroll not killed) — fixed.** `.canvas-scroll` kept
  `overflow: auto` (needed — the JS drag-pan works by setting
  `scrollLeft`/`scrollTop` directly) but now also has a `wheel` listener
  calling `preventDefault()`, so trackpad/mousewheel/scrollbar input no
  longer fights the 2D drag-pan. 2D drag is now the only way to move the
  canvas.
- **§3a (pill header row) + §3b (DSL editor top-left/grows-down) — built,
  done together per §7's suggested pairing.** Specifics:
  - New `.home-header-row`: real (non-fixed) full-width flex row, itself
    invisible, sits above `.home-body` and pushes it down. Contains the
    `.home-pill` (commitment text/chevron + metric + streak + pfp all still
    folded in together, per explicit confirmation) centered, with
    `.home-pill-play` now a **separate sibling circle** to the pill's right
    (previously nested inside the pill). `.home-pill-drop` (the resolved-
    commitments dropdown) now anchors off `.home-header-row` instead of a
    fixed top-right offset. Mobile keeps its own `position:fixed`
    bottom-center override for `.home-pill` (unchanged behavior there); the
    header row itself collapses to zero height on mobile since both its
    children go back to fixed positioning.
  - `.home-pill` was already outside the `@supports corner-shape:
    superellipse` squircle list — confirmed, no change needed for "literal
    pill, not squircle."
  - **This is also where the missing-`#homePill`-on-web bug got fixed** — see
    the TWO-index.html callout above. Ported/rebuilt the pill markup into
    root `index.html` (it had none) and restructured `app/index.html`'s
    existing block to match the new split-play-button layout. Both files now
    have identical `.home-header-row` markup.
  - DSL editor (`.dsl-split:not(.mobile) .dsl-pane`): flipped from
    `bottom: 10px` (grows upward) to `top: 10px` (grows downward), same
    `max-height: 62%` footprint. Toolbar (`.squircle-corner-tools`, now just
    copy + delete) moved from `align-self: flex-start` to `flex-end`
    (bottom-right). **History control extracted entirely out of the
    toolbar** into a new `.dsl-history-zone`: a 40×28px hover target
    positioned at the editor's bottom-left, `opacity: 0` by default,
    revealed on `:hover`/`:focus-within`; its dropdown now opens downward
    below it instead of upward into the editor.
  - **Fixed a clipping bug this surfaced:** `.dsl-editor-wrap` had
    `overflow: hidden` (despite a stale comment above it claiming otherwise),
    which would have clipped the new history zone into invisibility since
    it's positioned at `top: 100%` (below the wrap's own box). Changed wrap
    to `overflow: visible` and moved the actual scroll-clipping + matching
    top corner-radius onto `.dsl-editor-scroll` instead (restores what the
    stale comment already said was the intended architecture). Also removed
    now-redundant/wrong `order: 1` on `.dsl-editor-scroll` (with the toolbar
    no longer needing `order: 2`, that stray `order` would have visually
    flipped scroll-content below the toolbar via flexbox `order`, regardless
    of DOM order — removed both).

**Not yet re-verified on-device:** everything above is syntax-checked only.
Given the header-row/pill/DSL-editor changes touch layout math shared with
§3c (canvas fade edges, not yet built) and §3d/§3e (canvas+DSL declutter,
not yet built), **on-device testing before continuing to §3c onward is
worth doing** — the fade-zone geometry in §3c is explicitly written against
"wherever the DSL editor ends up," so confirming §3b's actual rendered
footprint first avoids rework.

**Remaining, in suggested order (unchanged from §7 below):** §3c (canvas
fade edges) → §3d+§3e (canvas view-only + DSL declutter, the single biggest
remaining chunk) → §3f (card cleanup) → §3g/§3h (reflection screen + mobile
composer) → sweep remaining bugs (#3 already fixed above as part of the
notif-gate work; #5 stray-plus audit and #7 dead `_naming` cleanup are part
of §3e) → first-tree auto-trigger.

**Pill redesign (mid-session correction, on top of the §3a build above) —
also done, both `index.html` files + `app.js` + `style.css`:**
- Removed the account name text entirely — `#userMenuTrigger` is avatar-only
  now (`<span id="userMenuName">` deleted from both HTML files;
  `renderUserMenu()` in `app.js` no longer touches it; the now-dead
  `.user-menu-name` CSS rule removed).
- `.home-header-row` is right-aligned now (`justify-content: flex-end`, was
  `center`), and the play button moved BEFORE the pill in DOM order (was
  after) — reading order is play → pill, whole group flush right.
  `.home-pill-drop` re-anchored to `right: 16px` off the row (was
  centered under it) to match.
- Confirmed (no code change needed): opening the pill goes straight from
  collapsed (chevron only) to fully open (text + dropdown together) — both
  are driven by the single `_commitPillOpen` boolean already, there was
  never a separate horizontal-only intermediate stage in the actual
  implementation despite `ui-update-plan.md`'s two-stage description.
  "Nothing in the middle" of the collapsed pill row is now literally true:
  commit-text/chevron → streak → pfp, no metric element between them.
  the old always-visible `.home-pill-metric` (stopwatch + glass) is GONE
  from that row.
- **Metric moved into the dropdown, split into two pieces:**
  - A completion-rate bar at the very bottom of `#homePillDrop`
    (`.home-pill-rate` / `-bar` / `-fill` / `-pct`), built fresh each open in
    `renderCommitDrop()` — a small filled bar plus a literal "`73% done`"
    text label. Replaces the old glass-fill visualization.
  - Per-item **time delta** on the right of each `done` entry in the
    resolved list (`.home-pill-past-item .delta`, reusing the same
    createdAt→resolvedAt latency math the old aggregate "speed" stat used,
    now shown per-row instead of as one median number). `missed` entries
    still show the ✕ mark — delta only makes sense for completed ones.
- Added a small "done?" label (`.home-pill-drop-question`) above the
  yes/no hold buttons; button labels shortened from "I did"/"I didn't" to
  "yes"/"no".
- **Streak → "ideas executed."** Icon changed from a flame to a filled
  lightbulb SVG (`.bulb` class, was `.flame`) — same gray-at-0/lit-when->0
  color mechanism (`.home-pill-streak.lit`), just a different glyph. `title`
  attribute and the JS comment above `renderHomePill()` updated to match;
  internal state/variable names (`kept`, "streak") were left as-is, this is
  a user-facing copy/icon change only.
- **DSL line-drag bug #2 fix re-confirmed, not changed:** the 32px
  left-edge-only arming zone (added earlier this session) already preserves
  vertical dragging in both senses — dragging near the left edge still
  reorders a line, dragging anywhere else (including a vertical multi-line
  drag) still does normal browser text selection, since nothing outside
  that 32px zone is intercepted. Added a clarifying code comment; no
  behavior change was needed.

**More corrections, same session, after the pill redesign above:**
- DSL editor toolbar: **copy and delete-all buttons removed entirely** —
  `.squircle-corner-tools` and the `copyDslText`/`fallbackCopy`/
  `deleteAllText` functions are gone. Only the history hover-control remains
  on the editor itself (shifted from `left:0` to `left:20px`). Deletion
  still works by editing the DSL text directly / via `deleteBlock` from
  elsewhere in the code, just not from a dedicated button anymore.
- Added a small gray **`.dsl-pane-label`** ("your questions") above the DSL
  editor box.
- **§3c canvas fade edges — built.** Gradient overlay strips (NOT
  `mask-image` — compositing multiple mask gradients into one coherent
  L-shape isn't reliable cross-browser without live testing), fading near
  the top edge (under the header), right edge, **left edge** (added after
  an explicit follow-up ask), and an L-shape around the DSL editor's
  bottom-right corner. `pointer-events: none` throughout.
- **§3d + §3f — canvas is view-only, card cleanup, done together:**
  clicking a card's text no longer renames it inline (that flow — `_editingName`
  and the textarea-swap in `buildCardEl` — is now ONLY reachable via "+"
  creating a brand-new node, a separate still-valid flow). Clicking anywhere
  on a card (via the existing `startCardDrag`'s `!moved` case, not a
  separate click handler — avoids double-handling) toggles a metadata panel
  above it: kind (`multiple choice` / `text response`) + a recall-status
  readout. The delete (✕) button, right-click-to-delete, and long-press-to-
  delete are all removed — deletion only happens in the DSL editor now.
  Recall moved to bottom-left (was middle-right) as its own independently-
  clickable button, per the user's explicit decision earlier this session.
  Also fixed `.dsl-gutter-btn`'s "+" vertical-centering bug (missing flex
  centering).
- **Home pill, header, streak — several follow-up corrections:**
  - Name text removed entirely (`#userMenuName` span deleted from both
    HTML files + `renderUserMenu()`); avatar-only now.
  - Header row right-aligned (`justify-content: flex-end`, was `center`),
    play button moved BEFORE the pill in DOM (order is play → pill,
    matching an explicit ask), `.home-pill-drop` re-anchored to
    `right: 16px` off the row.
  - Metric split: a completion-rate bar (`.home-pill-rate`, literal "`73%
    done`" text) at the bottom of the dropdown, replacing the old
    always-visible stopwatch+glass; per-item time **delta** on the right of
    each `done` entry in the resolved list, replacing its checkmark
    (`missed` entries keep the ✕).
  - Small "done?" label above the yes/no hold buttons (labels shortened
    from "I did"/"I didn't" to "yes"/"no"). **The active commitment's
    yes/no confirm buttons already exist** — this was built as part of the
    pill redesign, not a separate later feature; a user question mid-session
    confirmed this is in place.
  - Streak → **"ideas executed,"** icon changed flame → filled lightbulb
    (`.bulb`, was `.flame`), same gray-at-0/lit->0 mechanism.
  - **The lightbulb (not a chevron) is now the expand/collapse trigger for
    the idea menu** — `.home-pill-commit` is a plain non-interactive `<div>`
    now (chevron removed), `.home-pill-streak` became a real `<button
    onclick="toggleCommitPill()">`.
  - `.home-header-row` padding trimmed (`12px 16px 6px` → `8px 16px`) and
    `.home-body`'s leftover top padding trimmed (`16px` → `2px`) — together
    these were the "everything is pushed too low" bug (a real regression
    from the header-row rebuild that hadn't been caught).
  - `--elev`/`--elev-sm` shadow blur radius trimmed (24px/10px → 14px/6px)
    — read as way too heavy once more elements started using these tokens.
- **§3e (DSL declutter) — PARTIALLY built, see the honest breakdown below.**
- **Canvas pan — real bug found and fixed, not from the original backlog:**
  a user report ("still can't 2D drag") turned out to be a genuine
  regression risk in the ORIGINAL (pre-session) pan implementation:
  `.canvas-scroll`'s pan worked by setting native `scrollLeft`/`scrollTop`,
  which only has any visible effect when the tree's rendered content is
  actually BIGGER than the viewport (real scrollable overflow to move
  within). For any small/medium tree that already fits on screen —
  probably most trees, especially early on — dragging did nothing visible
  at all, even though the JS ran without error. Rewrote panning to be
  **transform-based** (`_canvasPan` state + `applyCanvasPan()` in
  `dsl-editor.js`, applied via `content.style.transform` on top of the
  existing auto-centering margins) — this has no ceiling tied to content
  size, drag now moves the canvas any amount in any direction regardless of
  tree size. `.canvas-scroll` changed from `overflow: auto` to `overflow:
  hidden` accordingly (nothing to natively scroll anymore). **This is the
  single highest-priority thing to verify on-device** — it's a rewrite of
  core interaction code based on reasoning about why it must have been
  broken, not something click-tested.

### §3e (DSL declutter) — what's actually built vs. still missing

Built:
- ~~Declaration lines get a full-line gray highlight band; reference/recall
  lines get a lighter dimming band~~ — **superseded, see chunk 8 below**: a
  block's declaration and every reference under it now paint as ONE single
  band of one gray, not two shades. Painted BEHIND the (transparent-
  background) textarea via `#dslHighlight`, positioned in JS using the same
  `measureLineTops()` data the line-drag feature already relies on.
- Hover a reference line to reveal a small ✕ near the right edge
  (`#dslRefControls`, a separate overlay ABOVE the textarea this time, so
  it's actually clickable) that detaches just that one reference —
  `TM().detachReference(text, rawLine)`, a new `tree-model.js` function,
  doesn't touch the target block or any other reference to it.
- Single-"+" rule audited: the per-empty-leaf "+" was already correctly
  scoped (`b.type === "text" && !b.next && !b.terminal`, one per truly-
  empty node). Added the ONE other "+" the spec calls for — a single
  button at the very bottom of the editor — but wired it to
  `TM().insertNewBlockAfter(text, atRawLine, name)` (new function) so it
  inserts relative to the **current cursor position**, not always the
  physical end of the document, per the spec's own "insertion point" note.
- `<rect>`-based note: none needed here.

**Built in chunk 10 (this session, follow-up to chunk 9):**
- **Drag-to-add-options.** Turned out the DSL text editor's general-purpose
  line-drag (`_lineDrag` → `TM().moveLine(text, from, to)`, already wired
  for every drag in the editor) was closer to done than this doc previously
  said — `moveLine`/`dropContext` already handled connecting a dragged
  REFERENCE line onto another block's body. The one real gap: dropping a
  dragged DECLARATION exactly onto another block's declaration line was
  read as a plain reorder, never as "connect this in as a new option,"
  even for a brand-new empty question — which is the actual common case
  ("drag a block's declaration onto the question" from the original ask).
  Fixed with a narrow, guarded addition:
  - `dropContext` now marks an exact declaration-line landing with
    `onHeader: true`, distinct from its fallback "nearest next block"
    case (dropped on a blank separator line) — only an exact landing
    should ever be read as "onto this specific block."
  - `moveLine`'s header-drag branch now also treats
    `ctx.mode === "declaration" && ctx.onHeader` as a connect (same as the
    existing reference-mode case): deletes the dragged block's standalone
    declaration and adds it as a new body line under the block you dropped
    it on, via the same `connectExisting` used everywhere else — 2+ body
    lines auto-promote to a choice per the grammar, so dropping a second
    empty question onto a leaf that already has one option makes it a
    2-option choice automatically, no separate "make this a choice" step.
  - **Guarded against the obvious regression**: this only fires when the
    dragged block is genuinely empty (`!blockHasBody`, the same guard the
    existing reference-mode branch already used) — a declaration that
    already has real content dropped onto another header still just
    reorders, exactly as before. Verified both directions with quick
    `node -e` scripts against the actual module (not just read-through):
    dragging an empty leaf onto a 1-option question promotes it to a
    2-option choice; dragging a non-empty, already-built question onto
    another header still only reorders, doesn't silently eat its content.
- **NOT built — still genuinely deferred:** the "auto-fill `Yes -> …` /
  `No -> …` placeholders, inline-edit the first one with a 'next' button"
  scaffolding for building BOTH sides of a fresh choice in one gesture.
  The drag-to-add-options fix above covers the underlying *capability*
  (you can now build an N-option choice via drag, since 2+ body lines
  auto-promote), but this specific placeholder-autofill-plus-inline-edit
  choreography is a distinct, more novel UX shortcut with enough
  interaction-sequencing detail (focus management, when the "next" button
  appears, what click-off actually commits) that guessing it blind risks
  shipping something that doesn't match intent. Left deferred rather than
  guessed at.
- **Reference lines rendering visually smaller/truncated** (not just
  dimmed) — this is NOT achievable in a plain `<textarea>`, which only ever
  renders ONE uniform font-size for its entire value. The dimming bands
  above are the closest approximation possible without migrating to a
  contenteditable-based editor (a genuinely bigger, separately-decided
  rewrite — flag this trade-off to the user before attempting it, don't
  just do it).

---

### Chunk 8 (this session, follow-up to chunk 7) — corrections

All from live on-device feedback after chunk 7 shipped:

- **DSL highlight: one gray, not two.** `renderDslPane` used to emit a
  brighter `.dsl-hl-decl` band for the declaration line and a fainter
  `.dsl-hl-ref` band per reference line — two different shades made a
  block's declaration and its own references read as two different things.
  Now it's a single `.dsl-hl-band` spanning `b.rawLine` through the last
  line before `b.bodyEndRawLine` as one shape, one color — a node and
  everything pointing back to it is visually one encapsulated group.
- **Canvas node metadata is always-on now, not click-gated.** The old
  `.canvas-card-meta` panel (kind + recall status combined) only rendered
  when a card was "selected" via click. Split into two independent, always-
  visible floating labels: `.canvas-card-kind` ("text response" / "multiple
  choice") floats above the card at all times; `.canvas-card-recall-status`
  ("memory enabled" / "memory disabled") sits directly beside the recall
  button itself (bottom-left of the card), also always-on — not hover-gated,
  not click-gated. `_selectedCard`/`.canvas-card.selected` still exists for
  the border highlight on click, but nothing's visibility depends on it
  anymore.
- **Recall popover was missing its own header.** `.canvas-recall-popover-hdr`
  had CSS defined but nothing in `buildCardEl` ever created the element —
  the "recall from which question" menu was rendering as a bare list of
  options with zero label. Added a `"recall answers from:"` header line.
  (This is what "make sure the idea menu is complete" turned out to be —
  the popover itself was fully functional, it was just missing this one
  labeled header.)
- **Canvas fade: one short fade, right side only.** Was 5 gradient divs
  (top/right/left/editor-x/editor-y, mostly 64px wide, covering the full
  screen edges). Now it's a single `.canvas-fade-right`: 26px wide (was
  64px), vertically bound to `top:10px; height:62%` — the exact same box
  the DSL editor pane itself occupies, so it only fades the strip of canvas
  that's actually beside the editor, not the whole right edge of the
  screen. Left/top/bottom are hard cutoffs now (no gradient element at
  all) — `.canvas-scroll`'s existing `overflow:hidden` already clips there,
  which IS the "cutoff" that was asked for.
- **Header row now has an explicit background.** `.home-header-row` was
  genuinely `background: none` (comment called it "invisible" — no
  background OR border). Since the canvas is a full-bleed transform-panned
  layer underneath everything with no `backdrop-filter` of its own, panning
  a tree up into that empty space (left of the pill) would show canvas
  nodes bleeding straight through. Gave it `background: var(--bg)` — same
  color as the page, so it still reads as "invisible," but now actually
  opaque. This is the concrete fix for "you can see [the canvas] behind
  things since the blur is broken" — there was never a real
  `backdrop-filter` blur anywhere near the header/canvas; "blur" in that
  complaint is almost certainly this bleed-through, not a literal blur
  effect gone wrong. **Flagging this interpretation explicitly** — if this
  wasn't the actual bug being described, it needs a fresh look with the
  live app open, since nothing else in the codebase does canvas-hiding via
  `backdrop-filter` that could plausibly be "broken."
- **Fixed the phantom left margin next to the lightbulb.** `.home-pill-
  commit`'s inner text span already went `display:none` when the pill was
  closed, but the *container div* kept its own `4px 4px` padding regardless
  — an invisible, padded empty box sitting immediately left of the
  lightbulb button, which is exactly the "fatter margin" that was
  reported. Now `.home-pill-commit` itself is `display:none` when closed
  (mobile gets an explicit override back to `flex`, since mobile always
  shows the commit text per the existing "text always open" behavior).

Not attempted this chunk: drag-to-add-options and drag-to-create-choice
(still deferred from chunk 7, see above), §3g/§3h/§3i, first-tree
auto-trigger.

---

## 1. Thesis (compressed — read `docs/ui-update-plan.md` §0 for full reasoning)

- No streak-as-attendance. Streak = **cumulative commitments kept** (can't be
  broken, measures follow-through not usage).
- No commit-card ceremony. A reflection just ends; **one LLM call** reads the
  transcript and captures **the last thing you said you'd do or even mentioned**
  — transcription, not introspection. This is the *only* LLM in the app; tree
  authoring stays deterministic/model-free.
- Closing the loop is **passive** (a hold-to-resolve tap in the pill on return),
  never a push notification asking "did you do it?".
- Mobile is **read-only** for the tree; desktop is where you author. Mobile's
  job is the nightly reflection.
- "Branch" language is being retired — the user's trees are personal ignition
  *sequences*, not decision trees. (Relevant to copy, not yet a code change.)

---

## 2. What's DONE and committed (verify on-device, don't re-do blind)

### Reflection flow / core loop (`app/js/app.js`)
- **Commit-card UI deleted** from `index.html` (`phaseCommit` block gone).
- `enterCommit()` rewritten: no more textarea/date-picker. Calls
  `captureConvergence()` (LLM) unless the walk was the onboarding meta-tree, in
  which case `maybeCompileMetaWalk()` runs instead (see below). Guarded by
  `draft.captured` so it only fires once per reflection.
- `captureConvergence()`: builds a transcript from `draft.history` +
  `draft.answers`, POSTs to the endpoint below, parses one imperative line (or
  `NONE`), calls `window._addCommitment({text, dueDate: tomorrow})`.
- **Also fires on mid-walk exit** (`window.exitReflection`) if
  `draft.phase === "question"` and not yet captured — leaving early IS the
  convergence signal.
- Endpoint (shipped **exposed on purpose** — user said "ship exposed, it's a
  free tier pool"):
  ```
  POST http://34.26.134.74:3001/v1/chat/completions
  Authorization: Bearer sk-bf-6a54c177-3684-411e-8b0a-1bb4e11102e9
  model: "free-agent-pool"
  ```
  **⚠️ Never verified live** — sandbox egress proxy blocks this IP:3001
  (TCP connect timeout), so this has only been read-reviewed, never called
  successfully. First thing to check on-device: does the fetch even resolve?
  Check CORS too (browser fetch, not server-side).
- `maybeCompileMetaWalk()`: if the walk just completed was `window.META_TREE`
  (loaded from `js/meta-tree.js`, now `<script>`-included in `index.html`),
  parses the starred answer into newline-separated questions and calls
  `window.compileQuestionsToTree()` → `window.setDslText()`. Deterministic,
  no model. **This is the entire "first tree" flow** — no separate onboarding
  walk UI was built; it reuses the existing reflection composer since
  `META_TREE` is just DSL text like any other tree. **Not yet wired to
  auto-trigger for a brand-new user with an empty tree** — currently nothing
  loads `META_TREE` as the active tree automatically. That's outstanding.
- `doCommit`/`skipCommit`/`renderDueSelect`/`onCommitDueChange` — all deleted.
- Notification gate (`isNotifValidated`, `routeAfterAuth`) — rewritten to a
  hard once-only gate backed by a **local** flag
  (`localStorage['rc_notif_validated']`) so it can't re-nag before the remote
  `_deviceData` snapshot has loaded (this was the "let me in first launch,
  nagged every time after" bug). **⚠️ The flag is never actually SET anywhere
  yet** — I added the read-check but did not find/patch the write side (should
  be set at the same moment `_markNotifValidated()` fires remotely). Search
  `_markNotifValidated` call sites and set `localStorage['rc_notif_validated']
  = '1'` alongside every one. Also routes to `goToNotifySetup()` (time picker)
  before permission, per "time first" ask from earlier in the session — but
  this was mid-edit when the session's model got switched; **re-verify the full
  routeAfterAuth flow on-device**, it's the least-tested change in the repo.
- QR code: root cause was it living in `#otherDeviceGate` inside the hidden
  `#homeScreen`. Fixed by rendering inline in `showDesktopFirstLaunchGate()`
  directly on the visible landing screen, via `qrSrcFor()` (still the external
  `api.qrserver.com` image API — **local QR generation was never done**, see
  §3). Link is a non-clickable `<span>` now (was an anchor).
- Mobile install copy: platform-branches on `isIOS()+isSafari()` /
  `isIOS()+!isSafari()` / Android, since "Add to Home Screen" only works in
  iOS Safari specifically. No install method exists to skip the OS prompt.
- **The home pill** (`index.html` `#homePill` + `js/app.js` `renderHomePill()`
  / `renderCommitDrop()` / `renderPillMetric()`): play (currently a *filled*
  circle button, not standalone per new ask, see §3) · commitment text
  (collapsed to chevron, click to open) · want→done metric (stopwatch + fill
  glass, hidden until first resolution) · streak flame (Syne count, gray at 0)
  · pfp/account menu. Dropdown: hold-to-resolve green/gray buttons (600ms
  hold) + resolved history (✓/✕, newest first, unresolved never piles up).
  Reads straight off `commitments`/`window._commitments` — no new Firestore
  shape needed.
- Want→done metric: median `resolvedAt - createdAt` latency (stopwatch,
  `pillSpeed`) + conversion rate (`pillGlassFill` height %). Both derived
  live from `commitments`, no new fields.
- History: rewritten from random-threshold whole-tree snapshots (in-memory
  only) to **per-tree diffs, permanently persisted** to
  `localStorage['rc_tree_history']` as `{base, patches:[{t,p,s,x}]}` (prefix/
  suffix diff), replayed on load. Capped at 400 patches (folds oldest into
  base). `pickThreshold()` is now a fixed 60, no randomness.

### DSL editor / node canvas (`app/js/dsl-editor.js`, `app/style.css`)
- Paired-editing toggle **removed entirely** — cascade-on-edit is now always
  on. This also removed the "broken copy button on the left" (it was the
  paired-editing toggle, not a copy button).
- Editor toolbar is a pill: copy · history · × delete-all (`deleteAllText()`,
  confirms before wiping). **Currently positioned bottom-left of the editor
  per an earlier ask — new ask wants it bottom-RIGHT, see §3.**
- Recall menu: single-select checkmark list, defaults to the node's own
  answers, purple-was-now-gray (`--purple` token repurposed to a light gray
  per later correction) when on. Toggle behavior: click button when off →
  turns on (defaults to self) + opens menu; click again when on → turns off +
  closes; click a menu option → changes target, menu stays open; click
  outside → just closes the menu (recall state unchanged). Recall options
  filtered to only in-tree (reachable) blocks — disconnected second-heads no
  longer appear as recall targets. Self-recall draws no edge.
- "+" behavior: clicking (gutter or canvas ghost slot) creates a node
  **immediately** and drops into inline edit — no separate naming popover.
  (Old `_naming` popover code is now dead/unused, never removed — cleanup
  opportunity.)
- **Leaf-only hypotheticals**: only nodes with no outgoing edge show a
  persistent canvas "+"; interior nodes reveal theirs (path + slot) on
  card-hover, with a 900ms hide-delay so you can travel from card to button.
  Hovering a hypothetical also **geometrically suppresses any other
  hypothetical overlapping the same slot** (whoever's hovered wins) — this
  was fixed after an initial version only checked declared parent/child.
- Ghost slot for branch/choice options repositioned below the lowest existing
  child instead of overlapping it (`ghostColRow` now takes `Math.max` of all
  child rows + 0.9, not a flat offset).
- Node text: Amiri serif when not editing (mono/Geist while editing — **but
  new ask says text response nodes shouldn't be inline-editable on canvas at
  all anymore, see §3**). Node rename cascades via `renameBlockTitle` and now
  updates the DSL text **live on every keystroke** (not just on commit) via a
  `curName`-tracking `input` listener that calls `window.setDslText` directly
  without a full canvas re-render mid-edit.
- Star/"tonight's minimum" feature fully removed (UI + all JS refs).
- "choice" tag removed from choice cards.
- Elevation inverted: `--bg` is the darkest layer; `--surface` / `--surface-2`
  / `--surface-3` are progressively lighter "raised" tones with real
  box-shadows (`--elev` / `--elev-sm`). Was backwards in an early pass, fixed.
- Corner radii: increased substantially + an `@supports (corner-shape:
  superellipse(...))` block applies Apple-style continuous corners via
  `--corner-k` (currently `2.2`) to most containers. **New ask explicitly
  wants the home-pill to be a plain fully-rounded pill, NOT squircle — audit
  every corner-radius decision against the new asks in §3, some containers
  may need to drop out of the squircle rule.**
- DSL editor layout has been repositioned several times over the session —
  **current committed state**: bottom-anchored (`bottom: 10px`), left-aligned,
  auto-grows **upward** as text is added (sized via a hidden-mirror
  line-measurement function `measureLineTops()` since `wrap="soft"` means
  logical lines ≠ visual rows), width 45%, `max-height: 62%` (tied to the
  tree's vertical center line). **New ask reverses this: top-left, grows
  DOWNWARD, same total vertical space it currently occupies just anchored at
  the top instead of the bottom. This is a real layout inversion, not a
  tweak — see §3.**
- Canvas: `.canvas-scroll` is a plain `overflow: auto` box in both axes;
  centering is done via **JS-computed margins** on `.canvas-content`
  (`renderCanvasPane`) rather than CSS flex/grid centering, because the CSS
  approach was clipping the scrollable region. Drag-to-pan wired via
  mousedown/mousemove/mouseup on `.canvas-scroll`, currently **both
  axes** (was briefly vertical-only, user reverted that ask). **New ask: the
  ONLY way to move the canvas should be 2D drag — no scroll-wheel/scrollbar
  scrolling at all.** Currently both drag AND native scroll work
  simultaneously (native `overflow:auto` scroll is still live) — needs an
  explicit `overflow: hidden` + pure JS-driven pan, or `e.preventDefault()`
  on wheel events, to actually kill native scroll.
- Mobile: **read-only vertical tree.** `renderPaneSwitch()` now always hides
  the DSL pane on mobile (no pane switcher). `buildCanvas()` has a `V`
  (vertical) branch when `mobile()` is true: depth flows top-to-bottom,
  siblings fan horizontally, edges use vertical bezier curves. All
  edit/delete/recall/drag/hover affordances are gated off with `!mobile()`
  checks in `buildCardEl`. Ghost slots suppressed entirely on mobile
  (`ghost: V ? null : ghost`).
- Mobile home shell (`index.html`): big centered green wireframe circular
  play button (`#mobilePlayBig`, `top: 15%`), pill repositioned to
  bottom-center via a `@media (max-width: 819px)` block (text always shown,
  play button hidden — mobile has the big one instead), "you edit your tree
  on desktop" note above the pill.
- Line-drag inside the DSL textarea: press a line, move >9px vertically,
  drop on the target line, releases via `TM().moveLine()`. No text selection
  needed. Separate from the native `dragstart`/`drop` handlers that already
  existed for the *native* HTML5 drag (kept both).
- Fonts: **Amiri** (serif) for all copy/UI text, **Geist** (assigned to the
  `--mono` token, confusingly — it's sans, used for code/mono contexts:
  DSL textarea, node-editing input, gutter "+", card tags), **Syne** for the
  streak/metric numbers. Google Fonts `<link>` in `index.html`. (Amulya was
  tried and explicitly reverted — don't reintroduce it.)

### Known-committed but NOT re-verified after later asks
Several late-session asks (pill shape, DSL top/grow-down, node
edit-vs-view-only, reference styling, plus-count reduction, etc. — all of §3)
arrived in one dense final message **after** the most recent commit. **None of
§3 has been implemented yet.** The description above is the state of the
*committed* code only.

---

## 3. NOT DONE — the full remaining backlog

This is the user's own final message, organized into buildable specs. Treat
each as a real requirement, not a suggestion.

### 3a. Pill shape & layout (correction to what's built)
- The home pill must be **a literal pill** — fully rounded ends
  (`border-radius: 999px`, which it already has), but **explicitly NOT** part
  of the squircle/`corner-shape: superellipse` rule. Audit `.home-pill` and
  everything inside it out of that `@supports` selector list if it's in there
  (check — it may not currently be, verify).
- The pill should occupy **its own row acting as a header** — i.e. a full-width
  strip at the top of the screen, but **visually only the pill itself is
  visible** (the strip/row has no background/border of its own). All other
  page content sits below that row. This is a layout restructure: currently
  `.home-pill` is `position: fixed; top/right` floating over the canvas: it
  needs to become (or behave like) a real header row that pushes/bounds the
  content below it, while rendering as just a centered pill.
- **The commitment display becomes its own separate centered pill**, distinct
  from the play button: "the commitments thing should be a pill in the
  center, with the play button being on the right of that (just a standalone
  circle)." So: **two elements** in the header row — a centered pill
  (commitment text + chevron, presumably still with streak/metric/pfp folded
  in — user didn't fully respecify where streak/pfp/metric go relative to this
  split, use judgment: likely still inside the commitment pill, with play now
  fully detached as its own circle to the pill's right) and a standalone
  circular play button beside it. **Ask the user to clarify streak/pfp/metric
  placement if it's not obvious once you're rebuilding this — don't guess
  silently on a full layout rewrite.**

### 3b. DSL editor: top-left, grows downward
- Move from bottom-anchored/grow-upward to **top-left, grows downward**.
- "the dsl editor takes up as much vertical space as it does now, just from
  the top instead of the bottom" — i.e. keep the same max footprint/sizing
  logic (currently tied to `max-height: 62%`), just flip the anchor from
  `bottom` to `top`.
- Toolbar (copy/history/delete pill) moves to **bottom-right** of the editor
  box (was bottom-left).
- History dropdown: **remove as a persistent bottom bar entirely.** Replace
  with: history control lives at **bottom-left**, and is **only visible on
  hover, below the DSL editor** (i.e. it's hidden by default, appears when you
  hover the area under the editor). Re-read this a few times before building
  — it's a hover-reveal affordance below the editor's bottom edge, not inside
  the toolbar pill.

### 3c. Canvas fade-out edges
- The canvas should **fade out (gradient mask) at its borders**, specifically:
  the **right border of the app** (screen edge), the **header** (top, i.e.
  under the new pill-header row), the **right edge (x) of the DSL editor**,
  and the **bottom edge (y) of the DSL editor**. In other words: use a CSS
  `mask-image` (linear-gradient fades) on `.canvas-viewport` or
  `.canvas-scroll` so the canvas visually dissolves as it approaches the
  DSL editor's footprint and the screen's top/right edges, rather than
  having a hard boundary. Since the DSL editor is now top-left (§3b), the
  fade zone is roughly: fade near top edge, fade near right edge, fade along
  the DSL editor's right and bottom edges (an L-shaped fade around the
  editor's bottom-right corner). This likely needs a `mask-image` with
  multiple gradients, or a couple of stacked pseudo-elements with
  radial/linear gradients positioned over the canvas.

### 3d. Canvas becomes view-only; node click shows metadata
- **Remove node text editing on the canvas entirely.** No more inline
  rename via clicking a card's text. (`_editingName`, the inline
  `<textarea>` swap in `buildCardEl`, and the live-DSL-update-on-keystroke
  code all become dead for this purpose — likely delete or heavily gut.)
- **Clicking a node instead toggles/shows metadata**, displayed **above** the
  node (or as part of an expanded state):
  - **Recall status**: "memory enabled" / "memory disabled" — clicking
    toggles it (replaces or supplements the existing recall-button/popover
    mechanism — probably simplifies it: click node → toggles recall on/off
    directly, using the same default-to-self-then-pick-target logic already
    built, but the ENTRY POINT changes from a small recall icon-button to the
    node click itself).
  - **Node kind label**: "multiple choice" or "text response" — read-only,
    derived from `block.type` (`"choice"` vs `"text"`), just a label shown
    above the node when selected/clicked.
- Net effect: **the canvas is for viewing structure and toggling recall, not
  for creating/renaming.** All real authoring happens in the DSL editor.

### 3e. DSL editor becomes the real editing surface — declutter hard
- Goal stated directly: **"everything but node [declaration] is visually easy
  to overlook, and there's only one plus at the very bottom, or when a node is
  empty and has no references."**
- **Node declaration line**: the *whole line* gets a distinct gray background
  (a full-line highlight band — this is the same mechanism that was planned
  earlier in the session for the two-way DSL↔canvas line-highlight, but
  that overlay was never built; build it now, this is its first real use).
- **Reference lines** (a bare next-target, a labelled choice option, or
  `recall X`): render **smaller, truncated, immutable gray text** — visually
  de-emphasized, NOT directly text-editable in place. "besides the first one,
  the way you add more references for a multiple choice is by dragging from
  the declaration there" — i.e.:
  - The **first** reference for a question is still typed/created normally
    (via the "+").
  - **Additional** options for a multiple-choice/branch are added by
    **dragging a block's declaration onto the question that should branch to
    it** — reusing the existing `moveLine`/`connectExisting` drag machinery,
    just as the *documented, intended* way to add options 2+, rather than
    manually typing more body lines.
  - Since reference lines are now immutable/gray, typing directly on them to
    rename should probably be disabled or at least visually discouraged —
    renaming still happens by editing the **declaration**, which cascades
    (existing `renameReferences` behavior), not by editing the reference
    text in place.
- **Only one visible "+"**: at the very bottom of the whole DSL text (to
  start a new discononnected/next top-level thought), **or** on a node that
  is empty (has no body at all) — matching roughly the existing
  `dsl-gutter-btn` logic (`b.type === "text" && !b.next && !b.terminal`) but
  now **the plus must NOT show on every empty leaf simultaneously if that
  reads as clutter** — re-read: "you just gotta limit the amount of pluses."
  Likely interpretation: keep one "+" per truly-empty node (unavoidable, it's
  the only way to give it a first reference) but the current implementation
  may be showing "+" buttons in more places than that (e.g. stray ones from
  recall-only blocks — there was a bug fix for this already, re-verify it's
  fully gone) — audit and strip to the minimum. Also: **remove the stray "+"
  at the bottom of the DSL editor except when the editor (or the node) is
  actually empty.** Currently there may be an unconditional trailing "+" —
  find and gate it.
- **Hover-to-reveal an × next to a reference**: hovering a reference line
  shows a small × on its right to remove just that reference (not delete the
  target block, just detach this particular reference/edge) — new affordance,
  doesn't exist yet.
- **New-node insertion point**: pressing "+" should insert the new node's
  declaration **immediately below the current position** in the raw DSL text,
  not appended at the very end of the document (current `appendNewBlock`
  always appends at the end — needs a variant that inserts after a given
  point, or `insertBodyLine`-adjacent logic applied to top-level block
  placement).
- **Drag-to-create-multiple-choice UX**: "When dragging, the new list of
  nodes should start with Yes -> … and No -> …, and put you into inline
  editing the first one 'yes' automatically, with a little return button that
  leads you to next, and clicking off stops editing." Spec: when a drag
  operation results in creating a **new** multi-option branch (i.e. the
  target question had 0 or 1 options and just gained enough to become
  `type: "choice"`), scaffold it with two placeholder options labelled
  `Yes -> …` and `No -> …` (using the `label > target` DSL shorthand,
  `…` as a placeholder target name or an empty/new block), then immediately
  enter inline text-edit on the first ("Yes") option with a small "return/
  next" button that tabs to editing the second option, and clicking outside
  ends editing (commits whatever's typed). This is a genuinely new
  interaction, not an existing one — build from scratch.

### 3f. Node canvas card cleanup
- **Remove the × delete button from canvas cards entirely** (was
  bottom-right). Deletion presumably still possible from the DSL editor
  (deleting the declaration line / block) — canvas is view-only now (§3d), so
  a delete affordance there doesn't fit the new "canvas is for seeing" model.
- **Move the recall control to the bottom-left of the node** (was
  middle-right). Given §3d folds recall into "click node → toggle memory
  enabled/disabled," this positioning may end up being where that toggle
  state is *indicated* (e.g. a small icon bottom-left showing current
  recall state) even if the *interaction* is a full-node click — clarify
  intent when building: is bottom-left a clickable recall toggle button, or
  just a status indicator now that the whole node is clickable? Read as: the
  visual recall indicator/button moves to bottom-left; whether it's still an
  independently-clickable hit target or purely decorative (with the real
  toggle being "click anywhere on the node") is ambiguous — lean toward
  keeping it as its own small button at bottom-left for a precise hit target,
  separate from the "click node for metadata" behavior in §3d, unless that
  turns out to feel redundant on-device.
- **Plus symbol vertically off-center** in its own button — pure CSS bug,
  audit `.dsl-gutter-btn` and `.canvas-ghost-plus` (and any other "+" button)
  for `line-height`/`display:flex; align-items:center; justify-content:center`
  correctness. Likely a `line-height: 1` vs. actual glyph baseline mismatch.

### 3g. Reflection screen
- **Text input font**: the reflection's answer textarea (`#answerField`,
  `.composer-input`) should be **sans** (i.e. the Geist/mono token, NOT
  Amiri serif) — currently likely inheriting the serif body default; needs an
  explicit `font-family: var(--mono)` override.
- **Change "committed. see you tomorrow." to "done. see you tomorrow."**
  (`#doneText` in `enterDone()`, `app.js` — also check any other literal use
  of "committed" in copy).
- **Reflection-persistence bug**: "desktop app for some reason switches back
  to editing mode on its own. If I left it reflecting it should stay
  reflecting, same with mobile. Unless it's been a while and it makes more
  sense to start a new one." This means something is calling `goHome()` or
  re-routing to the home/editor screen while a reflection is mid-flight and
  `draft.active` is true — likely a stray `routeAfterAuth()` or
  `_onSignedIn`/snapshot-listener re-render firing and not checking whether a
  reflection is currently open before repainting the home screen. Needs a
  guard: any of those re-entry points should check
  `document.getElementById('reflectScreen').classList.contains('on')` (or
  equivalent `draft.active && draft.phase` check) and no-op if a reflection is
  live, UNLESS enough time has passed that resuming a stale draft doesn't make
  sense (there's already `draft.day === todayKey()` staleness logic elsewhere
  in `resumePhase()` — reuse/extend that same "is this draft still today's"
  check here rather than inventing a new time threshold).

### 3h. Mobile reflection composer restyle
- The mobile reflection text box should look like the (now top-left,
  grow-downward per §3b) DSL editor: a **seamless toolbar below the text**,
  containing the continue/next and voice buttons.
- **Voice button floats** (no button chrome/background, just the icon,
  presumably like the wireframe-button treatment used elsewhere).
- **The next/send button stays filled** (solid background, unlike the voice
  button) — i.e. don't make everything wireframe, just the mic.

### 3i. Rendering/selection bug
- **"canvas and selection is currently broken"** — no further detail given.
  This needs on-device reproduction; can't be diagnosed blind. Prime
  suspects given the session's edit history: the `measureLineTops()` mirror
  technique for the DSL textarea (wrap-aware line positioning) interacting
  badly with the new line-drag handlers; the JS-margin canvas-centering
  fighting with drag-to-pan; or native text selection inside the DSL
  textarea being disrupted by the `mousedown` line-drag listener added late
  in the session (it starts tracking `_lineDrag` on every mousedown, which
  could be intercepting/corrupting normal click-to-place-caret or
  click-and-drag-to-select-text behavior — check whether the line-drag
  handler needs to distinguish "click near the very start of a line" (drag
  target) from "click anywhere in text" (normal caret/selection), since right
  now `_lineDrag` arms on **every** mousedown in the textarea). **This is
  probably the single highest-priority bug to chase first** since it likely
  explains "selection is broken."

---

## 4. Bugs — condensed checklist

1. Canvas: only 2D drag should move it — **kill native scroll**
   (`overflow: hidden` + fully JS-driven pan, or the drag handlers need
   `e.preventDefault()`/wheel-event suppression). Currently both work at once.
2. Canvas + text selection broken (§3i) — likely the DSL line-drag
   `mousedown` handler firing on every click, including normal text
   selection attempts. **Investigate first.**
3. `rc_notif_validated` local flag is read but **never written** — find
   `_markNotifValidated` call sites and set it there too.
4. Reflection state gets clobbered by a stray re-route back to home/editor
   (§3g) — needs an "is a reflection currently active" guard on whatever's
   calling `goHome()`/re-render mid-reflection.
5. Stray "+" buttons appearing in the DSL gutter where they shouldn't
   (§3e) — partially fixed earlier (recall-only blocks), re-audit for other
   cases now that the "only one + " rule is explicit.
6. Plus-button icon vertically off-center (§3f) — CSS `line-height`/flex-
   centering fix.
7. `_naming` popover code path (old "+"-opens-a-popover flow) is dead since
   "+" now creates immediately — never deleted, just orphaned. Clean up
   while doing the §3e/§3d canvas rewrite (a lot of that code is being
   replaced anyway).

---

## 5. Open decisions carried over (unresolved, don't guess)

- **LLM endpoint proxy**: shipping exposed on purpose per explicit
  instruction ("ship exposed, it's a free tier pool"). Not blocking, but
  flag again if the repo ever goes public — the key is live in client JS.
- **Pill header layout** (§3a) — streak/metric/pfp placement relative to the
  new split (commitment-pill-center + standalone-play-circle) needs a quick
  confirm before building if it's not obvious in context once you're looking
  at the actual on-device layout.
- **Recall bottom-left** (§3f) — clickable button vs. pure indicator, given
  §3d's "click node for metadata" already may cover toggling. Use judgment,
  flag if it feels redundant.
- **First-tree auto-trigger**: `maybeCompileMetaWalk()` exists and works if a
  user happens to walk `META_TREE`, but nothing currently loads `META_TREE`
  as the active tree for a brand-new signed-in user with an empty tree.
  Needs a check (probably in `_onSignedIn` or wherever the tree is first
  loaded) — `if (no blocks in current tree) setDslText(META_TREE)`.

---

## 6. Design tokens quick-reference (`app/style.css` `:root`)

```
--bg: #0a0a0b            /* darkest layer — page background */
--surface: #17171b       /* panes: editor, canvas */
--surface-2: #1f1f25     /* cards */
--surface-3: #26262d     /* pills, menus, popovers — lightest/highest */
--ink / --ink-dim / --ink-faint   /* text, descending emphasis */
--line: #2a2930          /* borders */
--purple: #c6c6cd / --purple-dim: #6b6b73   /* "on" accent — now just light gray, not purple */
--gold / --gold-dim      /* legacy accent, mostly unused now */
--serif: "Amiri", ...    /* all copy/UI text */
--mono: "Geist", ...     /* code surfaces + node-edit input — NOTE: sans, not monospace */
--syne: "Syne", var(--mono)   /* streak count, metric numbers only */
--corner-k: 2.2           /* squircle exponent, @supports corner-shape:superellipse */
--elev / --elev-sm        /* box-shadow pairs for raised surfaces */
```
Green (kept/positive) is ad-hoc `#3fa66b` / hover `#5ecb8b` (play button,
hold-yes, streak-lit accents) — not yet promoted to a custom property, worth
doing if it keeps getting reused.

---

## 7. Suggested order of attack for the new session

1. **Bug #2 (canvas/selection broken)** — highest priority, likely blocking
   the user from testing anything else properly. Reproduce, isolate the
   line-drag `mousedown` interaction, fix.
2. **Bug #1 (kill native canvas scroll, drag-only)** — quick, unblocks
   proper on-device testing of the layout changes coming next.
3. **§3b (DSL editor top-left, grows down)** + **§3a (pill header row,
   pill-shape correction, play button split out)** — these two are the
   biggest visible layout inversions; do them together since they both
   restructure the same top area of the screen.
4. **§3c (canvas fade edges)** — depends on §3b's final geometry being
   settled first (fade zones are relative to the editor's new position).
5. **§3d + §3e (canvas view-only, DSL decluttered, drag-to-add-options,
   line-highlight on declarations, gray/truncated references, hover-×,
   single "+" rule, insert-below-cursor)** — the biggest single chunk of
   remaining work, do as one coherent pass since they're all the same
   "declutter the editing model" effort and touch the same functions
   (`buildCardEl`, `renderDslPane`, `buildCanvas`).
6. **§3f (card cleanup: remove ×, recall bottom-left, plus-centering fix)**
   — small, do alongside #5 since it's editing the same card-rendering code.
7. **§3g/§3h (reflection: sans input, "done" copy, mobile composer restyle,
   persistence bug)** — separate subsystem, can be done independently/in
   parallel with the canvas work.
8. **Bugs #3, #5, #7 (notif-validated write-side, stray pluses, dead
   `_naming` cleanup)** — sweep these in as you touch the relevant files
   for the items above; don't need a dedicated pass.
9. **First-tree auto-trigger** (§5) — small, do once the rest is stable.

Verify each chunk with `node --check` (JS) and a brace-count script (CSS)
before committing, exactly as done all session — see the workflow note at
the top of this doc. Commit in small batches via `SendUserFile` +
`device_commit_files({force: true})`, same pattern throughout. **Nothing in
this session was click-tested in a real browser** — budget time for the user
to actually run the app and report back before assuming any single batch is
correct.

---

## 8. Chunk 9 (this session, follow-up to chunk 8) — §3g/§3h + bug sweep + first-tree

Continuing top-down after chunk 8's corrections shipped:

**§3g reflection screen — all three items done:**
- `.composer-input` (`#answerField`) now `font-family: var(--mono)` (the
  Geist sans token — the name is misleading, see `:root`) instead of
  inheriting the serif body default.
- `enterDone(true)`'s text changed from `"committed. see you tomorrow."` to
  `"done. see you tomorrow."` in `app.js`, plus the matching static fallback
  text in both `index.html` and `app-index.html`.
- **Root-caused the reflection-persistence bug.** Two separate `focus` event
  listeners existed: one properly guarded (`app.js` ~L379, only re-routes if
  `landingScreen` is currently on), and a second, unguarded one —
  `maybeRecheckStandalone` — that called `routeAfterAuth()` on **every**
  window focus with no screen check at all. On desktop, once mobile
  onboarding is complete, `routeAfterAuth()`'s final branch is
  `enterHome()`, which unconditionally does `showScreen("homeScreen")` —
  wiping whatever screen was on, reflection included. So: refocus the
  window mid-reflection → silently bounced to the editor. Fixed by adding a
  guard at the very top of `routeAfterAuth()` itself (covers every call
  site, not just this one): no-ops if `reflectScreen` is on AND
  `draft.active && draft.phase !== "done" && draft.day === todayKey()` —
  the same "is this draft still today's" check `resumePhase()` already
  uses elsewhere, so a genuinely stale draft still routes normally.

**§3h mobile composer restyle — done, applied to both device widths** (the
composer markup isn't otherwise device-split, so this affects desktop too —
flag if that's not wanted): `.composer-bar` is now one seamless rounded box
(background/border live on the container itself, not the textarea) with the
text on top and a `.composer-toolbar` strip below it holding voice (left,
`.composer-mic` — now bare icon, no border/background at all) and send
(right, `.composer-send` — unchanged, stays filled/solid). HTML restructured
in both `index.html` and `app-index.html` identically; `#answerField`,
`#micBtn`, `#sendBtn`, `#composerBar` ids all preserved so no JS changes
were needed beyond the font-family/copy fixes above.

**§4 bug checklist — items 5 and 7 closed out:**
- #5 (stray "+" audit): re-verified — the gutter-"+" logic in
  `renderDslPane` only has two sources (one per truly-empty leaf, one fixed
  button at the document end), both already correctly scoped. No strays
  found; this item was already resolved by the chunk-7 §3e work, just
  hadn't been checked off.
- #7 (dead `_naming` popover): confirmed genuinely dead — `_naming` was
  declared, read, and reset to `null` in a few places but **never once
  assigned a truthy value** anywhere in `dsl-editor.js`. Removed the state
  variable, the ~25-line render branch in `renderDslPane` that built
  `.canvas-naming` off it, the now-orphaned `.canvas-naming`/`.canvas-naming
  input` CSS rules, and a stale reference to that class in a `.closest()`
  selector guard. New nodes are created and renamed entirely through
  `_editingName`'s inline flow now (see startPlusDrag's `onUp`) — this was
  just leftover from before that flow existed.

**First-tree auto-trigger — built, plus a real parity bug found along the
way:**
- `js/meta-tree.js` (defines `window.META_TREE`/`compileQuestionsToTree`)
  was only ever `<script>`-included in `app-index.html` (the mobile/
  Capacitor build) — **the web build's `index.html` never loaded it at
  all**, so `window.META_TREE` was `undefined` there and
  `maybeCompileMetaWalk()` would have silently failed with no visible
  error on web. Added the missing `<script>` tag to `index.html`, same
  position as `app-index.html` (after `tree-model.js`, before
  `dsl-editor.js`).
- New `maybeSeedFirstTree(text)` in `app.js`, called from the top of
  `window._onTreeUpdated` (fires whenever the Firestore tree doc updates,
  including the very first snapshot after sign-in): if `TM.parse(text)`
  yields zero blocks AND a one-time local flag
  (`localStorage['rc_metatree_seeded']`) hasn't been set yet, it calls
  `window.setDslText(window.META_TREE)` and sets the flag. Gated on that
  flag (same pattern as `rc_seen_intro`) specifically so a **returning**
  user who later empties their own tree on purpose doesn't get silently
  re-seeded — only a genuinely brand-new user with an empty remote doc gets
  auto-loaded into the onboarding meta-tree. Self-correcting across
  multiple devices too: by the time a second device's first snapshot
  arrives, the first device has already written real blocks, so
  `blockCount > 0` there regardless of that device's own local flag.

**Task list status after this chunk:** #8 (drag-to-add-options +
drag-to-create-choice) is the only item still open — deliberately deferred,
see §3e above for why. Everything else in the original §7 suggested order
is done and shipped. **Still nothing has been click-tested in a live
browser this entire multi-session effort** — this is the single biggest
open risk across all of it, not any specific feature.
