// ── Reflection streak: consecutive days with at least halfway-through a reflection ──
// Reads window._userRuns (life-level, synced across every tree by firebase-init.js) —
// a day "counts" toward the streak if any run saved on it made real progress (at least
// one step answered), not only fully-completed-and-committed runs — autosave persists
// a run's steps well before it's marked complete, so "got halfway through" is enough.
function _streakDayKey(ts) {
  const d = new Date(ts);
  if (isNaN(d)) return null;
  return d.toISOString().slice(0, 10);
}
function _reflectedOn(r) {
  return !!(r && r.steps && r.steps.length > 0 && r.savedAt);
}

function computeStreak() {
  const runs = window._userRuns || [];
  const days = new Set();
  runs.forEach((r) => {
    if (!_reflectedOn(r)) return;
    const k = _streakDayKey(r.savedAt);
    if (k) days.add(k);
  });
  if (!days.size) return 0;

  let cursor = new Date();
  cursor.setHours(0, 0, 0, 0);
  let key = cursor.toISOString().slice(0, 10);
  if (!days.has(key)) {
    // today hasn't happened yet — the streak stays alive as long as yesterday counts
    cursor.setDate(cursor.getDate() - 1);
    key = cursor.toISOString().slice(0, 10);
    if (!days.has(key)) return 0;
  }
  let streak = 0;
  while (days.has(key)) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
    key = cursor.toISOString().slice(0, 10);
  }
  return streak;
}

// has today itself already been reflected on — independent of the streak's grace
// period, which lets the *count* stay alive into the next day before you've reflected.
function hasReflectedToday() {
  const runs = window._userRuns || [];
  const todayKey = _streakDayKey(new Date());
  return runs.some((r) => _reflectedOn(r) && _streakDayKey(r.savedAt) === todayKey);
}

function renderStreak() {
  const n = computeStreak();
  const extendedToday = hasReflectedToday();
  document.querySelectorAll(".streak-pill").forEach((pill) => {
    const num = pill.querySelector(".streak-n");
    if (num) num.textContent = n + " day streak";
    pill.classList.toggle("on", extendedToday);
    pill.title = !n
      ? "reflect today to start a streak"
      : extendedToday
        ? n + " day" + (n === 1 ? "" : "s") + " in a row — logged today."
        : n + " day" + (n === 1 ? "" : "s") + " in a row — reflect today to keep it alive.";
  });
  updateStreakHelpLayout(n);
}

// ── streak / help swap ──────────────────────────────────────────────────────────────
// Same top-bar slot, one or the other: a 0 streak shows the help "?" button; the moment
// there's any current streak the pill takes its place instead — grayed out until today
// extends it (see .streak-pill.on above), lit up orange once it has.
function updateStreakHelpLayout(n) {
  const streak = typeof n === "number" ? n : computeStreak();
  const streakPill = document.getElementById("streakPill");
  const topHelpWrap = document.querySelector(".top-bar .help-btn-wrap");
  if (streakPill) streakPill.style.display = streak > 0 ? "" : "none";
  if (topHelpWrap) topHelpWrap.style.display = streak > 0 ? "none" : "";
}

// recompute whenever the data that could move it changes
(function () {
  const origOnRunsUpdated = window._onRunsUpdated;
  window._onRunsUpdated = function (treeId) {
    if (origOnRunsUpdated) origOnRunsUpdated(treeId);
    renderStreak();
    setTimeout(renderStreak, 900); // life-level "runs" listener can land a beat later
  };
  const origOnTreesUpdated = window._onTreesUpdated;
  window._onTreesUpdated = function () {
    if (origOnTreesUpdated) origOnTreesUpdated();
    renderStreak();
  };
})();

document.addEventListener("DOMContentLoaded", renderStreak);
renderStreak();
