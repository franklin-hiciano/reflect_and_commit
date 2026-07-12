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
// the mobile login veil (reusing the device-shade) is a manual overlay, not
// driven by activeDevice — this flag keeps _onActiveDeviceUpdated from clearing
// it the moment an activeDevice snapshot arrives.
let _mobileVeilUp = false;
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
window.setDslText = function (newText, selRange, snapshotWeight) {
  const oldText = dslText;
  dslText = newText || "";
  // was defined in dsl-editor.js but never actually called from here —
  // version history never accumulated anything past the initial blank
  // snapshot, which is why it read as "too strict": it wasn't strict, it
  // was just never fed a single edit.
  window._noteDslSnapshot && window._noteDslSnapshot(oldText, dslText, snapshotWeight || 0);
  saveLocalTree();
  window._saveTree && window._saveTree(dslText);
  window.renderDslEditor();
  if (typeof window._renderTreeGraph === "function") window._renderTreeGraph();
};

// ---------- firestore hooks ----------
let lastRenderedTree = null;
// first-tree auto-trigger: a brand-new signed-in user with a genuinely empty
// tree gets seeded with the onboarding META_TREE (js/meta-tree.js) instead of
// landing on a blank DSL editor with nothing to walk. Gated on a one-time
// local flag (same pattern as rc_seen_intro/rc_mobile_unveiled elsewhere) so
// a RETURNING user who deliberately empties their tree later doesn't get
// silently re-seeded every time _onTreeUpdated fires on an empty doc.
function maybeSeedFirstTree(text) {
  try { if (localStorage.getItem("rc_metatree_seeded") === "1") return false; } catch (_) {}
  const TM = window.TreeModel;
  if (!TM || !window.META_TREE) return false;
  let blockCount = 0;
  try { blockCount = (TM.parse(text || "").blocks || []).length; } catch (_) { return false; }
  if (blockCount > 0) return false;
  try { localStorage.setItem("rc_metatree_seeded", "1"); } catch (_) {}
  window.setDslText(window.META_TREE);
  return true;
}
window._onTreeUpdated = () => {
  if (typeof window._tree === "string") {
    if (maybeSeedFirstTree(window._tree)) return; // setDslText above already re-renders + persists
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
window._onSettingsUpdated = () => {
  if (window._settings && window._settings.notifyTime) {
    settings = window._settings; saveLocalSettings(); renderSettings();
    if (window._fcmToken) {
      const [h, m] = settings.notifyTime.split(":").map(Number);
      scheduleNotificationOnBackend(h, m, window._fcmToken);
    }
  }
};
window._onCommitmentsUpdated = () => { commitments = window._commitments || []; renderHomePill(); };

// ---------- home pill: play · commitment · streak (ideas executed) · pfp ----------
// streak = CUMULATIVE ideas executed (can't be broken — measures follow-through,
// not attendance), shown as a lightbulb (gray at 0, lit once >0). The pill text
// is the most recent live commitment; the dropdown shows hold-to-resolve
// buttons for it plus the resolved history (time delta for done, ✕ for
// missed), newest first. Gray "not done yet" entries don't pile up — only
// resolved ones stay.
let _commitPillOpen = false;
function _pillSorted() {
  return (commitments || []).slice().sort((a, b) => new Date(b.dueDate || b.createdAt || 0) - new Date(a.dueDate || a.createdAt || 0));
}
function renderHomePill() {
  const pill = document.getElementById("homePill");
  if (!pill) return;
  const sorted = _pillSorted();
  const active = sorted.find((c) => c.status === "active");
  const kept = (commitments || []).filter((c) => c.status === "done").length;
  const txt = document.getElementById("homePillCommitText");
  if (txt) txt.textContent = active ? active.text : "no commitments to show";
  const streak = document.getElementById("homePillStreak");
  const count = document.getElementById("homePillStreakCount");
  if (count) count.textContent = String(kept);
  if (streak) streak.classList.toggle("lit", kept > 0); // lightbulb: gray at 0, lit once >0
  // opening the pill (0D → the "open" class) reveals the truncated commit
  // text AND the dropdown TOGETHER — there's no separate horizontal-only
  // intermediate stage, both are driven by the same _commitPillOpen flag.
  pill.classList.toggle("open", _commitPillOpen);
  renderCommitDrop(sorted, active);
}
// want→done: per-item time delta (shown next to each completed entry) +
// overall conversion rate (the bottom bar in the dropdown). Opening the app
// can't move either number — only doing things can.
function _tsMs(v) {
  if (!v) return null;
  if (typeof v.toMillis === "function") return v.toMillis();
  if (v.seconds != null) return v.seconds * 1000;
  const t = new Date(v).getTime();
  return isNaN(t) ? null : t;
}
function _fmtDelta(ms) {
  const d = ms / 86400000;
  return d >= 1 ? d.toFixed(1) + "d" : Math.max(1, Math.round(d * 24)) + "h";
}
function renderCommitDrop(sorted, active) {
  const drop = document.getElementById("homePillDrop");
  if (!drop) return;
  drop.classList.toggle("on", _commitPillOpen);
  if (!_commitPillOpen) return;
  drop.innerHTML = "";
  if (active) {
    const q = document.createElement("div");
    q.className = "home-pill-drop-active";
    q.textContent = active.text;
    drop.appendChild(q);
    const label = document.createElement("div");
    label.className = "home-pill-drop-question";
    label.textContent = "done?";
    drop.appendChild(label);
    const row = document.createElement("div");
    row.className = "home-pill-drop-btns";
    row.appendChild(_holdBtn("yes", "yes", () => _resolvePill(active.id, "done")));
    row.appendChild(_holdBtn("no", "no", () => _resolvePill(active.id, "missed")));
    drop.appendChild(row);
  }
  const past = sorted.filter((c) => c.status === "done" || c.status === "missed");
  const list = document.createElement("div");
  list.className = "home-pill-past";
  if (!past.length && !active) {
    const e = document.createElement("div");
    e.className = "home-pill-empty";
    e.textContent = "no commitments to show";
    list.appendChild(e);
  }
  past.forEach((c) => {
    const item = document.createElement("div");
    item.className = "home-pill-past-item";
    const t = document.createElement("span"); t.textContent = c.text;
    item.appendChild(t);
    if (c.status === "done") {
      // time delta on the right, instead of a checkmark — how long it took.
      const a = _tsMs(c.createdAt), b = _tsMs(c.resolvedAt);
      const ms = a && b && b > a ? b - a : null;
      const d = document.createElement("span");
      d.className = "delta";
      d.textContent = ms ? _fmtDelta(ms) : "";
      item.appendChild(d);
    } else {
      const m = document.createElement("span"); m.className = "mark missed"; m.textContent = "✕";
      item.appendChild(m);
    }
    list.appendChild(item);
  });
  drop.appendChild(list);
  // completion-rate bar — bottom of the dropdown, a clear "x% done" readout.
  if (past.length) {
    const doneCount = past.filter((c) => c.status === "done").length;
    const pct = Math.round((doneCount / past.length) * 100);
    const rate = document.createElement("div");
    rate.className = "home-pill-rate";
    rate.title = "want → done: conversion rate";
    const bar = document.createElement("div");
    bar.className = "home-pill-rate-bar";
    const barFill = document.createElement("div");
    barFill.className = "home-pill-rate-fill";
    barFill.style.width = pct + "%";
    bar.appendChild(barFill);
    const pctLabel = document.createElement("span");
    pctLabel.className = "home-pill-rate-pct";
    pctLabel.textContent = pct + "% done";
    rate.appendChild(bar);
    rate.appendChild(pctLabel);
    drop.appendChild(rate);
  }
}
// hold-to-fill: press and keep holding ~600ms to resolve — a tap does nothing,
// same contract as the reflection's hold rings.
function _holdBtn(label, kind, onHold) {
  const b = document.createElement("button");
  b.className = "home-pill-hold " + kind;
  b.textContent = label;
  let timer = null;
  const start = (e) => { e.preventDefault(); b.classList.add("holding"); timer = setTimeout(() => { b.classList.remove("holding"); onHold(); }, 600); };
  const stop = () => { b.classList.remove("holding"); clearTimeout(timer); timer = null; };
  b.addEventListener("mousedown", start); b.addEventListener("touchstart", start, { passive: false });
  ["mouseup", "mouseleave", "touchend", "touchcancel"].forEach((ev) => b.addEventListener(ev, stop));
  return b;
}
function _resolvePill(id, status) {
  window._resolveCommitment && window._resolveCommitment(id, status);
  _commitPillOpen = false;
  renderHomePill();
}
window.toggleCommitPill = () => { _commitPillOpen = !_commitPillOpen; renderHomePill(); };
window._onDraftUpdated = () => { const rd = window._remoteDraft; if (rd && rd.active && !draft.active) { draft = { ...blankDraft(), ...rd }; localStorage.setItem(LS_DRAFT, JSON.stringify(draft)); } };
window._onSignedIn = () => {
  window.renderDslEditor(); renderSettings(); renderHomePill();
  // notifications are a phone-only concern — desktop is purely for growing the
  // tree, so it neither runs the local reflection-reminder loop nor registers
  // for push. (Sending a pairing ping TO the phone still works — that uses the
  // phone's own token, below.)
  if (isPhone()) scheduleNotificationLoop();
  routeAfterAuth();
  maybeOpenFromUrl();
  if (isPhone() && "Notification" in window && Notification.permission === "granted") window._registerPush && window._registerPush(deviceKind());
  window._claimActiveDevice && window._claimActiveDevice(deviceKind());
  markDeviceSeenIfInstalled();
  // Desktop first launch: if phone hasn't onboarded yet, fire a push to it.
  if (!isPhone() && isStandalone() && !mobileOnboarded()) sendPairingPushToPhone();
};
function deviceKind() { return isPhone() ? "mobile" : "desktop"; }
// hard, once-only gate: validated means the user set a time AND granted
// permission, recorded BOTH remotely and locally — the local flag makes the
// gate immune to the async race where _deviceData hasn't loaded yet (the
// "let me in first launch, nagged every launch after" bug).
function isNotifValidated() {
  try { if (localStorage.getItem("rc_notif_validated") === "1") return true; } catch (_) {}
  return !!(window._deviceData && window._deviceData.notifValidatedAt);
}
function isIOS() { return /iPhone|iPad|iPod/i.test(navigator.userAgent); }
function isAndroid() { return /Android/i.test(navigator.userAgent); }
function isChrome() { return /Chrome/.test(navigator.userAgent) && !/Edge|OPR/.test(navigator.userAgent); }
function isEdge() { return /Edge/.test(navigator.userAgent); }
function isSafari() { return /Safari/.test(navigator.userAgent) && !/Chrome|Edge|OPR/.test(navigator.userAgent); }
function isSamsungInternet() { return /SamsungBrowser/.test(navigator.userAgent); }
function isBrave() { return /Brave/.test(navigator.userAgent); }
function isFirefox() { return /Firefox/.test(navigator.userAgent); }
function isPWASupportedBrowser() {
  return isChrome() || isEdge() || isSafari() || isSamsungInternet() || isBrave() || isFirefox();
}
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
  const landing = document.getElementById("landingScreen");
  if (landing && landing.classList.contains("on")) showAlmostThere();
});
// fires whenever the onboarding doc changes — this is how the OTHER device
// signing in gets noticed live, with nothing to click or refresh: if the
// gate is up because we're waiting on it, this either drops it or (rarely)
// re-renders it if something upstream re-triggered it.
window._onOnboardingUpdated = () => {
  const home = document.getElementById("homeScreen");
  if (!home) return;
  if (home.classList.contains("on")) {
    // Home is open — gate only ever shows on home if mobile isn't onboarded
    // yet. After persistence it's gone for the life of the account.
    maybeShowOtherDeviceGate();
  } else if (!isPhone() && isStandalone()) {
    // Desktop might be blocked on "waiting for phone" — auto-advance when
    // mobileOnboardedAt shows up in the live snapshot.
    if (mobileOnboarded()) enterHome();
  }
  renderSettings();
};
// focusing this device is treated as "I'm using this one now" — claim it as
// active so the other device shades itself.
window.addEventListener("focus", () => { if (window._uid) window._claimActiveDevice && window._claimActiveDevice(deviceKind(), currentActivityPhase()); });

