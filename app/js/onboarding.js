// ── First-run teaching card: most forks don't matter, a few change everything ─────
// Shown once per browser, right after sign-in. The message: the tree's job is to help
// you tell low-leverage forks (barely move you) apart from high-leverage ones (change
// everything) — and to act on the latter while they're still open.
const _CC_KEY = 'rc_compound_seen';

window._dismissCompoundCard = function () {
  const card = document.getElementById('compoundCard');
  if (card) card.classList.remove('on');
  try { localStorage.setItem(_CC_KEY, '1'); } catch (e) {}
};

window._maybeShowCompoundCard = function () {
  try { if (localStorage.getItem(_CC_KEY) === '1') return; } catch (e) {}
  const card = document.getElementById('compoundCard');
  if (!card) return;
  // only over the app itself — never on top of the auth or paywall screens
  const auth = document.getElementById('authScreen');
  if (auth && !auth.classList.contains('hidden')) return;
  const pw = document.getElementById('paywall');
  if (pw && pw.classList.contains('on')) return;
  card.classList.add('on');
  if (!card._bound) {
    card._bound = true;
    // tap the backdrop to dismiss
    card.addEventListener('click', e => { if (e.target === card) window._dismissCompoundCard(); });
  }
};
