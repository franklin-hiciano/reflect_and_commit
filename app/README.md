reflect & commit is a simple system where you write questions for yourself that prompt a specific response, which generates ideas that preferably improve your life. you reflect because you it will lead to an improved day tomorrow. your job as the user is to generate a tree that gets you to guide a specific behavior throughout your life. as you adopt the behaviors you want, modify your tree to increase output quality. outcome quantity is tracked and enforced, though idea and output quality increases are always welcomed through iterative editing of your tree. it's called system prompt because you are building your principles into a machine that prompts YOU.

[use Reflect and Commit](https://franklin-hiciano.github.io/reflect_and_commit/)

devlog/roadmap:
- [x] cloud sync
- [x] reminders
- [x] inline from other nodes during a time range
- [x] add story nodes
- [x] make tree repo and public stories
- [x] outcomes attribution graph, outcomes screen, daily reflection streak
- [ ] implement features for update 0.1
- [ ] make tree for converting slack to more high leverage work (original intention), make tree for doing this with prompts (move slack to higher ideas/better ai usage)
- [ ] enfore outcome quantity
- [ ] tree improvement mode, keeps the canvas as the default screen
- [ ] make it so that responses don't delet if you go back
- [ ] ask claude to help you with framer and branding. video, audience, funnel, selling, etc.
- [ ] my trees screen
- [ ] less ui, mobile back button. tell claude saving nodes should be automatic
- [ ] paywall
- [ ] edit pfp
- [ ] make sure notis work
- [ ] start using behavioral pattern detection

how to use: tap **+** anywhere in the question list to drop in a new question, drag the `⋮⋮` handle to reorder, tap **+path** to split a question into yes/no, tap **↺** to make a question recall its own past answers, and tap the star to mark tonight's minimum (the reflection can stop there and offer to commit). None of that requires typing any syntax — the graph above the list redraws itself after every change so you can see the shape of the tree instead of holding it in your head.

Under the hood every tree is still just plain text (this is what "paste tree" / "copy as text" round-trip), in case you ever want to write one somewhere else or keep a backup:

```
# a question is a line. indent a line under it to branch.
this is a multiple-choice question
  option 1
    this is what happens after option 1
  option 2
    this is what happens after option 2

this is a plain question with one thing after it
  this happens next

this is a question with nothing after it — it just ends the reflection
```

Two things you don't need but exist if you want them: `label >> next question` on one line is shorthand for writing the label and its follow-up as two separate lines (handy for short trees), and `recall` on its own line under a question makes it recall its own past answers. A bare `>> done` (or just `done`) explicitly ends a path — you don't have to write it, since a path with nothing left just ends the same way, but it's there so you can say "this is supposed to stop here" and have it confirmed rather than re-derived.

You'll basically never need any of this to actually use the app — it's an export format, not the main interface.