function currentActivityPhase() {
  const home = document.getElementById("homeScreen");
  const reflect = document.getElementById("reflectScreen");
  if (reflect && reflect.classList.contains("on")) return "reflecting";
  if (home && home.classList.contains("on") && !isPhone()) return "editing";
  return "idle";
}

function updateActivityPhase() {
  if (window._uid && window._claimActiveDevice) {
     window._claimActiveDevice(deviceKind(), currentActivityPhase());
  }
}

// ---------- PWA detection with sessionStorage persistence ----------
// Once we've confirmed we're running in standalone mode, remember it for
// the rest of the session — this prevents the "almost there" screen from
// reappearing on reload when the display-mode media query momentarily
// returns false (e.g. during SW controller change).
const STANDALONE_KEY = "rc_known_standalone";
function isStandalone() {
  const mq = window.matchMedia("(display-mode: standalone)");
  const mqMinimal = window.matchMedia("(display-mode: minimal-ui)");
  const standalone = mq.matches || mqMinimal.matches || window.navigator.standalone === true;
  if (standalone) {
    try { sessionStorage.setItem(STANDALONE_KEY, "1"); } catch (_) {}
    return true;
  }
  // If we've already confirmed standalone this session, trust it
  try { if (sessionStorage.getItem(STANDALONE_KEY) === "1") return true; } catch (_) {}
  return false;
}

