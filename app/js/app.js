// Reflect & Commit — voice-first, low-attention, with bounded branching.
//
// The question list is a tree walked top-to-bottom. Most nodes are free-text
// (voice or type; a pause advances). A node can be a 2-way CHOICE: the question
// shows two tap options, each leading into its own short branch of follow-ups.
// Branches rejoin the main line automatically (DFS over the tree). Branching is
// one level deep by design — enough for "did you meet it? → why / why not".
//
// The star marks where the nightly MINIMUM ends: the walk starts at the top and,
// on answering the starred node, offers commit (with "keep reflecting" to go on).
//
// Everything autosaves so a half-finished night resumes exactly where you left it.

const LS_DRAFT = "rc_draft_v4";
const LS_QLIST = "rc_questions_v4";
const LS_SETTINGS = "rc_settings_v3";
const LS_LASTNOTIF = "rc_last_notif_v3";

var questions = []; // classic <script>, top-level var == window.questions — tree-editor.js reads/writes the same array via that name
let settings = { notifyTime: "20:00" };
let commitments = [];
let chatCollapsed = false;
let draft = blankDraft();

// phone = mobile UA, or a coarse-pointer device on a narrow screen. Used to
// (a) gate structural branch-editing to desktop, (b) show the desktop nudge.
function isPhone() { return isMobileUA() || (window.matchMedia("(pointer: coarse)").matches && window.innerWidth < 820); }

function blankDraft() {
  return { active: false, phase: null, mode: "min", currentId: null, answers: {},
           history: [], checkinId: null, resumeId: null, lastQuestionId: null,
           commitText: "", commitDue: "", committed: false, day: null };
}
// the calendar day a draft belongs to — a draft left over from a PREVIOUS day
// (interrupted mid-commit, or the done screen never explicitly cleared)
// must never resume into what should be a brand new reflection.
function todayKey() { return new Date().toDateString(); }

const SILENCE_MS = 1900;
const HOLD_MS = 1000;

// ---------- local persistence ----------
function loadLocal() {
  try { questions = JSON.parse(localStorage.getItem(LS_QLIST) || "[]"); } catch (_) {}
  try { settings = JSON.parse(localStorage.getItem(LS_SETTINGS) || "null") || settings; } catch (_) {}
  try { draft = JSON.parse(localStorage.getItem(LS_DRAFT) || "null") || draft; } catch (_) {}
}
function saveLocalQuestions() { localStorage.setItem(LS_QLIST, JSON.stringify(questions)); }
function saveLocalSettings() { localStorage.setItem(LS_SETTINGS, JSON.stringify(settings)); }
function saveDraft() { localStorage.setItem(LS_DRAFT, JSON.stringify(draft)); window._saveDraft && window._saveDraft(draft); }
loadLocal();

// ---------- tree helpers ----------
function ensureShape(node, isRoot) {
  node.type = node.type || "text";
  if (node.recall === undefined) node.recall = false;
  if (isRoot && node.star === undefined) node.star = false;
  if (node.type === "choice") {
    // migrate the old shape (each option owned its own branch) to the new one:
    // any number of options, each pointing at one of (at most) two branches A/B.
    if (node.options && node.options[0] && node.options[0].branch && !node.branches) {
      node.branches = node.options.map((o) => o.branch || []).slice(0, 2);
      node.options = node.options.map((o, i) => ({ label: o.label || "", exit: Math.min(i, 1) }));
    }
    node.options = node.options && node.options.length ? node.options : [{ label: "yes", exit: 0 }, { label: "no", exit: 1 }];
    node.branches = node.branches && node.branches.length ? node.branches.slice(0, 2) : [[], []];
    while (node.branches.length < 2) node.branches.push([]);
    node.options.forEach((o) => { o.label = o.label || ""; o.exit = o.exit === 1 ? 1 : 0; });
    node.branches.forEach((br) => br.forEach((b) => ensureShape(b, false)));
  }
  return node;
}
function normalizeTree(list) { (list || []).forEach((n) => ensureShape(n, true)); return list || []; }

