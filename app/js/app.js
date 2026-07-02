// Reflect & Commit — flat question-list rewrite.
// No tree/branching/DSL. One ordered list of questions, walked in sequence.
// Everything persists locally (instant) and to Firestore (debounced) so a
// half-typed answer is never lost, on this device or any other.

const LS_DRAFT = "rc_draft_v2";
const LS_QLIST = "rc_questions_v2";
const LS_SETTINGS = "rc_settings_v2";
const LS_LASTNOTIF = "rc_last_notif_v2"; // {sentAt, source:'schedule'|'manual'}

let questions = [];
let settings = { notifyTime: "20:00" };
let draft = { answers: {}, index: 0, active: false };

// ---------- local persistence (instant, works offline / pre-sync) ----------
function loadLocal() {
  try { questions = JSON.parse(localStorage.getItem(LS_QLIST) || "[]"); } catch (_) { questions = []; }
  try { settings = JSON.parse(localStorage.getItem(LS_SETTINGS) || "null") || settings; } catch (_) {}
  try { draft = JSON.parse(localStorage.getItem(LS_DRAFT) || "null") || draft; } catch (_) {}
}
function saveLocalQuestions() { localStorage.setItem(LS_QLIST, JSON.stringify(questions)); }
function saveLocalSettings() { localStorage.setItem(LS_SETTINGS, JSON.stringify(settings)); }
function saveLocalDraft() { localStorage.setItem(LS_DRAFT, JSON.stringify(draft)); }

loadLocal();

// ---------- firestore hookup (fires once signed in) ----------
window._onQuestionsUpdated = () => {
  if (window._questions && window._questions.length) {
    questions = window._questions;
    saveLocalQuestions();
    renderQuestionEditor();
  }
};
window._onSettingsUpdated = () => {
  if (window._settings && window._settings.notifyTime) {
    settings = window._settings;
    saveLocalSettings();
    renderSettings();
  }
};
window._onDraftUpdated = () => {
  const rd = window._remoteDraft;
  if (rd && rd.active && (!draft.active || (rd.updatedAt && !draft._localTouch))) {
    draft = { answers: rd.answers || {}, index: rd.index || 0, active: true };
    saveLocalDraft();
  }
};
window._onSignedIn = () => {
  renderQuestionEditor();
  renderSettings();
  scheduleNotificationLoop();
  routeAfterAuth();
  maybeOpenFromUrl();
  if ("Notification" in window && Notification.permission === "granted") {
    window._registerPush && window._registerPush();
  }
};

// ---------- install flow: mobile PWA only, no desktop app ----------
// Desktop browser -> "get started" shows a QR code linking to this page so you
// can install on your phone. Mobile browser -> "get started" triggers the
// native add-to-homescreen prompt directly (Android/Chrome; iOS Safari has no
// programmatic prompt, so it falls back to the same QR/link there too).
let deferredInstallPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
});

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}
function routeAfterAuth() {
  showScreen(isStandalone() ? "homeScreen" : "landingScreen");
}

window.onGetStarted = async () => {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    return;
  }
  const url = location.href.split("?")[0];
  document.getElementById("landingQrImg").src =
    "https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=" + encodeURIComponent(url);
  document.getElementById("landingQrWrap").style.display = "block";
  document.getElementById("getStartedBtn").style.display = "none";
};

// ---------- routing between the few screens ----------
function showScreen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("on"));
  document.getElementById(id).classList.add("on");
}
function goHome() { showScreen("homeScreen"); }

// opened via a notification click -> sw.js navigates to ?reflect=1
function maybeOpenFromUrl() {
  const params = new URLSearchParams(location.search);
  if (params.get("reflect") === "1") {
    history.replaceState({}, "", location.pathname);
    openReflection();
  }
}

// ---------- notification validity window ----------
const REFLECT_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours

