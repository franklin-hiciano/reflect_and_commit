// Reflect & Commit — voice-first, low-attention, with bounded branching.
//
// The question tree is authored as plain DSL text (js/tree-model.js) — that
// text IS the tree; there's no separate array schema to keep in sync (see
// js/dsl-editor.js for the editor + node canvas that write it). Most nodes
// are free-text (voice or type; a pause advances). A node can be a CHOICE:
// the question shows tap-able options, each leading into its own follow-up.
//
// The star marks where the nightly MINIMUM ends: the walk starts at the top
// and, on answering the starred node, offers commit (with "keep reflecting"
// to go on).
//
// Any question can recall any OTHER question's past answers (set via the
// node canvas's recall icon, or by writing `recall <title>` under it) —
// answers are logged locally per question title as they're given, so a
// recall target doesn't need to have been asked earlier in THIS session.
//
// Everything autosaves so a half-finished night resumes exactly where you
// left it.

const LS_TREE = "rc_tree_v1";
const LS_DRAFT = "rc_draft_v5";
const LS_SETTINGS = "rc_settings_v3";
const LS_LASTNOTIF = "rc_last_notif_v3";

var dslText = ""; // classic <script>, top-level var == window.dslText — dsl-editor.js reads/writes the same string via that name
let settings = { notifyTime: "20:00" };
let commitments = [];
let chatCollapsed = false;
let draft = blankDraft();

// phone = mobile UA, or a coarse-pointer device on a narrow screen. Used to
// (a) gate structural branch-editing to desktop, (b) show the desktop nudge.
function isPhone() { return isMobileUA() || (window.matchMedia("(pointer: coarse)").matches && window.innerWidth < 820); }