// Auto-recheck on focus/visibility change — handles the case where the
// app was launched from home screen but the media query hadn't settled yet.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && isStandalone()) {
    // If we're on the landing screen and now confirmed standalone, re-route
    const landing = document.getElementById("landingScreen");
    if (landing && landing.classList.contains("on")) routeAfterAuth();
  }
});
window.addEventListener("focus", () => {
  if (isStandalone()) {
    const landing = document.getElementById("landingScreen");
    if (landing && landing.classList.contains("on")) routeAfterAuth();
  }
});

// ---------- routing ----------
function showScreen(id) { document.querySelectorAll(".screen").forEach((s) => s.classList.remove("on")); document.getElementById(id).classList.add("on"); updateActivityPhase(); }
// landing on the home screen: the cross-device nudge takes priority over the
// (lower-stakes) "editing on phone" reminder — no point warning someone about
// editing on their phone before they even have the option of a desktop.
// Hard gate: the home screen (question editor + reflection) is only ever
// reachable from an actually-installed, standalone launch — never a plain
// browser tab, even mid-session. If it's not standalone yet, stay right on
// the install step with a clear nudge — silently resetting all the way back
// to the tagline screen (no explanation) is what read as "the button
// doesn't work."
// Show post-install nudge. Only called from the install flow (appinstalled
// event, or after the install prompt is accepted). Never called on a normal
// open — that path goes straight to enterHome().
function showAlmostThere() {
  // Already in the installed app — no nudge needed
  if (isStandalone()) return;
  showScreen("landingScreen");
  const intro = document.getElementById("landingIntro");
  const here = document.getElementById("landingStepHere");
  if (intro && here) { intro.style.display = "none"; here.style.display = "block"; }
  ["getStartedBtn", "onboardingNotifyGroup"].forEach((id) => {
    const el = document.getElementById(id); if (el) el.style.display = "none";
  });
  const manualBox = document.getElementById("landingManualSteps");
  if (manualBox && manualBox.parentElement) manualBox.parentElement.style.display = "none";
  const trouble = document.getElementById("installTroubleshooting");
  if (trouble) trouble.style.display = "none";
  const explainer = document.getElementById("onboardingExplainer");
  if (explainer) {
    explainer.textContent = isPhone()
      ? "Almost there — open Reflect & Commit from your home screen to finish setup."
      : "Almost there — open the installed Reflect & Commit app to finish. If nothing happened, it may already be installed — remove it from chrome://apps and try again.";
  }
}

// Auto-recheck standalone status when the page gains focus/visibility
// This handles the Ctrl+R case where display-mode isn't immediately reported
function maybeRecheckStandalone() {
  if (isStandalone()) {
    routeAfterAuth();
  }
}
window.addEventListener("focus", maybeRecheckStandalone);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") maybeRecheckStandalone();
});

function enterHome() {
  showScreen("homeScreen");
  renderUserMenu();
  applyDeviceChrome();
  maybeShowOtherDeviceGate();
  maybeVeilMobile();
}
// desktop is edit-only: strip the notification chrome (reflection-time clock +
// "edit reflection time" / "send test notification" menu items) so nothing on
// desktop implies it will ever notify you. Phone keeps all of it.
function applyDeviceChrome() {
  const phone = isPhone();
  const clock = document.querySelector(".home-clock-group");
  if (clock) clock.style.display = phone ? "" : "none";
  ["settingsEditTime", "settingsTestNotif"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.style.display = phone ? "" : "none";
  });
}
// "put the veil up once you login on mobile" — the first time a phone lands on
// home after signing in, drop the same device-shade it would show if desktop
// were the active device, so the phone reads as "your questions live on the
// computer." One tap on "use here instead" lifts it for good on this device.
function maybeVeilMobile() {
  if (!isPhone()) return;
  try { if (localStorage.getItem("rc_mobile_unveiled") === "1") return; } catch (_) {}
  const shade = document.getElementById("deviceShade");
  const title = document.querySelector(".device-shade-title");
  if (title) title.textContent = "in use on your other device";
  _mobileVeilUp = true;
  if (shade) shade.classList.add("on");
}
window.useHereInstead = () => {
  try { localStorage.setItem("rc_mobile_unveiled", "1"); } catch (_) {}
  _mobileVeilUp = false;
  const shade = document.getElementById("deviceShade");
  if (shade) shade.classList.remove("on");
  takeOverDevice();
};
// account menu trigger (inside the home pill) — avatar only, no name text
// (the name span was removed from both index.html files).
function renderUserMenu() {
  const avatar = document.getElementById("userMenuAvatar");
  if (avatar) {
    if (window._userPhoto) { avatar.src = window._userPhoto; avatar.style.display = "block"; }
    else avatar.style.display = "none";
  }
}
function goHome() { stopVoice(); if (isStandalone()) { enterHome(); } else { showScreen("landingScreen"); resetLandingToIntro(); } }
// install is required on every device before use — phone AND desktop each
// get their own install prompt the first time they sign in on that device.
// Mobile follows a strict linear flow: install → notifications → time → done.
// Desktop: install, then gate until mobile onboarding is complete (first time only).
function routeAfterAuth() {
  // §3g fix: a live reflection must never be interrupted by a routing
  // re-check. This gets called from several re-entry points beyond initial
  // sign-in — a focus listener (maybeRecheckStandalone) re-invokes it on
  // EVERY window refocus with no guard at all, which is what was silently
  // kicking desktop back to the home/editor screen mid-reflection (the
  // "switches back to editing mode on its own" bug). Reuses the exact same
  // "is this draft still today's" staleness check resumePhase() already
  // relies on elsewhere — a genuinely stale (not-today, or already-done)
  // draft is still safe to route past.
  if (
    document.getElementById("reflectScreen").classList.contains("on") &&
    draft.active && draft.phase && draft.phase !== "done" && draft.day === todayKey()
  ) return;

  // First thing on first entry: a single-action "Got it" intro screen. One tap
  // and it's never shown again (rc_seen_intro). The user owns the copy.
  if (!hasSeenIntro()) { showScreen("landingScreen"); showGotIt(); return; }

  if (!isStandalone()) {
    showScreen("landingScreen");
    if (!isPhone() && !isPWASupportedBrowser()) {
      showUnsupportedBrowserScreen();
    } else {
      resetLandingToIntro();
    }
    return;
  }

  // --- Device is standalone (installed PWA) ---
  if (isPhone()) {
    // Mobile onboarding — one screen, one action: install → enable
    // notifications → home. Reflection time defaults to 20:00 and is changed
    // later from the home clock, so it's no longer its own onboarding step.
    if (!isNotifValidated()) {
      // time FIRST, then permission — the two-step onboarding, exactly once
      showScreen("landingScreen");
      hideAllLandingPanes();
      window.goToNotifySetup();
      return;
    }
    completeMobileOnboarding();
  } else {
    // Desktop: gate only on FIRST launch until mobile has onboarded
    if (!mobileOnboarded()) {
      showScreen("landingScreen");
      showDesktopFirstLaunchGate();
    } else {
      enterHome();
    }
  }
}