// External index — NEVER attach runtime fields (list/owner refs) onto the
// question objects themselves. That was the earlier bug: a node's _owner
// pointed at its parent choice node, which itself carried a _list pointing
// back down — a genuine circular structure, so JSON.stringify(questions)
// (every save) threw, silently killing whatever ran after it (the "+" button
// and drag-drop both call persistQuestions() first, so they looked dead).
let nodeIndex = new Map(); // id -> { list, i, ownerId (choice node id), exit }
function indexTree(list, ownerId, exit) {
  list.forEach((n, i) => {
    nodeIndex.set(n.id, { list, i, ownerId: ownerId || null, exit });
    if (n.type === "choice" && n.branches) n.branches.forEach((br, bi) => indexTree(br || (n.branches[bi] = []), n.id, bi));
  });
}
function reindex() { nodeIndex = new Map(); indexTree(questions, null); }
function findNode(id) {
  const meta = nodeIndex.get(id);
  return meta ? meta.list[meta.i] : null;
}
function siblingAfter(node) {
  const meta = nodeIndex.get(node.id);
  if (!meta) return null;
  if (meta.list[meta.i + 1]) return meta.list[meta.i + 1];
  if (meta.ownerId) return siblingAfter(findNode(meta.ownerId));
  return null;
}
function computeNext(node) {
  if (node.type === "choice") {
    const a = draft.answers[node.id];
    // an option can be marked `terminal` (the DSL's ">> done") — chosen, it
    // ends the reflection right there instead of falling into its branch or
    // rejoining whatever comes after this question. Purely additive: options
    // without this field behave exactly as they always have.
    const optIndex = a && typeof a === "object" ? a.optIndex : null;
    const opt = optIndex != null ? (node.options || [])[optIndex] : null;
    if (opt && opt.terminal) return null;
    const exit = a && typeof a === "object" ? a.exit : null;
    if (exit != null && node.branches[exit] && node.branches[exit].length) return node.branches[exit][0];
    return siblingAfter(node);
  }
  // same idea for a plain question explicitly marked as a hard stop.
  if (node.terminal) return null;
  return siblingAfter(node);
}
function starNode() { return questions.find((q) => q.star) || null; }
function currentNode() { return findNode(draft.currentId); }

// ---------- firestore hooks ----------
let lastRenderedQuestionsJSON = null;
window._onQuestionsUpdated = () => {
  if (window._questions && window._questions.length) {
    questions = normalizeTree(window._questions);
    saveLocalQuestions();
    const ae = document.activeElement;
    // skip the rebuild entirely while any control inside the editor is
    // focused (not just text fields) — a full rebuild every ~500ms mid-edit
    // (each keystroke round-trips through the debounced Firestore write and
    // back through this listener) is what was reading as "flickering".
    if (ae && ae.closest && ae.closest("#treeEditor")) return;
    // also skip if this echo is identical to what's already on screen — an
    // idle Firestore round-trip (e.g. the server ack of your own last write)
    // otherwise rebuilds the whole list for no visible reason, which is what
    // reads as a flicker even while just hovering, not typing.
    const json = JSON.stringify(questions);
    if (json === lastRenderedQuestionsJSON) return;
    lastRenderedQuestionsJSON = json;
    renderTreeEditor();
  }
};
window._onSettingsUpdated = () => { if (window._settings && window._settings.notifyTime) { settings = window._settings; saveLocalSettings(); renderSettings(); } };
window._onCommitmentsUpdated = () => { commitments = window._commitments || []; };
window._onDraftUpdated = () => { const rd = window._remoteDraft; if (rd && rd.active && !draft.active) { draft = { ...blankDraft(), ...rd }; localStorage.setItem(LS_DRAFT, JSON.stringify(draft)); } };
window._onSignedIn = () => {
  normalizeTree(questions); renderTreeEditor(); renderSettings(); scheduleNotificationLoop();
  routeAfterAuth(); maybeOpenFromUrl();
  if ("Notification" in window && Notification.permission === "granted") window._registerPush && window._registerPush(deviceKind());
  window._claimActiveDevice && window._claimActiveDevice(deviceKind());
  // NOT marking "seen" here — signing in isn't installing. See markDeviceSeenIfInstalled below.
  markDeviceSeenIfInstalled();
};
function deviceKind() { return isPhone() ? "mobile" : "desktop"; }
// "seen" must mean genuinely INSTALLED, not just signed in — otherwise the
// cross-device gate would skip itself the moment you sign in anywhere,
// before you've actually installed there. Three ways we learn a real
// install happened: (1) already running standalone right now, (2) the
// native install prompt just completed (Chrome/Android/desktop Chrome fire
// 'appinstalled'), (3) best-effort — there's no JS signal at all for iOS
// Safari's manual "Add to Home Screen", so (1) on the NEXT launch is the
// only way that case is ever detected.
function markDeviceSeenIfInstalled() { if (isStandalone()) window._markDeviceSeen && window._markDeviceSeen(deviceKind()); }
window.addEventListener("appinstalled", () => { window._markDeviceSeen && window._markDeviceSeen(deviceKind()); });
// fires whenever the onboarding doc changes — this is how the OTHER device
// signing in gets noticed live, with nothing to click or refresh.
window._onOnboardingUpdated = () => {
  const other = document.getElementById("landingStepOther");
  if (!other || other.style.display === "none") return;
  const need = isPhone() ? "desktopSeenAt" : "mobileSeenAt";
  if (window._onboarding && window._onboarding[need]) window.onOtherDeviceDone();
};
// focusing this device is treated as "I'm using this one now" — claim it as
// active so the other device shades itself.
window.addEventListener("focus", () => { if (window._uid) window._claimActiveDevice && window._claimActiveDevice(deviceKind()); });

// ---------- routing ----------
function showScreen(id) { document.querySelectorAll(".screen").forEach((s) => s.classList.remove("on")); document.getElementById(id).classList.add("on"); }
function goHome() { stopVoice(); if (isStandalone()) { showScreen("homeScreen"); maybeShowMobileEditGate(); } else { showScreen("landingScreen"); resetLandingToIntro(); } }
function isStandalone() { return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true; }
// install is required on every device before use — phone AND desktop each
// get their own install prompt the first time they sign in on that device.
function routeAfterAuth() { if (isStandalone()) { showScreen("homeScreen"); maybeShowMobileEditGate(); } else { showScreen("landingScreen"); resetLandingToIntro(); } }

