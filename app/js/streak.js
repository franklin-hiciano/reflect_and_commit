// ── Duolingo-style streak widget ──────────────────────────────────────────────
// Computes a daily reflection streak from window._userRuns (set by firebase-init).
// Renders a flame + count in the top bar, exactly like Duolingo.

function getStreakData() {
  const runs = window._userRuns || [];
  if (!runs.length) return { streak: 0, doneToday: false };

  // Collect unique calendar days (UTC midnight) that have at least one run
  const daySet = new Set();
  runs.forEach(r => {
    const d = r.savedAt ? new Date(r.savedAt) : null;
    if (!d || isNaN(d)) return;
    // key = YYYY-MM-DD in local time (matches user's perception of "today")
    const key = d.toLocaleDateString('en-CA'); // gives YYYY-MM-DD
    daySet.add(key);
  });

  const todayKey = new Date().toLocaleDateString('en-CA');
  const doneToday = daySet.has(todayKey);

  // Walk backwards from today (or yesterday if not done yet) counting streak
  let streak = 0;
  let check = new Date();
  check.setHours(0, 0, 0, 0);
  // If not done today, start counting from yesterday
  if (!doneToday) check.setDate(check.getDate() - 1);

  while (true) {
    const key = check.toLocaleDateString('en-CA');
    if (!daySet.has(key)) break;
    streak++;
    check.setDate(check.getDate() - 1);
  }

  return { streak, doneToday };
}

function renderStreak() {
  const { streak, doneToday } = getStreakData();

  const numEl = document.getElementById('streakNum');
  const pillEl = document.getElementById('streakPill');
  const checkEl = document.getElementById('streakCheck');

  if (!numEl || !pillEl) return;

  numEl.textContent = streak;

  // Flame state: orange = active streak, gray = no streak
  const active = streak > 0;
  pillEl.classList.toggle('streak-active', active);
  pillEl.classList.toggle('streak-dead', !active);

  // Checkmark: visible only if done today
  if (checkEl) checkEl.style.display = doneToday ? 'flex' : 'none';
}

// Hook into the existing runs update cycle
const _origOnRunsUpdated = window._onRunsUpdated;
window._onRunsUpdated = function (treeId) {
  _origOnRunsUpdated && _origOnRunsUpdated(treeId);
  renderStreak();
};

// Also run on auth/init once data may already be loaded
setTimeout(renderStreak, 500);