function blankDraft() {
  return { active: false, phase: null, mode: "min", currentName: null, answers: {},
           history: [], checkinId: null, resumeName: null, lastQuestionName: null,
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
  try { dslText = localStorage.getItem(LS_TREE) || ""; } catch (_) {}
  try { settings = JSON.parse(localStorage.getItem(LS_SETTINGS) || "null") || settings; } catch (_) {}
  try { draft = JSON.parse(localStorage.getItem(LS_DRAFT) || "null") || draft; } catch (_) {}
}
function saveLocalTree() { localStorage.setItem(LS_TREE, dslText || ""); }
function saveLocalSettings() { localStorage.setItem(LS_SETTINGS, JSON.stringify(settings)); }
function saveDraft() { localStorage.setItem(LS_DRAFT, JSON.stringify(draft)); window._saveDraft && window._saveDraft(draft); }
loadLocal();

// ---------- tree access — everything derives fresh off dslText via
// TreeModel; there's no id-keyed index to keep in sync (see the old
// nodeIndex/ensureShape/normalizeTree this replaced). Trees here are small
// (a handful of questions), so re-parsing on each call is cheap. ──────────
function getParsed() { return window.TreeModel.parse(dslText); }
function resolveBlock(name) { return window.TreeModel.resolveName(getParsed(), name); }
function starBlock() { return (getParsed().blocks || []).find((b) => b.star) || null; }
function currentNode() { return resolveBlock(draft.currentName); }
function computeNext(block) {
  const TM = window.TreeModel;
  const parsed = getParsed();
  if (!block) return null;
  if (block.type === "text") {
    if (block.terminal || (block.next && block.next.isDone)) return null;
    if (block.next) return TM.resolveName(parsed, block.next.target) || null;
    return null;
  }
  const ans = draft.answers[block.name];
  const opt = ans && block.options ? block.options[ans.optIndex] : null;
  if (!opt || opt.isDone) return null;
  if (opt.target) return TM.resolveName(parsed, opt.target) || null;
  return null;
}

// ── writes: the ONE entry point that ever changes the tree. Editor UI
// (js/dsl-editor.js) always calls this instead of touching `dslText`
// directly, so persistence + re-render always happen together. ──────────
window.setDslText = function (newText, selRange) {
  dslText = newText || "";
  saveLocalTree();
  window._saveTree && window._saveTree(dslText);
  window.renderDslEditor();
  if (typeof window._renderTreeGraph === "function") window._renderTreeGraph();
};

// ---------- firestore hooks ----------
let lastRenderedTree = null;
window._onTreeUpdated = () => {
  if (typeof window._tree === "string") {
    dslText = window._tree;
    saveLocalTree();
    // skip the rebuild entirely while the editor textarea is focused — a
    // Firestore round-trip landing mid-keystroke would otherwise fight the
    // cursor (same guard the old array-based editor used).
    const ae = document.activeElement;
    if (ae && ae.id === "dslTextarea") return;
    if (dslText === lastRenderedTree) return;
    lastRenderedTree = dslText;
    window.renderDslEditor();
  }
};
window._onSettingsUpdated = () => { if (window._settings && window._settings.notifyTime) { settings = window._settings; saveLocalSettings(); renderSettings(); } };
window._onCommitmentsUpdated = () => { commitments = window._commitments || []; };
window._onDraftUpdated = () => { const rd = window._remoteDraft; if (rd && rd.active && !draft.active) { draft = { ...blankDraft(), ...rd }; localStorage.setItem(LS_DRAFT, JSON.stringify(draft)); } };
window._onSignedIn = () => {
  window.renderDslEditor(); renderSettings(); scheduleNotificationLoop();
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
window.addEventListener("appinstalled", () => {
  window._markDeviceSeen && window._markDeviceSeen(deviceKind());
  // if we were still mid-onboarding (native prompt accepted before we ever
  // got to "here"), move straight into the home screen + cross-device nudge
  // instead of leaving the landing screen sitting there with nothing to do.
  const landing = document.getElementById("landingScreen");
  if (landing && landing.classList.contains("on")) enterHome();
});
// fires whenever the onboarding doc changes — this is how the OTHER device
// signing in gets noticed live, with nothing to click or refresh: if the
// gate is up because we're waiting on it, this either drops it or (rarely)
// re-renders it if something upstream re-triggered it.
window._onOnboardingUpdated = () => {
  const home = document.getElementById("homeScreen");
  if (home && home.classList.contains("on")) maybeShowOtherDeviceGate();
  renderSettings();
};
// focusing this device is treated as "I'm using this one now" — claim it as
// active so the other device shades itself.
window.addEventListener("focus", () => { if (window._uid) window._claimActiveDevice && window._claimActiveDevice(deviceKind()); });

// ---------- routing ----------
function showScreen(id) { document.querySelectorAll(".screen").forEach((s) => s.classList.remove("on")); document.getElementById(id).classList.add("on"); }
// landing on the home screen: the cross-device nudge takes priority over the
// (lower-stakes) "editing on phone" reminder — no point warning someone about
// editing on their phone before they even have the option of a desktop.
function enterHome() {
  showScreen("homeScreen");
  if (!maybeShowOtherDeviceGate()) maybeShowMobileEditGate();
}
function goHome() { stopVoice(); if (isStandalone()) { enterHome(); } else { showScreen("landingScreen"); resetLandingToIntro(); } }
function isStandalone() { return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true; }
// install is required on every device before use — phone AND desktop each
// get their own install prompt the first time they sign in on that device.
function routeAfterAuth() { if (isStandalone()) { enterHome(); } else { showScreen("landingScreen"); resetLandingToIntro(); } }

// ---------- mobile edit confirmation ----------
// questions are meant to be written on desktop; the notification + reflecting
// happens on the phone, and if a good idea shows up you go write it properly
// on desktop. mobile CAN still edit, but every time (until dismissed for
// good) it asks first, rather than nagging with a permanent banner. This only
// ever applies once desktop is actually installed — see maybeShowOtherDeviceGate.
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

// ---------- local install (this device) ----------
// "Get started" leads straight into installing THIS device — no detour
// through "go install the other one first". Once this device is genuinely
// installed, maybeShowOtherDeviceGate() takes over the cross-device ask, as
// an overlay over the home screen rather than a gate in front of it.
const INSTALL_URL = "reflectandcommit.com/install";
function resetLandingToIntro() {
  const intro = document.getElementById("landingIntro");
  const here = document.getElementById("landingStepHere");
  if (!intro || !here) return;
  intro.style.display = "block"; here.style.display = "none";
  const btn = document.getElementById("getStartedBtn");
  const manual = document.getElementById("landingManual");
  if (btn) btn.style.display = "";
  if (manual) { manual.style.display = "none"; manual.innerHTML = ""; }
}
window.goToInstallGate = () => {
  document.getElementById("landingIntro").style.display = "none";
  const here = document.getElementById("landingStepHere");
  here.style.display = "block";
  const explainer = document.getElementById("onboardingExplainer");
  if (explainer) {
    explainer.textContent = isPhone()
      ? "You'll get a notification here when it's time to reflect."
      : "Write your questions here — you'll get a notification on your phone when it's time to reflect.";
  }
};
function maybeOpenFromUrl() { const p = new URLSearchParams(location.search); if (p.get("reflect") === "1") { history.replaceState({}, "", location.pathname); openReflection(); } }

// ---------- cross-device pairing nudge (over the home screen) ----------
// Shown whenever THIS device is installed but the OTHER kind has never
// actually installed. Desktop's copy asks you to add mobile too and come
// back here; mobile's copy just sends you to desktop — no round-trip is
// asked of the phone, since tonight's notification still lands here either
// way. Dismissing ("Not now") only closes it for this visit: it reappears
// next time you open the app, or after your next commitment (see doCommit).
function otherKind() { return isPhone() ? "desktop" : "mobile"; }
function otherDeviceSeen() { return !!(window._onboarding && window._onboarding[otherKind() + "SeenAt"]); }
function qrSrcFor(url) {
  // higher error-correction + resolution so it scans instantly and holds up
  // sharp even on a retina display, not the soft/low-density default
  return "https://api.qrserver.com/v1/create-qr-code/?size=320x320&ecc=H&data=" + encodeURIComponent("https://" + url);
}
window.maybeShowOtherDeviceGate = function () {
  const gate = document.getElementById("otherDeviceGate");
  if (!gate) return false;
  if (otherDeviceSeen()) { gate.classList.remove("on"); return false; }
  const label = document.getElementById("otherDeviceLabel");
  const qr = document.getElementById("landingQr");
  const hint = document.getElementById("otherDeviceHint");
  if (isPhone()) {
    label.textContent = "Go set up Reflect & Commit on your computer to write your questions — you'll still get tonight's reflection right here.";
    qr.style.display = "none";
    hint.textContent = INSTALL_URL;
  } else {
    label.textContent = "Now install it on your phone too. Come back here once you're done.";
    qr.src = qrSrcFor(INSTALL_URL);
    qr.style.display = "block";
    hint.textContent = INSTALL_URL;
  }
  gate.classList.add("on");
  return true;
};
window.dismissOtherDeviceGate = () => {
  const gate = document.getElementById("otherDeviceGate");
  if (gate) gate.classList.remove("on");
};

// ---------- install ----------
let deferredInstallPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredInstallPrompt = e; });
function isMobileUA() { return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.userAgentData && navigator.userAgentData.mobile); }
window.onGetStarted = async () => {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    // 'appinstalled' (above) also fires and marks this device seen; this just
    // moves the screen along right away instead of waiting on that event.
    if (choice && choice.outcome === "accepted") enterHome();
    return;
  }
  document.getElementById("getStartedBtn").style.display = "none";
  const manual = document.getElementById("landingManual");
  manual.style.display = "block";
  manual.innerHTML = (isMobileUA()
    ? "tap ⋮ in your browser's toolbar, then Add to Home screen."
    : "click the install icon (⊕) in your address bar, or ⋮ menu → Install Reflect & Commit.")
    + '<button class="btn-quiet" style="margin-top:16px;display:block" onclick="onManualInstallDone()">I’ve done this — continue</button>';
};
// there's no JS signal at all for a manual "Add to Home Screen" (iOS Safari,
// and anyone who ignores the native prompt and does it by hand) — this is a
// best-effort "take my word for it and move on" continue button so people
// aren't stuck on this screen forever. The real confirmation still happens
// automatically on the NEXT launch, via markDeviceSeenIfInstalled() finding
// isStandalone() true.
window.onManualInstallDone = () => { markDeviceSeenIfInstalled(); enterHome(); };

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
function renderSettings() {
  document.querySelectorAll(".notify-time-hidden").forEach((el) => { el.value = settings.notifyTime || "20:00"; });
  renderNotifyLabel();
  // manual re-entry point for the cross-device nudge, once it's been
  // dismissed with "Not now" — hidden entirely once the pair is done.
  const otherBtn = document.getElementById("otherDeviceSettingsBtn");
  if (otherBtn) otherBtn.style.display = (typeof otherDeviceSeen === "function" && otherDeviceSeen()) ? "none" : "";
}
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