// ---------- mobile edit confirmation ----------
// questions are meant to be written on desktop; the notification + reflecting
// happens on the phone, and if a good idea shows up you go write it properly
// on desktop. mobile CAN still edit, but every time (until dismissed for
// good) it asks first, rather than nagging with a permanent banner.
const LS_MOBILE_EDIT_ACK = "rc_mobile_edit_ack";
function maybeShowMobileEditGate() {
  const gate = document.getElementById("mobileEditGate");
  if (!gate) return;
  if (!isPhone() || localStorage.getItem(LS_MOBILE_EDIT_ACK)) { gate.classList.remove("on"); return; }
  gate.classList.add("on");
}
window.dismissMobileEditGate = (forever) => {
  if (forever) localStorage.setItem(LS_MOBILE_EDIT_ACK, "1");
  const gate = document.getElementById("mobileEditGate");
  if (gate) gate.classList.remove("on");
};

// ---------- cross-device install gate ----------
// whichever device you land on, it leads with getting the OTHER one
// installed first — the point of this app is both devices staying in sync,
// so the very first thing you do is set up the pair, not just the device
// in front of you. Three sub-steps of #landingScreen, one visible at a time.
const INSTALL_URL = "reflectandcommit.com/install";
function resetLandingToIntro() {
  const intro = document.getElementById("landingIntro");
  const other = document.getElementById("landingStepOther");
  const here = document.getElementById("landingStepHere");
  if (!intro || !other || !here) return;
  intro.style.display = "block"; other.style.display = "none"; here.style.display = "none";
}
window.goToInstallGate = () => {
  // if the other kind of device has ALREADY been installed, don't nag about
  // it again — go straight to this device's own install step. NOTE: we do
  // NOT mark this device "seen" here — clicking "Get started" isn't an
  // install. Seen is only ever set by markDeviceSeenIfInstalled() (already
  // standalone on load) or the 'appinstalled' event listener above.
  const need = isPhone() ? "desktopSeenAt" : "mobileSeenAt";
  if (window._onboarding && window._onboarding[need]) {
    document.getElementById("landingIntro").style.display = "none";
    return window.onOtherDeviceDone();
  }
  document.getElementById("landingIntro").style.display = "none";
  document.getElementById("landingStepOther").style.display = "flex";
  const label = document.getElementById("otherDeviceLabel");
  const qr = document.getElementById("landingQr");
  const hint = document.getElementById("otherDeviceHint");
  if (isPhone()) {
    label.textContent = "Good reflections only happen on desktop.";
    qr.style.display = "none";
    hint.textContent = INSTALL_URL;
  } else {
    label.textContent = "Reflections always start on your phone.";
    // higher error-correction + resolution so it scans instantly and holds
    // up sharp even on a retina display, not the soft/low-density default
    qr.src = "https://api.qrserver.com/v1/create-qr-code/?size=320x320&ecc=H&data=" + encodeURIComponent("https://" + INSTALL_URL);
    qr.style.display = "block";
    hint.textContent = INSTALL_URL;
  }
  // check again right away in case the other device beat us here between
  // the sign-in listener attaching and this click
  window._onOnboardingUpdated && window._onOnboardingUpdated();
};
window.onOtherDeviceDone = () => {
  document.getElementById("landingStepOther").style.display = "none";
  const here = document.getElementById("landingStepHere");
  here.style.display = "block";
  // the mental model, stated once, right where it matters: this is the
  // moment you're setting up a device, not a permanent banner later.
  const explainer = document.getElementById("onboardingExplainer");
  if (explainer) {
    explainer.textContent = isPhone()
      ? "You'll get a notification here when it's time to reflect. Write and edit your questions on your computer — if a good idea comes up mid-reflection, that's where you go build it out."
      : "Write your questions here. You'll get a notification on your phone when it's time to reflect — and if a good idea shows up, come back here to expand on it.";
  }
  renderSettings();
};
function maybeOpenFromUrl() { const p = new URLSearchParams(location.search); if (p.get("reflect") === "1") { history.replaceState({}, "", location.pathname); openReflection(); } }

// ---------- install ----------
let deferredInstallPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredInstallPrompt = e; });
function isMobileUA() { return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.userAgentData && navigator.userAgentData.mobile); }
window.onGetStarted = async () => {
  if (deferredInstallPrompt) { deferredInstallPrompt.prompt(); await deferredInstallPrompt.userChoice; deferredInstallPrompt = null; return; }
  document.getElementById("getStartedBtn").style.display = "none";
  document.getElementById("landingManual").style.display = "block";
  document.getElementById("landingManual").textContent = isMobileUA()
    ? "tap ⋮ in your browser's toolbar, then Add to Home screen."
    : "click the install icon (⊕) in your address bar, or ⋮ menu → Install Reflect & Commit.";
};