// --- Mobile onboarding completion ---
function completeMobileOnboarding() {
  // Write the permanent "mobile onboarded" flag
  window._markMobileOnboarded && window._markMobileOnboarded();
  // Trigger handoff so desktop auto-advances if it's waiting
  window._consumeHandoff && window._consumeHandoff();
  enterHome();
}

// --- Desktop first-launch gate (until phone is onboarded) ---
function showDesktopFirstLaunchGate() {
  document.getElementById("landingIntro").style.display = "none";
  const here = document.getElementById("landingStepHere");
  if (here) here.style.display = "block";
  const explainer = document.getElementById("onboardingExplainer");
  if (explainer) {
    // Render the QR + link INLINE on this (visible) screen. The old code put the
    // QR in #otherDeviceGate, which lives inside the hidden #homeScreen — so the
    // QR either never showed or flashed and was replaced by this copy screen.
    // The link is intentionally NOT a clickable anchor: you're meant to type it
    // on your phone, not open it on the desktop you're already looking at.
    explainer.innerHTML =
      "Install Reflect &amp; Commit on your phone first. Scan the QR code or type this link on your phone:" +
      "<img src='" + qrSrcFor(INSTALL_URL) + "' alt='scan to install on your phone' " +
      "style='display:block; width:190px; height:190px; margin:18px auto; border-radius:12px; background:#fff; padding:10px' />" +
      "<span style='display:block; text-align:center; color: var(--ink-dim); word-break: break-all; user-select: all; -webkit-user-select: all'>" +
      "https://" + INSTALL_URL + "</span>";
  }
  const getStartedBtn = document.getElementById("getStartedBtn");
  if (getStartedBtn) getStartedBtn.style.display = "none";
  // Hide manual fallback (not relevant on desktop first-launch)
  const manualBox = document.getElementById("landingManualSteps");
  if (manualBox && manualBox.parentElement) manualBox.parentElement.style.display = "none";
  const trouble = document.getElementById("installTroubleshooting");
  if (trouble) trouble.style.display = "none";
}

function mobileOnboarded() {
  return !!(window._onboarding && window._onboarding.mobileOnboardedAt);
}

// ---------- first-run "Got it" intro (single action) ----------
function hasSeenIntro() { try { return localStorage.getItem("rc_seen_intro") === "1"; } catch (_) { return false; } }
function hideAllLandingPanes() { document.querySelectorAll("#landingScreen .landing-inner").forEach((el) => { el.style.display = "none"; }); }
function showGotIt() { hideAllLandingPanes(); const g = document.getElementById("landingGotIt"); if (g) g.style.display = "block"; }
window.dismissGotIt = () => { try { localStorage.setItem("rc_seen_intro", "1"); } catch (_) {} routeAfterAuth(); };

// --- Desktop: fire a push notification to the phone ---
async function sendPairingPushToPhone() {
  if (!window._uid || isPhone()) return;
  const btn = document.getElementById("sendPairingNotifBtn");
  if (!btn) return;
  if (btn.dataset.sent === "1") return; // already sent, don't spam
  const dev = await window._getMobileDeviceToken();
  if (!dev || !dev.token) { btn.style.display = "none"; return; }
  btn.dataset.sent = "1";
  btn.textContent = "Sent a notification to your phone";
  try {
    await fetch("/api/send-now", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fcmToken: dev.token,
        title: "Open Reflect & Commit",
        body: "Finish setup to pair your phone.",
      }),
    });
  } catch (_) {}
}

// ---------- mobile edit restriction ----------
// Removing the desktop-only edit lock on mobile: phone shows the editor
// just like desktop does — the "go edit on desktop" suggestion was a
// paternalistic distraction that suppressed curiosity. Live presence
// (the activeDevice shade) still tells the user when desktop is editing,
// but they can still look at and modify questions right on the phone.
//
// Mobile edit lock code intentionally left here as a comment block so the
// git history of WHY it was nuked is self-documenting:
//
// let _mobileEditUnlocked = false;
// function applyMobileEditRestriction() {
//   const editor = document.getElementById("dslHome");
//   const notice = document.getElementById("mobileEditNotice");
//   const anywayBtn = document.getElementById("accessEditorAnywayBtn");
//   const phone = isPhone();
//   const hide = phone && !_mobileEditUnlocked;
//   if (editor) editor.style.display = hide ? "none" : "";
//   if (notice) notice.style.display = hide ? "block" : "none";
//   if (anywayBtn) anywayBtn.style.display = hide ? "block" : "none";
// }
// window.accessEditorAnyway = () => { _mobileEditUnlocked = true; applyMobileEditRestriction(); };