// ---------- tree editor (js/dsl-editor.js) ----------
// The DSL text IS the tree now — "paste tree" / "copy as text" just read or
// replace that text directly, no separate import/export format needed.
window.openPasteTree = () => {
  const m = document.getElementById("pasteTreeModal"); if (!m) return;
  const ta = document.getElementById("pasteTreeArea"); if (ta) ta.value = "";
  m.classList.add("on");
  setTimeout(() => ta && ta.focus(), 60);
};
window.closePasteTree = () => { const m = document.getElementById("pasteTreeModal"); if (m) m.classList.remove("on"); };
window.confirmPasteTree = () => {
  const ta = document.getElementById("pasteTreeArea");
  const t = ta ? ta.value : "";
  // opening this modal and hitting "replace" already IS the deliberate
  // confirmation, so skip the (redundant) native confirm() inside pasteTreeFromText.
  window.pasteTreeFromText(t, true);
  window.closePasteTree();
};
window.copyTreeButton = async (btn) => {
  const t = await window.copyTreeAsText();
  if (!t) return;
  const b = btn && btn.currentTarget ? btn.currentTarget : btn;
  if (b && "textContent" in b) {
    const orig = b.textContent; b.textContent = "copied"; setTimeout(() => { b.textContent = orig; }, 1100);
  }
};
function escapeHtml(s) { return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

// ---------- day-after check-in gate ----------
function dueCommitment() { const today = new Date(); today.setHours(0, 0, 0, 0); return (commitments || []).find((c) => c.status === "active" && c.dueDate && new Date(c.dueDate) <= today); }

// ---------- reflection ----------
async function openReflection() {
  if (!withinReflectWindow()) { document.getElementById("nextAvailLabel").textContent = nextScheduledLabel(); showScreen("unavailableScreen"); return; }
  showScreen("reflectScreen");
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
  if (draft.phase === "checkin") { const due = dueCommitment(); return due ? enterCheckin(due) : startWalk(); }
  if (draft.phase === "question") return renderChat();
  if (draft.phase === "commit") return enterCommit();
  if (draft.phase === "done") return enterDone(draft.committed);
  startWalk();
}
function startWalk() {
  const TM = window.TreeModel;
  const parsed = getParsed();
  const graph = TM.buildGraph(parsed);
  const roots = graph.roots.slice().sort((a, b) => a.rawLine - b.rawLine);
  const first = roots[0] || parsed.blocks[0];
  if (!first) return enterCommit();
  draft.phase = "question"; draft.currentName = first.name; draft.history = []; saveDraft();
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
  const node = currentNode();
  if (!node) return afterQuestions();
  setPhase("phaseChat");
  setBackVisible(draft.history.length > 0);
  setCollapseVisible(draft.history.length > 0);

  const scroll = document.getElementById("chatScroll");
  scroll.classList.toggle("collapsed", chatCollapsed);
  scroll.innerHTML = "";
  draft.history.forEach((name) => {
    const n = resolveBlock(name); if (!n) return;
    const a = draft.answers[name];
    const ans = a && typeof a === "object" ? a.label : (a || "");
    const item = document.createElement("div"); item.className = "chat-item past";
    item.innerHTML = `<div class="chat-q">${escapeHtml(n.name)}</div><div class="chat-a">${escapeHtml(ans)}</div>`;
    scroll.appendChild(item);
  });
  const cur = document.createElement("div"); cur.className = "chat-item current";
  cur.innerHTML = `<div class="chat-q big">${escapeHtml(node.name)}</div>`;
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
    (node.options || []).forEach((opt, k) => {
      const b = document.createElement("button"); b.className = "q-choice"; b.textContent = opt.label || ("option " + (k + 1));
      b.onclick = () => { b.classList.add("chosen"); chooseOption(node, k); };
      choices.appendChild(b);
    });
  } else {
    choices.style.display = "none"; bar.style.display = "flex";
    const field = document.getElementById("answerField");
    field.value = typeof draft.answers[node.name] === "string" ? draft.answers[node.name] : "";
    autoGrow(field);
    field.oninput = () => { draft.answers[node.name] = field.value; autoGrow(field); saveDraft(); };
    field.onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); composerSend(); } };
    if (node.recallTarget) { recall.style.display = "inline-flex"; recall.onclick = () => { const open = recall.classList.toggle("open"); rlist.classList.toggle("open", open); if (open) fillRecall(node, rlist); }; }
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
  if (draft.active && draft.phase && draft.day === todayKey()) { showScreen("reflectScreen"); resumePhase(); }
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