// ---------- notification window ----------
const REFLECT_WINDOW_MS = 2 * 60 * 60 * 1000;
function getLastNotif() { try { return JSON.parse(localStorage.getItem(LS_LASTNOTIF) || "null"); } catch (_) { return null; } }
function setLastNotif(src) { localStorage.setItem(LS_LASTNOTIF, JSON.stringify({ sentAt: Date.now(), source: src })); }
function withinReflectWindow() { const n = getLastNotif(); return n ? Date.now() - n.sentAt < REFLECT_WINDOW_MS : false; }
function nextScheduledLabel() {
  const [h, m] = (settings.notifyTime || "20:00").split(":").map(Number);
  const now = new Date(), next = new Date(now); next.setHours(h, m, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }).toLowerCase();
}

// ---------- notifications ----------
function fireNotification(src) {
  setLastNotif(src);
  const title = "Time to reflect", body = "Your questions are ready.";
  if (Notification.permission !== "granted") return;
  if ("serviceWorker" in navigator) navigator.serviceWorker.ready.then((reg) => reg.showNotification(title, { body, tag: "reflect" })).catch(() => fallbackNotify(title, body));
  else fallbackNotify(title, body);
}
function fallbackNotify(title, body) { const n = new Notification(title, { body }); n.onclick = () => { window.focus(); openReflection(); n.close(); }; }
async function requestNotifPermission() { if (!("Notification" in window)) return false; if (Notification.permission === "granted") return true; return (await Notification.requestPermission()) === "granted"; }
window.sendSelfNotification = async () => {
  const ok = await requestNotifPermission();
  if (!ok) { alert("Notifications are blocked — enable them in your browser/OS settings."); return; }
  window._registerPush && window._registerPush(deviceKind()); fireNotification("manual"); alert("Sent. Valid for 2 hours.");
};
let lastFiredDateKey = localStorage.getItem("rc_last_fired_date") || "";
function scheduleNotificationLoop() {
  setInterval(() => {
    const now = new Date(); const [h, m] = (settings.notifyTime || "20:00").split(":").map(Number); const key = now.toDateString();
    if (key !== lastFiredDateKey && now.getHours() === h && now.getMinutes() >= m && now.getMinutes() < m + 2) { lastFiredDateKey = key; localStorage.setItem("rc_last_fired_date", key); fireNotification("schedule"); }
  }, 30000);
}
if ("serviceWorker" in navigator) {
  // resolve relative to THIS script's own location, not the page's — app.js
  // now loads from both /app/index.html and the root index.html (which
  // references app/js/app.js), and "sw.js" alone would resolve against
  // whichever page loaded it, missing the file when served from root.
  const swUrl = new URL("../sw.js", document.currentScript.src).href;
  navigator.serviceWorker.register(swUrl, { scope: new URL(".", swUrl).href }).catch(() => {});
  navigator.serviceWorker.addEventListener("message", (e) => { if (e.data && e.data.type === "notif-confirmed") { setLastNotif("schedule"); openReflection(); } });
}

// ---------- HOME / settings ----------
// notify-time controls now appear in TWO places (onboarding + settings
// panel) — both share the same classes, so every instance updates together
// rather than each needing its own id.
function renderSettings() { document.querySelectorAll(".notify-time-hidden").forEach((el) => { el.value = settings.notifyTime || "20:00"; }); renderNotifyLabel(); }
function renderNotifyLabel() {
  const els = document.querySelectorAll(".notify-countdown"); if (!els.length) return;
  const [h, m] = (settings.notifyTime || "20:00").split(":").map(Number);
  const d = new Date(); d.setHours(h, m, 0, 0);
  // "reflect at 8pm" — no trailing s, no ":00", lowercase am/pm
  let t = d.toLocaleTimeString(undefined, { hour: "numeric", minute: m ? "2-digit" : undefined }).toLowerCase().replace(/\s+/g, "");
  els.forEach((el) => { el.textContent = "reflect at " + t; });
}
window.onNotifyTimeChange = (v) => {
  settings.notifyTime = v; saveLocalSettings(); renderNotifyLabel();
  window._saveSettings && window._saveSettings({ notifyTime: v });
  document.querySelectorAll(".notify-time-hidden").forEach((el) => { el.value = v; });
};
window.openTimePicker = (btn) => {
  const group = btn && btn.closest ? btn.closest(".notify-time-group") : null;
  const el = group ? group.querySelector(".notify-time-hidden") : document.querySelector(".notify-time-hidden");
  if (!el) return;
  if (el.showPicker) { try { el.showPicker(); return; } catch (_) {} }
  el.focus();
};
window.toggleSettingsPanel = () => { const p = document.getElementById("settingsPanel"); if (p) p.classList.toggle("on"); };

