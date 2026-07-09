# wisdom_tree

A reflection app built on one thesis: **reflection drives agency** — mapping your
own problems and paths to failure is a skill, and doing it turns ideas into
action. No streaks; you come back for the gains. Success is measured in deltas
(commitments kept), not usage.

You build a tree of questions (raw DSL text is the single source of truth), then
walk it nightly: answer, commit to one thing, check in the next day.

## Layout
- `app/` — the PWA. Runtime `app/js/app.js`, DSL grammar `app/js/tree-model.js`,
  editor `app/js/dsl-editor.js`, onboarding meta-tree `app/js/meta-tree.js`,
  starter scaffolds `app/js/starter-trees.js`.
- `docs/new-plan.md` — current product direction: lower the friction to a
  personalized reflection (meta-tree onboarding), keep the mapping skill with the
  user. Start here for app work.
- `install/` — PWA install landing page.
- `api/`, `sw.js`, `manifest.json` — notifications / PWA plumbing.