// ---------- local install (this device) ----------
// "Get started" leads straight into installing THIS device — no detour
// through "go install the other one first". Once this device is genuinely
// installed, maybeShowOtherDeviceGate() takes over the cross-device ask, as
// an overlay over the home screen rather than a gate in front of it.
const INSTALL_URL = "reflectandcommit.com/install";
function resetLandingToIntro() {
  const intro = document.getElementById("landingIntro");
  const here = document.getElementById("landingStepHere");
  const notifySetup = document.getElementById("landingNotifySetup");
  const denied = document.getElementById("landingPermissionDenied");
  const unsupported = document.getElementById("landingUnsupportedBrowser");
  const enableBtn = document.getElementById("enableNotifBtn");
  const gotIt = document.getElementById("landingGotIt");
  if (!intro || !here) return;
  intro.style.display = "block"; here.style.display = "none";
  if (notifySetup) notifySetup.style.display = "none";
  if (denied) denied.style.display = "none";
  if (unsupported) unsupported.style.display = "none";
  if (gotIt) gotIt.style.display = "none";
  
  // Both phone AND desktop show "Install" first (introGetStartedBtn).
  // Notifications come after install, phone-only.
  const introGetStartedBtn = document.getElementById("introGetStartedBtn");
  if (introGetStartedBtn) introGetStartedBtn.style.display = "";
  if (enableBtn) enableBtn.style.display = "none";
}

function showUnsupportedBrowserScreen() {
  document.getElementById("landingIntro").style.display = "none";
  const unsupported = document.getElementById("landingUnsupportedBrowser");
  if (unsupported) unsupported.style.display = "block";
}

async function handlePermissionRequest() {
  if (!("Notification" in window)) {
    alert("This browser doesn't support notifications. Please use Chrome or Safari.");
    return;
  }

  const permission = Notification.permission;
  
  if (permission === "granted") {
    // Already granted, proceed to notify setup
    window.goToNotifySetup();
    return;
  }

  if (permission === "denied") {
    // Already denied, show instructions
    showPermissionDenied();
    return;
  }

  // permission === "default", request it
  const result = await Notification.requestPermission();
  if (result === "granted") {
    window.goToNotifySetup();
  } else {
    showPermissionDenied();
  }
}

function showPermissionDenied() {
  document.getElementById("landingIntro").style.display = "none";
  document.getElementById("landingNotifySetup").style.display = "none";
  document.getElementById("landingStepHere").style.display = "none";
  const denied = document.getElementById("landingPermissionDenied");
  denied.style.display = "block";

  // Show platform-specific instructions
  const instructions = document.getElementById("permissionInstructions");
  if (isIOS()) {
    if (isStandalone()) {
      instructions.innerHTML = `
        <div style="font-weight: 600; margin-bottom: 8px">iOS (Installed App):</div>
        <div>1. Open Settings</div>
        <div>2. Find Reflect & Commit</div>
        <div>3. Tap Notifications</div>
        <div>4. Enable "Allow Notifications"</div>
      `;
    } else {
      instructions.innerHTML = `
        <div style="font-weight: 600; margin-bottom: 8px">iOS (Safari):</div>
        <div>1. Open Settings</div>
        <div>2. Scroll to Safari</div>
        <div>3. Tap Notifications</div>
        <div>4. Find this site and enable notifications</div>
      `;
    }
  } else if (isAndroid()) {
    instructions.innerHTML = `
      <div style="font-weight: 600; margin-bottom: 8px">Android (Chrome):</div>
      <div>1. Tap Chrome menu (⋮)</div>
      <div>2. Tap Settings</div>
      <div>3. Tap Site Settings</div>
      <div>4. Tap Notifications</div>
      <div>5. Find this site and set to "Allow"</div>
    `;
  } else {
    instructions.innerHTML = `
      <div style="font-weight: 600; margin-bottom: 8px">Desktop:</div>
      <div>1. Click the lock/info icon in your address bar</div>
      <div>2. Find "Notifications" or "Site Settings"</div>
      <div>3. Set to "Allow"</div>
    `;
  }
}

async function retryPermission() {
  // Re-check permission in case user manually enabled it
  const permission = Notification.permission;
  if (permission === "granted") {
    window.goToNotifySetup();
  } else {
    alert("Notifications are still blocked. Please follow the instructions above to enable them, then tap Try Again.");
  }
}
window.goToNotifySetup = async () => {
  document.getElementById("landingIntro").style.display = "none";
  const notifySetup = document.getElementById("landingNotifySetup");
  notifySetup.style.display = "block";
  renderNotifyLabel();
};

// Mobile linear onboarding: after install, go to time picker first
function goToMobileNotifySetup() {
  window.goToNotifySetup();
}

// Single-action notification step: just the "Enable notifications" screen.
window.goToNotifPermission = () => {
  hideAllLandingPanes();
  const p = document.getElementById("landingNotifPermission");
  if (p) p.style.display = "block";
};

// Step 2: User taps Enable Notifications -> request permission, then complete
window.requestNotifPermissionOnboard = async () => {
  const ok = await requestNotifPermission();
  if (!ok) { showPermissionDenied(); return; }
  window._registerPush && window._registerPush(deviceKind());
  await (window._markNotifValidated && window._markNotifValidated());
  // _markNotifValidated writes both mobileNotifEnabledAt AND mobileOnboardedAt
  // atomically; we're done with onboarding — go straight home.
  enterHome();
};

// Mobile linear onboarding step 2 (old combined): enable notifications.
// User picks a time first (default 20:00), then taps the enable button.
window.notifSetupContinue = async () => {
  const ok = await requestNotifPermission();
  if (!ok) { showPermissionDenied(); return; }
  window._registerPush && window._registerPush(deviceKind());
  await (window._markNotifValidated && window._markNotifValidated());
  // _markNotifValidated writes both mobileNotifEnabledAt AND mobileOnboardedAt
  // atomically; we're done with onboarding — go straight home.
  enterHome();
};