// ---------- tree editor ----------
// The click-heavy list (drag handle + star + recall + delete + split/merge
// icons behind a modal "edit mode") lived here before. It's now a block
// editor (app/js/tree-editor.js) plus a read-only graph view
// (app/js/dsl-graph.js) rendered above it — both operate directly on this
// same `questions` array via window.renderTreeEditor()/persistQuestions(),
// so nothing about save/sync/reflect changes, only how a tree gets authored.
// A plain-text form of the same tree (app/js/dsl.js) is available as an
// optional import/export path — "paste tree" / "copy as text" below — for
// backup or writing a tree somewhere else; it's never required to use the app.
window.openPasteTree = () => {
  const m = document.getElementById("pasteTreeModal"); if (!m) return;
  const ta = document.getElementById("pasteTreeArea"); if (ta) ta.value = "";
  m.classList.add("on");
  setTimeout(() => ta && ta.focus(), 60);
};
window.closePasteTree = () => { const m = document.getElementById("pasteTreeModal"); if (m) m.classList.remove("on"); };
window.confirmPasteTree = () => {
  const ta = document.getElementById("pasteTreeArea");
  const text = ta ? ta.value : "";
  // opening this modal and hitting "replace" already IS the deliberate
  // confirmation, so skip the (redundant) native confirm() inside pasteTreeFromText.
  const warnings = window.pasteTreeFromText(text, true);
  window.closePasteTree();
  if (warnings && warnings.length) alert(warnings.join("\n"));
};
window.copyTreeButton = async (btn) => {
  const text = await window.copyTreeAsText();
  if (!text) return;
  const b = btn && btn.currentTarget ? btn.currentTarget : btn;
  if (b && "textContent" in b) {
    const orig = b.textContent; b.textContent = "copied"; setTimeout(() => { b.textContent = orig; }, 1100);
  }
};
window.toggleGraphPanel = () => {
  const p = document.getElementById("treeGraph"); const b = document.getElementById("editToggle");
  if (!p) return;
  const collapsed = p.classList.toggle("collapsed");
  if (b) b.classList.toggle("on", !collapsed);
  localStorage.setItem("rc_graph_collapsed", collapsed ? "1" : "0");
};
function persistQuestions() { saveLocalQuestions(); window._saveQuestions && window._saveQuestions(questions); }
function escapeHtml(s) { return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

// ---------- day-after check-in gate ----------
function dueCommitment() { const today = new Date(); today.setHours(0, 0, 0, 0); return (commitments || []).find((c) => c.status === "active" && c.dueDate && new Date(c.dueDate) <= today); }

// ---------- reflection ----------
async function openReflection() {
  if (!withinReflectWindow()) { document.getElementById("nextAvailLabel").textContent = nextScheduledLabel(); showScreen("unavailableScreen"); return; }
  showScreen("reflectScreen"); reindex();
  // always reconcile against the server's true draft before deciding whether
  // to resume — trusting the locally-merged copy was the "starts over on the
  // other device" bug: a background listener can race or simply not have
  // fired yet by the moment you open a reflection.
  const fresh = await (window._fetchLatestDraft ? window._fetchLatestDraft() : null);
  if (fresh && fresh.active) { draft = { ...blankDraft(), ...fresh }; localStorage.setItem(LS_DRAFT, JSON.stringify(draft)); }
  // only resume if the in-progress draft actually belongs to TODAY — otherwise
  // a session left dangling from a previous night (backed out mid-commit,
  // "done" never explicitly cleared) resumes into what should be a fresh
  // reflection, which is why this was jumping straight to the commit screen.
  if (draft.active && draft.phase && draft.day === todayKey()) return resumePhase();
  draft = blankDraft(); draft.active = true; draft.day = todayKey();
  const due = dueCommitment();
  if (due) { draft.phase = "checkin"; draft.checkinId = due.id; saveDraft(); return enterCheckin(due); }
  startWalk();
}
function resumePhase() {
  reindex();
  if (draft.phase === "checkin") { const due = dueCommitment(); return due ? enterCheckin(due) : startWalk(); }
  if (draft.phase === "question") return renderChat();
  if (draft.phase === "commit") return enterCommit();
  if (draft.phase === "done") return enterDone(draft.committed);
  startWalk();
}
function startWalk() {
  reindex();
  const first = questions[0];
  if (!first) return enterCommit();
  draft.phase = "question"; draft.currentId = first.id; draft.history = []; saveDraft();
  renderChat();
}

function setPhase(id) { document.querySelectorAll(".phase").forEach((p) => p.classList.remove("on")); document.getElementById(id).classList.add("on"); }
function setBackVisible(v) { const b = document.getElementById("reflectBack"); if (b) b.style.display = v ? "flex" : "none"; }

// -- check-in --
function enterCheckin(cmt) { stopVoice(); setPhase("phaseCheckin"); setBackVisible(false); setCollapseVisible(false); document.getElementById("checkinText").textContent = cmt.text; wireHold("checkinHold", "checkinRingFill", () => resolveCheckin("done")); }
window.resolveCheckin = (status) => { if (draft.checkinId) window._resolveCommitment && window._resolveCommitment(draft.checkinId, status); draft.checkinId = null; startWalk(); };

// -- questions rendered as a chat transcript --
function setCollapseVisible(v) { const c = document.getElementById("reflectCollapse"); if (c) c.style.display = v ? "block" : "none"; }

function renderChat() {
  reindex();
  const node = currentNode();
  if (!node) return afterQuestions();
  setPhase("phaseChat");
  setBackVisible(draft.history.length > 0);
  setCollapseVisible(draft.history.length > 0);

  const scroll = document.getElementById("chatScroll");
  scroll.classList.toggle("collapsed", chatCollapsed);
  scroll.innerHTML = "";
  draft.history.forEach((id) => {
    const n = findNode(id); if (!n) return;
    const a = draft.answers[id];
    const ans = a && typeof a === "object" ? a.label : (a || "");
    const item = document.createElement("div"); item.className = "chat-item past";
    item.innerHTML = `<div class="chat-q">${escapeHtml(n.text)}</div><div class="chat-a">${escapeHtml(ans)}</div>`;
    scroll.appendChild(item);
  });
  const cur = document.createElement("div"); cur.className = "chat-item current";
  cur.innerHTML = `<div class="chat-q big">${escapeHtml(node.text)}</div>`;
  scroll.appendChild(cur);
  scroll.scrollTop = scroll.scrollHeight;

  const choices = document.getElementById("chatChoices");
  const bar = document.getElementById("composerBar");
  const recall = document.getElementById("chatRecall"), rlist = document.getElementById("chatRecallList");
  recall.classList.remove("open"); rlist.classList.remove("open"); rlist.innerHTML = "";

  if (node.type === "choice") {
    stopVoice();
    bar.style.display = "none"; recall.style.display = "none";
    choices.style.display = "flex"; choices.innerHTML = "";
    node.options.forEach((opt, k) => {
      const b = document.createElement("button"); b.className = "q-choice"; b.textContent = opt.label || (k === 0 ? "yes" : "no");
      b.onclick = () => { b.classList.add("chosen"); chooseOption(node, k); };
      choices.appendChild(b);
    });
  } else {
    choices.style.display = "none"; bar.style.display = "flex";
    const field = document.getElementById("answerField");
    field.value = typeof draft.answers[node.id] === "string" ? draft.answers[node.id] : "";
    autoGrow(field);
    field.oninput = () => { draft.answers[node.id] = field.value; autoGrow(field); saveDraft(); };
    field.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); composerSend(); } };
    if (node.recall) { recall.style.display = "inline-flex"; recall.onclick = () => { const open = recall.classList.toggle("open"); rlist.classList.toggle("open", open); if (open) fillRecall(node, rlist); }; }
    else recall.style.display = "none";
    updateMicBtn();
    setTimeout(() => field.focus(), 60);
  }
  const cd = document.getElementById("continueDesktop"); if (cd) cd.style.display = isPhone() ? "block" : "none";
}