// answer history is logged per QUESTION TITLE (normalized), regardless of
// whether that question itself recalls anything — any OTHER question can
// later choose to recall it via the canvas's recall icon.
function submitText(node) {
  const TM = window.TreeModel;
  const ans = (draft.answers[node.name] || "").trim();
  if (ans) { const k = "rc_answer_hist_" + TM.norm(node.name); let h = []; try { h = JSON.parse(localStorage.getItem(k) || "[]"); } catch (_) {} h.unshift({ a: ans, t: Date.now() }); localStorage.setItem(k, JSON.stringify(h.slice(0, 30))); }
  advanceFrom(node);
}
function chooseOption(node, k) {
  const opt = (node.options || [])[k];
  draft.answers[node.name] = { optIndex: k, label: opt.label }; saveDraft();
  advanceFrom(node);
}
function advanceFrom(node) {
  stopVoice();
  const fresh = resolveBlock(node.name) || node;
  const star = starBlock();
  if (draft.mode !== "full" && star && star.name === fresh.name) {
    const nx = computeNext(fresh); draft.resumeName = nx ? nx.name : null; draft.lastQuestionName = fresh.name; saveDraft(); return enterCommit();
  }
  const nx = computeNext(fresh);
  if (!nx) { draft.lastQuestionName = fresh.name; draft.resumeName = null; saveDraft(); return afterQuestions(); }
  draft.history.push(fresh.name); draft.currentName = nx.name; saveDraft(); renderChat();
}
function afterQuestions() { stopVoice(); if (draft.mode === "full") return finishSession(); enterCommit(); }