window.goToInstallGate = () => {
  document.getElementById("landingIntro").style.display = "none";
  const here = document.getElementById("landingStepHere");
  here.style.display = "block";
  const explainer = document.getElementById("onboardingExplainer");
  const getStartedBtn = document.getElementById("getStartedBtn");
  const steps = document.getElementById("landingManualSteps");

  if (isStandalone()) {
    // Already installed — go straight home if mobile is onboarded, show
    // pairing gate otherwise (desktop), or go to notify setup (phone).
    if (isPhone()) {
      goToMobileNotifySetup();
      return;
    }
    if (mobileOnboarded()) { enterHome(); return; }
    // Mobile not onboarded yet — show the pairing gate (QR in overlay)
    if (explainer) explainer.textContent = "";
    if (getStartedBtn) getStartedBtn.style.display = "none";
    const manualBox = document.getElementById("landingManualSteps");
    if (manualBox && manualBox.parentElement) manualBox.parentElement.style.display = "none";
    maybeShowOtherDeviceGate();
    return;
  }

  // Not yet installed on THIS device.
  if (explainer) explainer.textContent = "";
  if (getStartedBtn) getStartedBtn.style.display = "block";

  if (isPhone()) {
    // Phone: the ONLY prompt-less install path is iOS Safari's manual
    // Share -> Add to Home Screen (and it must be Safari — Chrome/Firefox on
    // iOS just make a bookmark, not a standalone PWA). Android fires the native
    // install prompt via the button above, so we don't hand out a manual method
    // that wouldn't actually install a PWA there.
    if (steps) {
      const shareIcon = "<svg viewBox='0 0 24 24' width='14' height='14' style='vertical-align:middle;margin:0 2px' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8'/><polyline points='16 6 12 2 8 6'/><line x1='12' y1='2' x2='12' y2='15'/></svg>";
      let html;
      if (isIOS() && isSafari()) {
        html = "Tap the Share button " + shareIcon + " then <b>Add to Home Screen</b>.";
      } else if (isIOS()) {
        html = "Open this page in <b>Safari</b> first — then Share " + shareIcon + " &rarr; <b>Add to Home Screen</b>. (Other iOS browsers can't install the app.)";
      } else {
        html = "Tap <b>Install Reflect &amp; Commit</b> above. If you don't see a prompt, open your browser menu and choose <b>Install app</b>.";
      }
      if (steps.parentElement) steps.parentElement.style.display = "";
      steps.innerHTML = "<div style='font-size:12.5px;color:var(--ink-dim);line-height:1.6'>" + html + "</div>";
    }
  } else {
    // Desktop installs ITSELF here. The phone-pairing QR deliberately does NOT
    // appear in the browser tab — you don't install desktop and phone at the
    // same moment, so the QR only shows once you're inside the installed app
    // (the otherDeviceGate overlay). Here we just point at the desktop install.
    if (steps) {
      if (steps.parentElement) steps.parentElement.style.display = "";
      steps.innerHTML = "<div style='font-size:12.5px;color:var(--ink-dim);line-height:1.6'>" +
        "Click <b>Install Reflect &amp; Commit</b> above, or use the install icon in your browser's address bar.</div>";
    }
  }
  const reinstallTroubleshooting = document.getElementById("reinstallTroubleshooting");
  if (reinstallTroubleshooting && isChrome()) reinstallTroubleshooting.style.display = "inline";
};
function maybeOpenFromUrl() {
  const p = new URLSearchParams(location.search);
  // ?reflect=1 is set by the sw.js notification click — opens straight into
  // the reflection flow when the user taps a "Time to reflect" notification.
  if (p.get("reflect") === "1") { history.replaceState({}, "", location.pathname); openReflection(); }
}

// ---------- cross-device HARD gate (no dismiss) ----------
// Shown whenever THIS device is installed but the OTHER kind has never
// actually installed. Unlike a dismissible nudge, there is no way past this
// screen except the other device actually completing its own install —
// this app is only worth using once both are paired, so it blocks rather
// than nags.
function qrSrcFor(url) {
  return "https://api.qrserver.com/v1/create-qr-code/?size=320x320&ecc=H&data=" + encodeURIComponent("https://" + url);
}
window.maybeShowOtherDeviceGate = function () {
  const gate = document.getElementById("otherDeviceGate");
  if (!gate) return false;
  
  // Gate is only ever active on first launch if mobile hasn't onboarded yet.
  if (mobileOnboarded()) { gate.classList.remove("on"); return false; }

  const label = document.getElementById("otherDeviceLabel");
  const qr = document.getElementById("landingQr");
  const hint = document.getElementById("otherDeviceHint");
  const avatar = document.getElementById("otherDeviceAvatar");
  if (avatar) {
    if (window._userPhoto) { avatar.src = window._userPhoto; avatar.alt = window._userName || "signed-in account"; avatar.title = window._userName || ""; avatar.style.display = "block"; }
    else avatar.style.display = "none";
  }

  if (isPhone()) {
    // Mobile never gets the pairing gate overlay itself once installed —
    // it just goes to home, and setting up notifications auto-unlocks desktop.
    gate.classList.remove("on");
    return false;
  } else {
    // Desktop pairing gate: show QR + "send notification" button
    label.textContent = "Now install it on your phone too" + (window._userEmail ? (" as " + window._userEmail) : "") + ". Come back here once you're done.";
    qr.src = qrSrcFor(INSTALL_URL);
    qr.style.display = "block";
    hint.textContent = INSTALL_URL;

    // Check if phone has registered an FCM token so we can show "send notification"
    const sendBtn = document.getElementById("sendPairingNotifBtn");
    if (sendBtn) {
      window._getMobileDeviceToken().then((dev) => {
        if (dev && dev.token) {
          sendBtn.style.display = "block";
          if (sendBtn.dataset.sent !== "1") {
            sendBtn.textContent = "Send a notification to your phone";
          }
        } else {
          sendBtn.style.display = "none";
        }
      });
    }
  }
  gate.classList.add("on");
  return true;
};
window.resetPairing = async () => {
  if (!confirm("Reset device pairing? Both devices will need to be marked installed again.")) return;
  await (window._resetPairing && window._resetPairing());
  window._onboarding = {};
  maybeShowOtherDeviceGate();
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
    if (choice && choice.outcome === "accepted") { markDeviceSeenIfInstalled(); showAlmostThere(); }
    return;
  }
  // No native prompt (iOS manual add-to-home-screen, or prompt not fired).
  // Trust the user clicked the address-bar icon; show the nudge to switch to
  // the installed window. There's no JS signal for manual add-to-home-screen.
  markDeviceSeenIfInstalled();
  showAlmostThere();
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
    const now = new Date(); const [h, m] = (settings.notifyTime || "20:00").split(":").map(Number);
    const key = now.toDateString() + " " + now.getHours() + ":" + now.getMinutes();
    if (key !== lastFiredDateKey && now.getHours() === h && now.getMinutes() >= m && now.getMinutes() < m + 2) { lastFiredDateKey = key; localStorage.setItem("rc_last_fired_date", key); fireNotification("schedule"); }
  }, 30000);
}
if ("serviceWorker" in navigator) {
  // resolve relative to THIS script's own location, not the page's — app.js
  // now loads from both /app/index.html and the root index.html (which
  // references app/js/app.js), and "sw.js" alone would resolve against
  // whichever page loaded it, missing the file when served from root.
  const swUrl = new URL("../../sw.js", document.currentScript.src).href;
  navigator.serviceWorker.register(swUrl, { scope: new URL(".", swUrl).href }).then((reg) => {
    // the browser only checks for a new sw.js at most once every ~24h on its
    // own — for a PWA that mostly gets opened once a day right at reflection
    // time, that reads as "a new deploy never shows up unless I delete and
    // reinstall the app." Force a check on load and every time the (already
    // open/installed) app becomes visible again, so a Vercel deploy actually
    // reaches you within a session or two instead of sitting stale for a day.
    reg.update().catch(() => {});
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update().catch(() => {}); });
  }).catch(() => {});
  // sw.js calls skipWaiting()+clients.claim() on every update, so a new
  // worker takes over control almost immediately — but the ALREADY-OPEN page
  // keeps running the old HTML/JS it already loaded regardless (service
  // workers only affect future navigations). Reloading once the controller
  // actually switches is what makes a deploy visible without a manual
  // reinstall — this is the actual fix for "I shouldn't have to delete the
  // PWA, it should update itself."
  let _swReloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (_swReloaded) return;
    _swReloaded = true;
    location.reload();
  });
  navigator.serviceWorker.addEventListener("message", (e) => { if (e.data && e.data.type === "notif-confirmed") { setLastNotif("schedule"); openReflection(); } });
}