window.composerSend = () => { const n = currentNode(); if (n && n.type !== "choice") submitText(n); };
window.toggleTranscript = () => { chatCollapsed = !chatCollapsed; renderChat(); };

// ---------- hand-off to desktop ----------
// The draft is already synced continuously (saveDraft -> _saveDraft), so the
// content was never actually at risk. What this adds is a deliberate,
// visible confirmation: the phone parks itself, and the *other* device picks
// up instantly if it's already open (real-time Firestore listener below), or
// via a push notification within a few minutes otherwise (fallback, piggy-
// backed on the existing free GitHub Actions cron — see scripts/send-notifications.js).
window.showDesktopHint = () => {
  stopVoice();
  window._requestHandoff && window._requestHandoff();
  setPhase("phaseParked"); setBackVisible(false); setCollapseVisible(false);
  const u = document.getElementById("parkedUrl"); if (u) u.textContent = location.host + location.pathname.replace(/\/$/, "");
};
window.resumeHere = () => { renderChat(); };

window._onHandoffUpdated = async () => {
  const h = window._handoff;
  if (!h || h.consumed || isPhone()) return; // only a non-phone device ever consumes a hand-off
  const requestedAt = h.requestedAt && h.requestedAt.toMillis ? h.requestedAt.toMillis() : (h.requestedAt ? new Date(h.requestedAt).getTime() : 0);
  if (requestedAt && Date.now() - requestedAt > 10 * 60 * 1000) return; // stale — ignore
  window._consumeHandoff && window._consumeHandoff();
  setLastNotif("handoff"); // deliberate continuation — always opens, regardless of the usual notification window
  // same fix as openReflection: don't trust the locally-merged draft, go read
  // the server's true copy at the moment we're consuming the hand-off.
  const fresh = await (window._fetchLatestDraft ? window._fetchLatestDraft() : null);
  if (fresh && fresh.active) { draft = { ...blankDraft(), ...fresh }; localStorage.setItem(LS_DRAFT, JSON.stringify(draft)); }
  window.takeOverDevice && window.takeOverDevice(); // consuming a hand-off is an explicit claim to be the active device
  if (draft.active && draft.phase && draft.day === todayKey()) { showScreen("reflectScreen"); reindex(); resumePhase(); }
  else openReflection();
};