function getLastNotif() {
  try { return JSON.parse(localStorage.getItem(LS_LASTNOTIF) || "null"); } catch (_) { return null; }
}
function setLastNotif(source) {
  localStorage.setItem(LS_LASTNOTIF, JSON.stringify({ sentAt: Date.now(), source }));
}
function withinReflectWindow() {
  const n = getLastNotif();
  if (!n) return false;
  return Date.now() - n.sentAt < REFLECT_WINDOW_MS;
}
function nextScheduledLabel() {
  const t = (settings.notifyTime || "20:00");
  const [h, m] = t.split(":").map(Number);
  const now = new Date();
  const next = new Date(now);
  next.setHours(h, m, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  const opts = { weekday: "short", hour: "numeric", minute: "2-digit" };
  return next.toLocaleString(undefined, opts);
}

// ---------- notification firing ----------
// Two paths:
//  1) client-side fallback below (only fires while this tab/PWA is alive) —
//     kept as a safety net so it still works today, before a server is wired up.
//  2) server push via functions/index.js + FCM (see project README) — arrives
//     even when the app is fully closed, once you deploy that function and this
//     page has registered a push token (registerForPush() below, best-effort).
function fireNotification(source) {
  setLastNotif(source);
  const title = "Time to reflect";
  const body = "Your questions are ready.";
  if (Notification.permission !== "granted") return;
  if ("serviceWorker" in navigator) {
    // .ready waits for an ACTIVE worker — .getRegistration() can return one
    // that's still installing, and showNotification silently no-ops on those.
    navigator.serviceWorker.ready.then((reg) => {
      reg.showNotification(title, { body, tag: "reflect" });
    }).catch(() => fallbackNotify(title, body));
  } else {
    fallbackNotify(title, body);
  }
}

function fallbackNotify(title, body) {
  // plain page-level Notification — doesn't route through sw.js's
  // notificationclick handler, so it needs its own click behavior here.
  const n = new Notification(title, { body });
  n.onclick = () => { window.focus(); openReflection(); n.close(); };
}

async function requestNotifPermission() {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  const p = await Notification.requestPermission();
  return p === "granted";
}

window.sendSelfNotification = async () => {
  const ok = await requestNotifPermission();
  if (!ok) { alert("Notifications are blocked — enable them in your browser/OS settings."); return; }
  window._registerPush && window._registerPush();
  fireNotification("manual");
  alert("Sent. Valid for 2 hours.");
};

let lastFiredDateKey = localStorage.getItem("rc_last_fired_date") || "";
function scheduleNotificationLoop() {
  setInterval(() => {
    const now = new Date();
    const t = (settings.notifyTime || "20:00");
    const [h, m] = t.split(":").map(Number);
    const dateKey = now.toDateString();
    if (
      dateKey !== lastFiredDateKey &&
      now.getHours() === h &&
      now.getMinutes() >= m &&
      now.getMinutes() < m + 2
    ) {
      lastFiredDateKey = dateKey;
      localStorage.setItem("rc_last_fired_date", dateKey);
      fireNotification("schedule");
    }
  }, 30000);
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
  navigator.serviceWorker.addEventListener("message", (e) => {
    if (e.data && e.data.type === "notif-confirmed") {
      setLastNotif("schedule");
      openReflection();
    }
  });
}

// ---------- HOME ----------
function renderSettings() {
  const el = document.getElementById("notifyTimeInput");
  if (el) el.value = settings.notifyTime || "20:00";
}
window.onNotifyTimeChange = (v) => {
  settings.notifyTime = v;
  saveLocalSettings();
  window._saveSettings && window._saveSettings({ notifyTime: v });
};

function renderQuestionEditor() {
  const list = document.getElementById("qList");
  if (!list) return;
  list.innerHTML = "";
  questions.forEach((q, i) => {
    const row = document.createElement("div");
    row.className = "q-row";
    row.innerHTML = `
      <input class="q-text" value="${escapeAttr(q.text)}" data-i="${i}" />
      <div class="q-icons">
        <button class="q-icon-btn q-recall-icon ${q.recall ? "on" : ""}" data-i="${i}" title="recall past answers">↺</button>
        <button class="q-icon-btn q-del-icon" data-i="${i}" title="remove">✕</button>
      </div>
    `;
    list.appendChild(row);
  });
  list.querySelectorAll(".q-text").forEach((inp) =>
    inp.addEventListener("input", (e) => {
      questions[+e.target.dataset.i].text = e.target.value;
      persistQuestions();
    })
  );
  list.querySelectorAll(".q-recall-icon").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      const i = +e.target.dataset.i;
      questions[i].recall = !questions[i].recall;
      persistQuestions();
      renderQuestionEditor();
    })
  );
  list.querySelectorAll(".q-del-icon").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      questions.splice(+e.target.dataset.i, 1);
      persistQuestions();
      renderQuestionEditor();
    })
  );
}
function escapeAttr(s) { return (s || "").replace(/"/g, "&quot;"); }
function persistQuestions() {
  saveLocalQuestions();
  window._saveQuestions && window._saveQuestions(questions);
}
window.addQuestion = () => {
  questions.push({ id: "q_" + Date.now(), text: "", recall: false });
  persistQuestions();
  renderQuestionEditor();
  const inputs = document.querySelectorAll(".q-text");
  inputs[inputs.length - 1] && inputs[inputs.length - 1].focus();
};

// ---------- REFLECTION SCREEN ----------
function openReflection() {
  if (!withinReflectWindow()) {
    document.getElementById("nextAvailLabel").textContent = nextScheduledLabel();
    showScreen("unavailableScreen");
    return;
  }
  if (!draft.active) {
    draft = { answers: {}, index: 0, active: true };
    saveLocalDraft();
  }
  showScreen("reflectScreen");
  renderCard();
}

function currentQuestion() { return questions[draft.index]; }

function renderCard() {
  const q = currentQuestion();
  if (!q) { finishSession(); return; }

  document.getElementById("questionLabel").textContent = q.text;
  const input = document.getElementById("answerInput");
  input.value = draft.answers[q.id] || "";
  input.focus();

  const isLast = draft.index === questions.length - 1;
  document.getElementById("nextBtn").textContent = isLast ? "commit & submit" : "→";
  document.getElementById("nextBtn").classList.toggle("submit", isLast);

  renderRecall(q);
}

function renderRecall(q) {
  const btn = document.getElementById("recallBtn");
  const panel = document.getElementById("recallPanel");
  if (!q.recall) { btn.style.display = "none"; panel.classList.remove("on"); return; }
  btn.style.display = "inline-flex";
  panel.classList.remove("on");
  btn.onclick = () => {
    panel.classList.toggle("on");
    if (panel.classList.contains("on")) loadRecallHistory(q, panel);
  };
}

function loadRecallHistory(q, panel) {
  const histKey = "rc_answer_hist_" + q.id;
  let hist = [];
  try { hist = JSON.parse(localStorage.getItem(histKey) || "[]"); } catch (_) {}
  if (!hist.length) { panel.innerHTML = "<div class='recall-empty'>no past answers yet</div>"; return; }
  panel.innerHTML = hist.slice(0, 7).map((h) =>
    `<div class="recall-item"><span class="recall-date">${new Date(h.t).toLocaleDateString()}</span>${escapeHtml(h.a)}</div>`
  ).join("");
}

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

window.onAnswerInput = (v) => {
  const q = currentQuestion();
  if (!q) return;
  draft.answers[q.id] = v;
  draft._localTouch = true;
  saveLocalDraft();
  window._saveDraft && window._saveDraft(draft);
};

window.nextCard = () => {
  const q = currentQuestion();
  if (q) {
    const histKey = "rc_answer_hist_" + q.id;
    let hist = [];
    try { hist = JSON.parse(localStorage.getItem(histKey) || "[]"); } catch (_) {}
    const ans = draft.answers[q.id] || "";
    if (ans.trim()) {
      hist.unshift({ a: ans, t: Date.now() });
      localStorage.setItem(histKey, JSON.stringify(hist.slice(0, 30)));
    }
  }
  if (draft.index >= questions.length - 1) { finishSession(); return; }
  draft.index += 1;
  saveLocalDraft();
  window._saveDraft && window._saveDraft(draft);
  renderCard();
};

function finishSession() {
  window._saveSession && window._saveSession({ answers: draft.answers });
  draft = { answers: {}, index: 0, active: false };
  saveLocalDraft();
  window._clearDraft && window._clearDraft();
  goHome();
}

window.exitReflection = () => { goHome(); };

// ---------- boot ----------
document.addEventListener("DOMContentLoaded", () => {
  renderQuestionEditor();
  renderSettings();
  goHome();
});