// ---------- HOME / settings ----------
// notify-time controls now appear in TWO places (onboarding + settings
// panel) — both share the same classes, so every instance updates together
// rather than each needing its own id.
function renderSettings() {
  document.querySelectorAll(".notify-time-hidden").forEach((el) => { el.value = settings.notifyTime || "20:00"; });
  renderNotifyLabel();
}
function renderNotifyLabel() {
  const els = document.querySelectorAll(".notify-countdown"); if (!els.length) return;
  const [h, m] = (settings.notifyTime || "20:00").split(":").map(Number);
  const d = new Date(); d.setHours(h, m, 0, 0);
  // "reflect at 8pm" — no trailing s, no ":00", lowercase am/pm
  let t = d.toLocaleTimeString(undefined, { hour: "numeric", minute: m ? "2-digit" : undefined }).toLowerCase().replace(/\s+/g, "");
  
  const validated = isNotifValidated();
  els.forEach((el) => {
    if (validated) {
      el.textContent = "reflect at " + t;
      el.classList.remove("warning");
    } else {
      el.textContent = "tap to test notifications";
      el.classList.add("warning");
    }
  });
}
window.onNotifyTimeChange = (v) => {
  settings.notifyTime = v; saveLocalSettings(); renderNotifyLabel();
  window._saveSettings && window._saveSettings({ notifyTime: v });
  document.querySelectorAll(".notify-time-hidden").forEach((el) => { el.value = v; });
  if (window._fcmToken) {
    const [h, m] = v.split(":").map(Number);
    scheduleNotificationOnBackend(h, m, window._fcmToken);
  }
};
window.openTimePicker = async (btn) => {
  // If notifications aren't validated, send a test notification instead
  if (!isNotifValidated()) {
    const ok = await requestNotifPermission();
    if (!ok) {
      alert("Notifications are blocked — enable them in your browser/OS settings.");
      return;
    }
    window._registerPush && window._registerPush(deviceKind());
    fireNotification("manual");
    await window._markNotifValidated && window._markNotifValidated();
    alert("Test notification sent! Notifications are now validated.");
    renderNotifyLabel();
    return;
  }

  // Normal time picker behavior
  const group = btn && btn.closest ? btn.closest(".notify-time-group") : null;
  const el = group ? group.querySelector(".notify-time-hidden") : document.querySelector(".notify-time-hidden");
  if (!el) return;
  if (el.showPicker) { try { el.showPicker(); return; } catch (_) {} }
  el.focus();
};
window.toggleSettingsPanel = () => { const p = document.getElementById("settingsPanel"); if (p) p.classList.toggle("on"); };