// ---------- cross-device active-device exclusivity ----------
// Only one device is ever "active." Whichever device last claimed it (by
// signing in, focusing the tab, or explicitly taking over) is active; every
// other open device shades itself until the person explicitly asks to use it
// instead. This is a UX guardrail only — data is always synced regardless.
window._onActiveDeviceUpdated = () => {
  const ad = window._activeDevice;
  const shade = document.getElementById("deviceShade");
  if (!shade) return;
  const isOther = !!(ad && ad.deviceId && window._deviceId && ad.deviceId !== window._deviceId);
  shade.classList.toggle("on", isOther);
};
window.takeOverDevice = () => { window._claimActiveDevice && window._claimActiveDevice(deviceKind()); };

function submitText(node) {
  const ans = (draft.answers[node.id] || "").trim();
  if (ans) { const k = "rc_answer_hist_" + node.id; let h = []; try { h = JSON.parse(localStorage.getItem(k) || "[]"); } catch (_) {} h.unshift({ a: ans, t: Date.now() }); localStorage.setItem(k, JSON.stringify(h.slice(0, 30))); }
  advanceFrom(node);
}
function chooseOption(node, k) {
  const opt = node.options[k];
  draft.answers[node.id] = { optIndex: k, label: opt.label, exit: opt.exit || 0 }; saveDraft();
  advanceFrom(node);
}
function advanceFrom(node) {
  stopVoice(); reindex();
  const fresh = findNode(node.id) || node;
  const star = starNode();
  if (draft.mode !== "full" && star && star.id === fresh.id) {
    const nx = computeNext(fresh); draft.resumeId = nx ? nx.id : null; draft.lastQuestionId = fresh.id; saveDraft(); return enterCommit();
  }
  const nx = computeNext(fresh);
  if (!nx) { draft.lastQuestionId = fresh.id; draft.resumeId = null; saveDraft(); return afterQuestions(); }
  draft.history.push(fresh.id); draft.currentId = nx.id; saveDraft(); renderChat();
}
function afterQuestions() { stopVoice(); if (draft.mode === "full") return finishSession(); enterCommit(); }

function fillRecall(node, el) {
  let h = []; try { h = JSON.parse(localStorage.getItem("rc_answer_hist_" + node.id) || "[]"); } catch (_) {}
  if (!h.length) { el.innerHTML = "<div class='recall-empty'>nothing here yet</div>"; return; }
  el.innerHTML = h.slice(0, 10).map((x) => `<div class="recall-item"><span class="recall-date">${new Date(x.t).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>${escapeHtml(x.a)}</div>`).join("");
}

// -- back --
window.goBackPhase = () => {
  if (draft.phase === "question") { if (draft.history.length) { draft.currentId = draft.history.pop(); saveDraft(); renderChat(); } }
  else if (draft.phase === "commit") {
    reindex();
    // lastQuestionId should always be set on the way into commit, but fall
    // back to the last history entry (or the top of the list) rather than
    // silently doing nothing if it's ever missing.
    const target = draft.lastQuestionId || draft.history[draft.history.length - 1] || (questions[0] && questions[0].id);
    if (!target) return;
    draft.phase = "question"; draft.currentId = target; saveDraft(); renderChat();
  }
  else if (draft.phase === "done") { enterCommit(); }
};

// -- commit --
function enterCommit() {
  stopVoice(); draft.phase = "commit"; saveDraft(); setPhase("phaseCommit"); setBackVisible(true); setCollapseVisible(false);
  const field = document.getElementById("commitField");
  field.value = draft.commitText || ""; autoGrow(field);
  field.oninput = () => { draft.commitText = field.value; autoGrow(field); saveDraft(); };
  field.onkeydown = (e) => { if (e.key === "Enter") e.preventDefault(); };
  renderDueSelect();
  wireHold("commitHold", "commitRingFill", doCommit);
  setTimeout(() => field.focus(), 60);
}
function renderDueSelect() {
  const sel = document.getElementById("commitDueSelect"); if (!sel) return;
  sel.innerHTML = "";
  for (let i = 1; i <= 7; i++) {
    const d = new Date(); d.setDate(d.getDate() + i);
    const opt = document.createElement("option"); opt.value = d.toISOString().slice(0, 10);
    opt.textContent = i === 1 ? "tomorrow" : d.toLocaleDateString(undefined, { weekday: "long" }).toLowerCase();
    sel.appendChild(opt);
  }
  sel.value = draft.commitDue && sel.querySelector(`option[value="${draft.commitDue}"]`) ? draft.commitDue : sel.options[0].value;
  draft.commitDue = sel.value; saveDraft();
}
window.onCommitDueChange = (v) => { draft.commitDue = v; saveDraft(); };
function doCommit() { const text = (draft.commitText || "").trim(); if (text) window._addCommitment && window._addCommitment({ text, dueDate: draft.commitDue }); if (navigator.vibrate) navigator.vibrate(12); draft.committed = true; enterDone(true); }
window.skipCommit = () => { draft.committed = false; enterDone(false); };

// -- done --
function enterDone(committed) {
  stopVoice(); draft.phase = "done"; saveDraft(); setPhase("phaseDone"); setBackVisible(true); setCollapseVisible(false);
  document.getElementById("doneText").textContent = committed ? "committed. see you tomorrow." : "logged. see you tomorrow.";
  const kg = document.getElementById("keepGoingBtn"); kg.style.display = draft.resumeId ? "block" : "none";
}
window.keepReflecting = () => { draft.mode = "full"; draft.commitText = ""; draft.history = []; draft.currentId = draft.resumeId; draft.phase = "question"; saveDraft(); renderChat(); };

