# wisdom_tree — UI + mechanics update: implementation plan

Grounded in a full read of `app/js/app.js`, `dsl-editor.js`, `tree-model.js`,
`meta-tree.js`, `style.css`, `index.html`, `docs/new-plan.md`, and the design
discussion that produced the decisions below.

---

## 0. Thesis & what this supersedes

**Working thesis (the easier form):** *deciding what you want gives you
infinitely more potential energy; action is just its discharge.* So there is **no
separate "bias to action" problem to solve** — the bottleneck to action is
*undecided wanting* (the bounce, wants competing, none crystallized). The app's
whole job is to remove undecided wanting by asking **decision-forcing questions**.
The energy takes care of itself.

Two hard constraints that fall out of this:
- **The skill stays with the user.** The app never detects the charged moment,
  never tells you to "go." Knowing you're charged *is* the skill; automating it
  steals it. (This kills the earlier auto-detect-ignition idea.)
- **Automate transcription, never introspection** (`new-plan.md`'s test). The one
  LLM in the app only *transcribes* the want you converged on; it never builds the
  tree or judges your questions.

**Supersedes `new-plan.md` on two points, deliberately:**
- Adds **one narrow LLM** — reading the reflection transcript for the thing you
  decided you want. Transcription, not introspection; stays on the right side of
  the doc's own line.
- Adds a **streak that counts closed loops** (deltas, not usage) — still the
  "commitments kept" number the doc already endorses, just visualized.

**And kills the commit card outright** (see §1) — it has never worked once.

---

## 1. Reflection flow change (the biggest mechanic change)

### Remove the commit stage
`index.html`'s `phaseCommit` (the `commitField` textarea + `commitDueSelect`
future-date + hold-to-commit ring) is **deleted**. It's ceremony that lands
*after* the peak: at the instant you're charged it makes you stop, type a formal
sentence, and pick a date — converting hot energy into a cold administrative task
and catching only the cooled want. That's why it's died every time.

### Replace it with convergence capture + a passive layup
- **Capture, not commit:** when a reflection ends, the LLM reads the transcript
  for the **thing you decided you want** — the want that got escape energy — with
  no card, no typing, no date. (`draft.history` already holds the ordered Q/A.)
- **The user leaves when *they* know they're charged** — the app doesn't detect or
  command it. Reflection just ends (they exit, or run out of questions).