function escapeHtml(s) { return (s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

// ---------- day-after check-in gate ----------
function dueCommitment() { const today = new Date(); today.setHours(0, 0, 0, 0); return (commitments || []).find((c) => c.status === "active" && c.dueDate && new Date(c.dueDate) <= today); }

// ---------- reflection ----------
async function openReflection() {
  // reflecting is a deliberate action on THIS device — lift the mobile login
  // veil so tonight's reflection is never hidden behind it.
  _mobileVeilUp = false;
  const _shade = document.getElementById("deviceShade");
  if (_shade) _shade.classList.remove("on");
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
  // reflection shows ONLY the current question — no scrolling transcript of
  // past answers. (draft.history is still tracked for the back button and for
  // answer logging; it's just never rendered on the reflect screen.)
  setCollapseVisible(false);

  const scroll = document.getElementById("chatScroll");
  scroll.classList.remove("collapsed");
  scroll.innerHTML = "";
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
  const shadeTitle = document.querySelector(".device-shade-title");
  if (!shade) return;
  const isOther = !!(ad && ad.deviceId && window._deviceId && ad.deviceId !== window._deviceId);
  
  const myPhase = currentActivityPhase();
  const theirPhase = ad ? (ad.activityPhase || "idle") : "idle";
  
  let shouldBlock = false;
  if (isOther && myPhase !== "idle" && theirPhase !== "idle") {
    shouldBlock = true;
    if (shadeTitle) {
      if (theirPhase === "editing") shadeTitle.textContent = "editing on your other device";
      else if (theirPhase === "reflecting") shadeTitle.textContent = "reflecting on your other device";
      else shadeTitle.textContent = "in use on your other device";
    }
  }
  
  // keep the mobile login veil up even when there's no real cross-device
  // block, until the person explicitly taps "use here instead".
  shade.classList.toggle("on", shouldBlock || _mobileVeilUp);
};
window.takeOverDevice = () => { window._claimActiveDevice && window._claimActiveDevice(deviceKind(), currentActivityPhase()); };

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

// -- convergence capture (the commit card is GONE) --
// The reflection just ends; one LLM call reads the transcript for the LAST
// concrete thing you said you'd do — or even mentioned doing — and stores it as
// the commitment. Capture at peak, not ceremony after it. Closing the loop is
// the passive layup in the home pill (hold "I did"/"I didn't"), never a push.
const LLM_ENDPOINT = "http://34.26.134.74:3001/v1/chat/completions";
const LLM_KEY = "sk-bf-6a54c177-3684-411e-8b0a-1bb4e11102e9";
function reflectionTranscript() {
  const ans = draft.answers || {};
  const seen = new Set();
  const parts = [];
  const push = (q) => { if (q && ans[q] != null && !seen.has(q)) { seen.add(q); parts.push("Q: " + q + "\nA: " + ans[q]); } };
  (draft.history || []).forEach(push);
  push(draft.lastQuestionName); push(draft.currentName);
  if (!parts.length) Object.keys(ans).forEach(push);
  return parts.join("\n\n");
}
async function captureConvergence() {
  const transcript = reflectionTranscript();
  if (!transcript.trim()) return;
  try {
    const res = await fetch(LLM_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + LLM_KEY },
      body: JSON.stringify({
        model: "free-agent-pool",
        temperature: 0,
        messages: [
          { role: "system", content: "From this reflection transcript, extract the LAST concrete thing the person said they would do, or even just mentioned doing — the most recent actionable intention, however lightly stated. Reply with ONE short imperative line only. If there is none, reply exactly NONE." },
          { role: "user", content: transcript },
        ],
      }),
    });
    const data = await res.json();
    const out = (((data.choices || [])[0] || {}).message || {}).content || "";
    const line = out.trim().split("\n")[0].trim();
    if (!line || /^none$/i.test(line)) return;
    const d = new Date(); d.setDate(d.getDate() + 1);
    window._addCommitment && window._addCommitment({ text: line, dueDate: d.toISOString().slice(0, 10) });
  } catch (_) { /* endpoint unreachable — nothing captured, nothing broken */ }
}
// first-tree: if what was just walked is the onboarding META_TREE, the starred
// answer names their nightly questions — compile them into their first real
// tree, deterministically (no model).
function maybeCompileMetaWalk() {
  if (!window.META_TREE || !window.compileQuestionsToTree) return false;
  const metaRoot = window.META_TREE.split("\n")[0].trim();
  const parsed = getParsed();
  if (!parsed.blocks.length || parsed.blocks[0].name !== metaRoot) return false;
  const ans = draft.answers || {};
  const starName = "for each behavior, what could you ask yourself every night to stay on it?";
  const raw = ans[starName] || "";
  const questions = raw.split(/\n|(?<=\?)\s+/).map((s) => s.trim()).filter(Boolean);
  const compiled = window.compileQuestionsToTree(questions);
  if (!compiled) return false;
  window.setDslText && window.setDslText(compiled);
  return true;
}
function enterCommit() {
  stopVoice();
  if (!draft.captured) {
    draft.captured = true; saveDraft();
    if (!maybeCompileMetaWalk()) captureConvergence();
  }
  if (navigator.vibrate) navigator.vibrate(12);
  draft.committed = true;
  enterDone(true);
  window.maybeShowOtherDeviceGate && window.maybeShowOtherDeviceGate();
}
window.skipCommit = () => { draft.committed = false; enterDone(false); };

// -- done --
function enterDone(committed) {
  stopVoice(); draft.phase = "done"; saveDraft(); setPhase("phaseDone"); setBackVisible(true); setCollapseVisible(false);
  document.getElementById("doneText").textContent = committed ? "done. see you tomorrow." : "logged. see you tomorrow.";
  const kg = document.getElementById("keepGoingBtn"); kg.style.display = draft.resumeName ? "block" : "none";
}
window.keepReflecting = () => { draft.mode = "full"; draft.commitText = ""; draft.history = []; draft.currentName = draft.resumeName; draft.phase = "question"; saveDraft(); renderChat(); };

function finishSession() { window._saveSession && window._saveSession({ answers: draft.answers }); draft = blankDraft(); saveDraft(); window._clearDraft && window._clearDraft(); goHome(); }
window.exitReflection = () => {
  stopVoice();
  // leaving mid-walk IS the signal — you stopped because something got escape
  // energy. Capture what you went to go do.
  if (draft.active && draft.phase === "question" && !draft.captured) {
    draft.captured = true; saveDraft();
    captureConvergence();
  }
  goHome();
};

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

// "Installing update…" overlay — shown between a SW controller change and
// the subsequent page reload so the screen doesn't just go blank mid-session.
(function () {
  let _overlay = null;
  function showInstallingOverlay() {
    if (_overlay) return;
    _overlay = document.createElement("div");
    _overlay.id = "installingOverlay";
    _overlay.innerHTML =
      '<div class="installing-inner">' +
        '<div class="installing-spinner"></div>' +
        '<div class="installing-label">installing update\u2026</div>' +
      '</div>';
    document.body.appendChild(_overlay);
  }
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      showInstallingOverlay();
      // reload fires naturally right after this in the existing handler
    });
  }
})();

// called by firebase-init.js after FCM token is obtained — schedule the
// backend notification immediately so the user gets it even if they never
// change the time picker (which is the only other place this is called).
window._onFcmTokenReady = function (token) {
  if (settings && settings.notifyTime) {
    const [h, m] = settings.notifyTime.split(":").map(Number);
    scheduleNotificationOnBackend(h, m, token);
  }
};

async function scheduleNotificationOnBackend(h, m, fcmToken) {
    if (!fcmToken) return;

    const now = new Date();
    const targetTime = new Date();
    targetTime.setHours(h, m, 0, 0);
    
    // If the time has already passed today, schedule it for tomorrow
    if (targetTime < now) {
        targetTime.setDate(targetTime.getDate() + 1);
    }
    
    // Calculate how many minutes from now the notification should fire
    const delayMinutes = Math.max(1, Math.round((targetTime.getTime() - now.getTime()) / 60000));
    
    await fetch('/api/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            fcmToken: fcmToken,
            delayMinutes: delayMinutes,
            title: "Time to reflect",
            body: "Your questions are ready."
        })
    });
}