function finishSession() { window._saveSession && window._saveSession({ answers: draft.answers }); draft = blankDraft(); saveDraft(); window._clearDraft && window._clearDraft(); goHome(); }
window.exitReflection = () => { stopVoice(); goHome(); };

// textareas grow vertically; the single-line answer input instead scrolls
// horizontally so a long answer runs off the right edge (and fades) rather
// than wrapping onto a second line.
function autoGrow(el) {
  if (el.tagName === "TEXTAREA") { el.style.height = "auto"; el.style.height = el.scrollHeight + "px"; }
  else { el.scrollLeft = el.scrollWidth; }
}

// ---------- hold-to-confirm ----------
function wireHold(btnId, fillId, onComplete) {
  const btn = document.getElementById(btnId), fill = document.getElementById(fillId);
  const CIRC = 207.3; let raf = null, start = 0, done = false;
  fill.style.strokeDashoffset = CIRC;
  const tick = (ts) => { if (!start) start = ts; const p = Math.min((ts - start) / HOLD_MS, 1); fill.style.strokeDashoffset = CIRC * (1 - p); if (p >= 1) { done = true; btn.classList.add("done"); release(true); return; } raf = requestAnimationFrame(tick); };
  const press = (e) => { e.preventDefault(); if (done) return; start = 0; raf = requestAnimationFrame(tick); };
  const release = (complete) => { if (raf) cancelAnimationFrame(raf); raf = null; if (complete) onComplete(); else { fill.style.transition = "stroke-dashoffset .25s ease"; fill.style.strokeDashoffset = CIRC; setTimeout(() => (fill.style.transition = ""), 260); } };
  btn.onpointerdown = press; btn.onpointerup = () => { if (!done) release(false); }; btn.onpointerleave = () => { if (!done) release(false); };
}

// ---------- voice (demoted: opt-in dictation via the mic button) ----------
let recog = null, voiceField = null, voiceBase = "", listeningWanted = false, micActive = false;
let voiceSilenceTimer = null, voiceHeardAnything = false;
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
window.toggleMic = () => {
  if (!SR) { alert("Voice dictation isn't supported in this browser — just type."); return; }
  if (micActive) stopVoice(); else startVoice(document.getElementById("answerField"));
};
function updateMicBtn() { const b = document.getElementById("micBtn"); if (b) { b.classList.toggle("active", micActive); b.style.display = SR ? "flex" : "none"; } }
// SILENCE_MS existed as a defined-but-never-wired constant — this is that
// wiring: once you've said something and then gone quiet for SILENCE_MS,
// send it, same as if you'd tapped the send button. One less tap per
// question when you're talking instead of typing.
function armVoiceSilence() {
  clearTimeout(voiceSilenceTimer);
  voiceSilenceTimer = setTimeout(() => {
    if (micActive && voiceHeardAnything && voiceField && voiceField.value.trim()) { stopVoice(); composerSend(); }
  }, SILENCE_MS);
}
function startVoice(field) {
  if (!SR || !field) return;
  stopVoice(); voiceField = field; voiceBase = field.value ? field.value + " " : ""; voiceHeardAnything = false;
  try {
    recog = new SR(); recog.continuous = true; recog.interimResults = true; recog.lang = navigator.language || "en-US";
    recog.onresult = (e) => {
      let interim = "", final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) { const t = e.results[i][0].transcript; if (e.results[i].isFinal) final += t; else interim += t; }
      if (final) voiceBase = (voiceBase + final).replace(/\s+/g, " ").replace(/^\s/, "") + " ";
      voiceField.value = (voiceBase + interim).trimStart(); autoGrow(voiceField);
      const n = currentNode(); if (n) draft.answers[n.id] = voiceField.value;
      saveDraft();
      if ((final || interim).trim()) { voiceHeardAnything = true; armVoiceSilence(); }
    };
    recog.onerror = () => {};
    recog.onend = () => { if (recog && listeningWanted) { try { recog.start(); } catch (_) {} } };
    listeningWanted = true; micActive = true; recog.start(); updateMicBtn(); field.focus();
  } catch (_) { micActive = false; updateMicBtn(); }
}
function stopVoice() {
  listeningWanted = false; micActive = false;
  clearTimeout(voiceSilenceTimer);
  const b = document.getElementById("micBtn"); if (b) b.classList.remove("active");
  if (recog) { try { recog.onend = null; recog.stop(); } catch (_) {} recog = null; }
}

// ---------- boot ----------
document.addEventListener("DOMContentLoaded", () => {
  normalizeTree(questions); renderTreeEditor(); renderSettings();
  const graphCollapsed = localStorage.getItem("rc_graph_collapsed") === "1";
  const gp = document.getElementById("treeGraph"), gb = document.getElementById("editToggle");
  if (gp) gp.classList.toggle("collapsed", graphCollapsed);
  if (gb) gb.classList.toggle("on", !graphCollapsed);
});