- **Loop closes via a passive layup, never a push:** on return, the decided want
  is waiting as a **single green tap = "did it"** (or it goes **gray X = didn't**).
  Because the want was auto-captured, closing the loop is one tap, no re-typing.
- **There is no "did you do it?" notification** — that's backward-looking, can
  only produce guilt or nothing, and generates no action. Confirmation is always
  *passive and in-app* (the layup); notifications are always *forward-pull* (§3).
- **Streak = closed (green) loops.** Same data as before
  (`commitments.filter(status==='done')`), just no longer gated on a commit card.

---

## 2. The pill — `play · decided-want · streak · pfp`

To the left of the account pfp on the node canvas.

### Content & interaction
- Shows the **decided want** (LLM-captured — *the last thing you said you'd do or
  even mentioned*, recency-biased, low bar). Empty state: **"no commitments to
  show."**
- Collapsed to just a **`›` chevron** by default; opens in **two dimensions** —
  horizontally first (truncated want), then vertically (the list). The text
  dimension **auto-opens if you've been away a while**.
- **Dropdown = resolved items only.** Green check / gray X on the **right**;
  **overwritten wants stay** in the dropdown with their mark; **gray "not done"
  entries drop** rather than pile up. **Never shows a stale/pending item** — it's
  a record of *closed loops*, not an open-loop todo list.
- **Mobile:** always open to text + streak (never collapsed to the chevron).

### Streak (per §0/§1)
Follow-through-lit flame — **cumulative count of closed loops** (can't be
"broken," so no loss-aversion). **No nags, no push about it, no celebration.**
Custom flame SVG; **gray at 0**; number in **Syne**; its own circular pill, right
of the want text.

### Endpoint
```
POST http://34.26.134.74:3001/v1/chat/completions   (OpenAI-compatible)
Authorization: Bearer sk-bf-…   model: free-agent-pool
```
> ⚠️ **Unverifiable from the build sandbox** — its egress proxy only allowlists
> Anthropic + package registries, so this IP:3001 times out at TCP connect. Says
> nothing about your machine/app. **Test from the app, and check CORS** (client
> `fetch`). **Open decision:** proxy the call server-side (recommended — a browser
> fetch exposes the bearer token in devtools) or ship the token exposed for now.
> Also rotate the hardcoded key in `modal_deployment/app.py` before going public.

Prompt: "From this reflection transcript, extract the **last** concrete thing the
person said they would do, or even mentioned doing. One short imperative line. If
none, reply exactly NONE." Parse `NONE` → empty state.

---

## 3. Notifications (new model)

**General rule — every notification is exactly one of two archetypes:**
1. **"I'm trying to help you IRL — tap to let me."** → routes to the
   do-everything-bot. Until the bot ships, **tapping leads to a coming-soon
   screen.** When it ships, this becomes **"want me to start *X*?"** for the
   highest-leverage blocker the bot can remove.
2. **"Here's your IRL change — come do it again."** (mirror + replicate).

**Keep the nightly reflect-reminder heartbeat** — but its copy is archetype 2 and
its content is **staged on the churn cliff:**

- **A current work-run exists:** the **question that started your current
  explosion** — the question from the reflection whose decided want kicked off
  your current streak of closed loops. Not the static star (goes stale into a
  rando); not per-question scoring (questions build momentum as a sequence). Just
  *which reflection began the run you're on* → show its question.
- **No run yet (cold start / the churn-cliff zone):** the **most recent decided
  want, in the user's own words + why it mattered** (LLM from the last session).
  This is the *intention*-mirror — the strongest thing sendable with **zero IRL
  data**, which is all you have before loop #1.
- **True day 0:** the onboarding-declared aim as the seed.

### The cliff = the archetype flip (this resolves the "no IRL data" problem)
The only pre-bot source of IRL data is the user's own check-in, so **results
don't exist until loop #1 closes.** Therefore:
- **Before loop #1:** intention-mirror (decided want + why).
- **After loop #1:** **results-mirror** — "you turned *X* into done in *N* hours;
  here's your rate — go again." Evidence, not exhortation. Evidence doesn't churn.

**The churn cliff is exactly the line where notifications flip from intention to
results.** So the retention game is *getting the user to close loop #1 as fast as
possible* — optimize the onboarding→first-action path above any notification copy.

### Droughts
Not a "come back" nag — re-present the **explosion-starter question** (the
question that began your current/last run), or, cold, the last decided want. Pull
with the memory of the app working, never with guilt about the absence.

---

## 4. The primary metric — want→done

Measured in-app, the honest scoreboard for "intensity of work on things you want":
- **Want→done latency** — median time from when a want was first *mentioned* (LLM
  timestamp) to *done* (check-in timestamp). Falling = you close the gap faster.
- **Conversion rate** — of the wants you voice, the fraction that ever get done.

Both are free from timestamps already captured, and — the key property — **only
real action can move them** (opening the app can't). This is the "rate of change"
the results-mirror notification references.

---

## 5. Questions — the quality bar and how the tree grows

- **The quality bar is one test:** *does answering this force you to decide what
  you want to do* (ideally something actionable now)? Your own tree passes it —
  every question ends in a decision ("plan for tomorrow," "what would make you
  work faster," "what to watch *today*"). The failing style makes you *think*
  without making you *decide*. This is the skill the **meta-tree teaches at
  authoring time** — the leverage lives in how the question is written.
- **Growth is *sequence* refinement, not "branches."** Your tree is a **personal
  ignition sequence** — an ordered set of behavioral prompts that walks *you* from
  bounce to escape velocity. Forks are rare; growth means inserting/sharpening a
  prompt the sequence lacked (the flywheel), sourced from your own lived reality,
  authored by your own hand, at/above the rate of reflection. Drop the word
  "branch" for this content.
- **Don't score questions individually** — they build momentum together (question
  1 rarely "works" because it's the runway). Pruning is a **late-game,
  user-authored** move (cutting is only high-leverage when the writer does it).
  The **day-1 loop is growth + witnessing your own convergence** (the app naming
  the want that got escape energy tonight) — that's the "it caught the thing I
  actually care about" moment that earns night two.

---

## 6. First tree (onboarding meta-tree)

A new user has no tree, and authoring is desktop-only — so there **must** be an
explicit path to the first one. The mechanism exists and is verified; only the
walk UI + entry point are missing.
- `meta-tree.js` ships `META_TREE` + `compileQuestionsToTree(answers)` — a
  **deterministic, no-LLM** compiler (verified against `TreeModel`).
- **Wire:** the 3-step walk UI → `setDslText(compileQuestionsToTree(answers))`.
- **Where it runs:** the walk reuses the reflection composer/voice, which **works
  on mobile** — so *answering guided questions = fine on the phone; authoring raw
  structure = desktop.* A phone-first user can still build their first tree.
- **Teach the quality bar here** (§5): the walk should produce decision-forcing
  questions by example.
- **Entry point:** auto-trigger on an empty tree; offer again from the account
  menu ("start a new tree"). Keep `LAB_STUDENT_EXAMPLE` as a worked example and
  `starter-trees.js` adopt-one only at the exit (per `new-plan.md` Phase B).

---

## 7. Mobile → read-only

"No editing" = **no tree/DSL authoring** on mobile. The **nightly reflection flow
still fully works** (answering, the passive layup, check-in) — it needs input and
is the whole point of the phone.

### Mobile home layout (top → bottom)
- **Big circular play button, centered** at the top — green wireframe. Starts
  tonight's reflection.
- **Commitment pill at ~45% of height**, always open to text + streak.
- **Read-only node tree below the pill, rendered vertically.** The
  past-commitments list **overlays** the tree when the pill opens (no reflow).
- **Bottom: pfp + streak share the middle** (centered together).
- Reflection-time control and the "edit on desktop" line live with this area.

### Reflection "switch to desktop" copy + auto-open
- Bottom-of-reflection button (`continueDesktop`, now "easier on your computer ›")
  → **"if you switch to desktop, you'll get better ideas with the up-right."** The
  **↗** raises the mobile veil and moves the reflection to desktop.
- **Auto-open on desktop (worth doing):** the hand-off sets the live draft flag
  desktop already listens to (`_onDraftUpdated`) and/or fires a push; desktop then
  calls `openReflection()` itself, exactly like `maybeOpenFromUrl()` already does
  for a `?reflect=1` notification click. Park on mobile → desktop wakes into the
  reflection.

---

## 8. Bugs (fix first — these break the core loop)

- **8a. Notifications not gated on first launch.** First mobile login "just let me
  in"; the notify-time + permission step only appeared the *second* open, then
  kept reappearing with notifications already on. Root cause is the first-run
  routing/flags around `goToInstallGate` → `goToMobileNotifySetup` and the
  `mobileOnboarded()` / `notifValidatedAt` state — the gate both skips when it
  should show and re-shows when it shouldn't. Fix: a hard, once-only gate keyed on
  a persisted `notifValidatedAt`, checked on every entry, satisfied exactly once.
- **8b. QR never appears.** `maybeShowOtherDeviceGate()` sets `qr.src` to the
  external `api.qrserver.com`; if that image fails, the QR is silently absent. Fix:
  **generate the QR locally** from a bundled lib — removes the failure mode and a
  network dependency.

---

## 9. DSL editor & node editor

Much of this **already exists in the model layer** — mostly wiring, one mode to
delete, and polish.

- **Already in `tree-model.js` (keep):** DSL drag-reorder (`moveLine`); editing
  any reference or the declaration cascades everywhere
  (`renameReferences`/`renameBlockTitle` + `_cascadeRenameIfHeaderEdited`).
- **Two-way node ↔ DSL binding (new wiring):** editing a node jumps to its
  declaration and vice-versa; each declaring/referencing **line gets a full-width
  line-highlight band** (not a text selection). Data is all present (`rawLine`,
  `referenceTargetOf`, `sourceInfoAt`).
- **Recall menu redesign:** plain menu, **checkmark on the selected option
  (right)**, single-select. Remove the "recall answers from" header and the
  "none" option; **default-check the current node**; button is **purple when on,
  click again to turn off** (`setRecall(…, null)` already handles off).
- **Plus creates a node immediately, inline.** Kill the divergent naming-popover
  path; "+" always makes a generic node and drops into an inline editor in place.
- **Node editor layout/type:** right **40%** (not 60%); **vertically centered**;
  **even margins** to the node boundary; card text in **Source Serif 4 when not
  editing**, mono while editing; hovering "+" makes the path to the hypothetical
  node **solid + slightly bold**.
- **Copy/delete pill (resolves the "broken left copy button"):** that button is
  actually the **paired-editing toggle** (`pairedEditingBtn`) — its two-rectangles
  icon just reads as copy, and it copies nothing. **Delete the toggle, make the
  cascade always-on** (already the default, and what you want). Keep **one working
  copy button + an x button that deletes everything**, both in **a pill**.

---

## 10. History — per-tree diffs, permanent

Today: whole-tree snapshots at random char thresholds, in-memory only (lost on
reload). **Decided:** **per-tree diffs, permanently persisted** (local +
Firestore, like `draft`/`commitments`) — survives reloads, syncs across devices.
Scrubbing replays diffs. Drop the random threshold (snapshot on meaningful edit
boundaries).

---

## 11. 10× simplifications (delete crud)

1. **Delete ~130 lines of dead preview machinery** in `dsl-editor.js`
   (`_preview`, `renderPreview`, `previewNode`, `previewComputeNext`,
   `previewAdvance`, `closePreview`, `previewEscapeHtml`, `treePreviewModal`) —
   `startPreview` was rewritten to open the real reflection and never calls any of
   it.
2. **Remove the paired-editing mode** (§9) — toggle + `_pairedEditing` + the two
   divergent code paths collapse into "cascade always on." Kills the fake copy
   button too.
3. **Stop rendering the editor on mobile** (§7) — the mobile pane switcher and
   every `mobile()` branch delete in favor of one read-only vertical render.
4. **Delete the commit stage** (§1) — `phaseCommit` + `commitDueSelect` +
   `onCommitDueChange` + the commit hold wiring.
5. **Consolidate the two "new node" paths** into one (§9).
6. **Drop the external QR dependency** (§8b) — generate locally.
7. **History: kill the random-threshold, in-memory, whole-tree model** (§10).
8. **Collapse duplicated notif-permission handlers** (`notifSetupContinue` ≈
   `requestNotifPermissionOnboard`) and the long landing sub-pane chain while
   fixing §8a.

---

## 12. Security
Rotate the hardcoded key in `modal_deployment/app.py` and the LLM bearer token
before this repo is public or the token ships in client JS. Prefer proxying the
LLM call through your own backend so the token never reaches the browser.

---

## 13. Rapid-fire UI polish (compact)
- **Lift `--bg` off pure black** (`#0a0a0b` reads as a black hole) to a soft
  near-black gray so curved elements carry a **subtle shadow**; add that shadow.
- **Unify corner radii** everywhere; pin the **account chip to the exact top-right
  corner of the node canvas, matching its radius.**
- On a node: **recall middle-right, x bottom-right.**
- **Flame SVG**, gray at 0, number in **Syne**; **green** play button left of the
  want text; ensure **Syne + Source Serif 4** are loaded.

---

## 14. Build order

1. **Bugs** — §8a notification gate, §8b QR. Ship alone; they break the loop.
2. **Simplification sweep** — §11 items 1–4 (dead preview, paired-editing mode,
   mobile editor, commit stage). Pure deletion; shrinks everything after it.
3. **Reflection flow** — §1 (convergence capture + passive layup) and §7 mobile
   (falls out of #2).
4. **First-tree walk** — §6.
5. **Streak** — §1/§2 (small; anchors the pill).
6. **Commitment pill + notifications** — §2, §3. Gate the LLM behind a verified
   endpoint test + the proxy decision (§2/§12). Ship the coming-soon screen for
   archetype-1 notifications now.
7. **Metric** — §4 (want→done latency + conversion).
8. **DSL/node editor** — §9; then **history** §10.
9. **Polish** — §13, batched.

**One decision still open:** proxy the LLM endpoint server-side, or ship with the
token exposed for now (§2/§12)? Everything else is specified and unblocked.