// `node.recallTarget` is a question TITLE this question recalls (may be a
// different question, or itself) — resolved fresh each time in case titles
// were edited since the recall link was made.
function fillRecall(node, el) {
  const TM = window.TreeModel;
  const target = TM.resolveName(getParsed(), node.recallTarget);
  const key = "rc_answer_hist_" + TM.norm(target ? target.name : node.recallTarget);
  let h = []; try { h = JSON.parse(localStorage.getItem(key) || "[]"); } catch (_) {}
  if (!h.length) { el.innerHTML = "<div class='recall-empty'>nothing here yet</div>"; return; }
  el.innerHTML = h.slice(0, 10).map((x) => `<div class="recall-item"><span class="recall-date">${new Date(x.t).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>${escapeHtml(x.a)}</div>`).join("");
}

// -- back --
window.goBackPhase = () => {
  if (draft.phase === "question") { if (draft.history.length) { draft.currentName = draft.history.pop(); saveDraft(); renderChat(); } }
  else if (draft.phase === "commit") {
    // lastQuestionName should always be set on the way into commit, but fall
    // back to the last history entry (or the top of the list) rather than
    // silently doing nothing if it's ever missing.
    const parsed = getParsed();
    const target = draft.lastQuestionName || draft.history[draft.history.length - 1] || (parsed.blocks[0] && parsed.blocks[0].name);
    if (!target) return;
    draft.phase = "question"; draft.currentName = target; saveDraft(); renderChat();
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
function doCommit() {
  const text = (draft.commitText || "").trim();
  if (text) window._addCommitment && window._addCommitment({ text, dueDate: draft.commitDue });
  if (navigator.vibrate) navigator.vibrate(12);
  draft.committed = true;
  enterDone(true);
  // right after a real commitment is a good moment to nudge toward pairing
  // the other device, if that hasn't happened yet — no-ops once both
  // devices are installed.
  window.maybeShowOtherDeviceGate && window.maybeShowOtherDeviceGate();
}
window.skipCommit = () => { draft.committed = false; enterDone(false); };

// -- done --
function enterDone(committed) {
  stopVoice(); draft.phase = "done"; saveDraft(); setPhase("phaseDone"); setBackVisible(true); setCollapseVisible(false);
  document.getElementById("doneText").textContent = committed ? "committed. see you tomorrow." : "logged. see you tomorrow.";
  const kg = document.getElementById("keepGoingBtn"); kg.style.display = draft.resumeName ? "block" : "none";
}
window.keepReflecting = () => { draft.mode = "full"; draft.commitText = ""; draft.history = []; draft.currentName = draft.resumeName; draft.phase = "question"; saveDraft(); renderChat(); };

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
// once you've said something and then gone quiet for SILENCE_MS, send it,
// same as if you'd tapped the send button. One less tap per question when
// you're talking instead of typing.
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
      const n = currentNode(); if (n) draft.answers[n.name] = voiceField.value;
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
  window.renderDslEditor(); renderSettings();
});
