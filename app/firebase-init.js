import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut as fbSignOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  collection,
  setDoc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { registerForPush } from "./firebase-messaging-setup.js";

// Detect if running in Capacitor native context (iOS/Android app)
const isCapacitorNative = typeof Capacitor !== "undefined" && (Capacitor.isNativePlatform || (window.Capacitor && window.Capacitor.isNativePlatform));

// same firebase project as before — schema is new/simplified again: the
// question tree is now stored as its own DSL TEXT (state/tree {text}),
// replacing the old state/questions {list: [...]} array. Old doc is just
// left alone and unused now.
const cfg = {
  apiKey: "«reda...»",
  authDomain: "wisdom-tree-29e66.firebaseapp.com",
  projectId: "wisdom-tree-29e66",
  storageBucket: "wisdom-tree-29e66.firebasestorage.app",
  messagingSenderId: "716611475015",
  appId: "1:716611475015:web:0ecd11c22788b1c87dc362",
};
const fbApp = initializeApp(cfg);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);
const gProvider = new GoogleAuthProvider();

let uid = null;

function uDoc(...s) {
  return doc(db, "users", uid, ...s);
}
function uCol(...s) {
  return collection(db, "users", uid, ...s);
}

const setSyncDot = (s) => {
  const d = document.getElementById("syncDot");
  if (d) d.className = "sync-dot" + (s ? " " + s : "");
};

// Native sign-in using @capacitor-firebase/authentication (works in iOS/Android app)
// Falls back to web SDK redirect/popup for PWA/browser
window.doSignIn = async () => {
  try {
    if (isCapacitorNative) {
      // Use native Firebase Auth plugin — handles Google Sign-In natively
      const { FirebaseAuthentication } = await import("@capacitor-firebase/authentication");
      await FirebaseAuthentication.signInWithGoogle();
    } else {
      // Web/PWA: iOS Safari blocks popup in PWA → redirect; else popup
      const _iosUA = /iPhone|iPad|iPod/i.test(navigator.userAgent);
      if (_iosUA) {
        await signInWithRedirect(auth, gProvider);
      } else {
        await signInWithPopup(auth, gProvider);
      }
    }
  } catch (e) {
    console.error(e);
  }
};

// Handle redirect result (web only — native plugin handles callback internally)
if (!isCapacitorNative) {
  getRedirectResult(auth).catch(() => {});
}
window.doSignOut = async () => {
  try {
    if (isCapacitorNative) {
      const { FirebaseAuthentication } = await import("@capacitor-firebase/authentication");
      await FirebaseAuthentication.signOut();
    } else {
      await fbSignOut(auth);
    }
  } catch (e) {
    console.error(e);
  }
};

// every onSnapshot below is torn down on sign-out (and before re-subscribing
// on sign-in) — otherwise signing out and back in in the same tab piles up a
// second full set of listeners still bound to the PREVIOUS uid, racing the
// new ones and randomly resurfacing stale tree/onboarding data over
// whatever the new session just wrote.
let unsubscribers = [];
function teardownListeners() { unsubscribers.forEach((fn) => fn()); unsubscribers = []; }

onAuthStateChanged(auth, async (user) => {
  teardownListeners();
  if (user) {
    uid = user.uid;
    window._uid = uid;
    // exposed so the cross-device pairing gate can show the signed-in
    // account's avatar on both devices — the fastest way to catch "these are
    // two different Google accounts" (the #1 real-world cause of the gate
    // never clearing), at a glance instead of digging through settings.
    window._userPhoto = user.photoURL || "";
    window._userName = user.displayName || user.email || "";
    window._userEmail = user.email || "";
    document.getElementById("authScreen").classList.add("hidden");
    setSyncDot("syncing");

    unsubscribers.push(onSnapshot(uDoc("state", "tree"), (snap) => {
      window._tree = snap.exists() ? (snap.data().text || "") : "";
      window._onTreeUpdated && window._onTreeUpdated();
      setSyncDot("ok");
    }, () => setSyncDot("err")));

    unsubscribers.push(onSnapshot(uDoc("state", "settings"), (snap) => {
      window._settings = snap.exists() ? snap.data() : {};
      window._onSettingsUpdated && window._onSettingsUpdated();
    }, () => {}));

    unsubscribers.push(onSnapshot(uDoc("state", "draft"), (snap) => {
      window._remoteDraft = snap.exists() ? snap.data() : null;
      window._onDraftUpdated && window._onDraftUpdated();
    }, () => {}));

    unsubscribers.push(onSnapshot(query(uCol("commitments"), orderBy("createdAt", "desc")), (snap) => {
      window._commitments = snap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
        createdAt: d.data().createdAt?.toDate?.()?.toISOString?.() ?? d.data().createdAt,
      }));
      window._onCommitmentsUpdated && window._onCommitmentsUpdated();
    }, () => {}));

    // hand-off signal: written when you tap "continue on your computer" on
    // one device. Any other device (that isn't itself a phone) listening in
    // real time picks it up instantly if it's already open — the push-based
    // fallback below is only needed when the target device isn't open.
    unsubscribers.push(onSnapshot(uDoc("state", "handoff"), (snap) => {
      window._handoff = snap.exists() ? snap.data() : null;
      window._onHandoffUpdated && window._onHandoffUpdated();
    }, () => {}));

    // only one device is ever "active" — every other open device shades
    // itself (app.js renders the overlay) until it explicitly takes over.
    unsubscribers.push(onSnapshot(uDoc("state", "activeDevice"), (snap) => {
      window._activeDevice = snap.exists() ? snap.data() : null;
      window._onActiveDeviceUpdated && window._onActiveDeviceUpdated();
    }, () => {}));

    // cross-device install-gate onboarding — a persistent, one-way record of
    // "a mobile device has signed in" / "a desktop device has signed in",
    // never cleared. This is what lets the install gate auto-advance the
    // instant the OTHER device signs in, independent of whichever device is
    // currently "active".
    unsubscribers.push(onSnapshot(uDoc("state", "onboarding"), (snap) => {
      window._onboarding = snap.exists() ? snap.data() : {};
      window._onOnboardingUpdated && window._onOnboardingUpdated();
    }, () => {}));

    // device data — tracks notification validation status per device
    unsubscribers.push(onSnapshot(uDoc("devices", deviceId()), (snap) => {
      window._deviceData = snap.exists() ? snap.data() : {};
      if (window.renderNotifyLabel) window.renderNotifyLabel();
    }, () => {}));

    // handoff listener — desktop auto-redirects when mobile completes setup.
    // skip the initial snapshot (stale consumed:true from a prior session) —
    // only act on a real-time change so we don't bounce back to "Almost there"
    // every time the user opens the already-installed app.
    if (!isPhone()) {
      let handoffSeenFirst = false;
      unsubscribers.push(onSnapshot(uDoc("state", "handoff"), (snap) => {
        if (!handoffSeenFirst) { handoffSeenFirst = true; return; }
        const handoff = snap.exists() ? snap.data() : {};
        if (handoff.consumed && window.enterHome) {
          window.enterHome();
        }
      }, () => {}));
    }

    window._onSignedIn && window._onSignedIn();
  } else {
    uid = null;
    window._uid = null;
    window._userPhoto = "";
    window._userName = "";
    window._userEmail = "";
    document.getElementById("authScreen").classList.remove("hidden");
    setSyncDot("");
  }
});

let treeSaveTimer = null;
window._saveTree = function (text) {
  if (!uid) return;
  // debounced: writing on every keystroke round-trips through the onSnapshot
  // listener fast enough to rebuild the editor mid-type and steal focus (the
  // mobile keyboard-closing bug). Batch rapid edits into one write.
  clearTimeout(treeSaveTimer);
  treeSaveTimer = setTimeout(async () => {
    setSyncDot("syncing");
    try {
      await setDoc(uDoc("state", "tree"), { text, updatedAt: serverTimestamp() });
      setSyncDot("ok");
    } catch (e) {
      setSyncDot("err");
    }
  }, 500);
};

window._saveSettings = async function (patch) {
  if (!uid) return;
  try {
    await setDoc(uDoc("state", "settings"), { ...patch, updatedAt: serverTimestamp() }, { merge: true });
  } catch (e) {}
};

let draftTimer = null;
window._saveDraft = function (draft) {
  if (!uid) return;
  clearTimeout(draftTimer);
  draftTimer = setTimeout(async () => {
    try {
      await setDoc(uDoc("state", "draft"), { ...draft, updatedAt: serverTimestamp() });
    } catch (e) {}
  }, 400);
};

window._clearDraft = async function () {
  if (!uid) return;
  try {
    await setDoc(uDoc("state", "draft"), { answers: {}, index: 0, active: false, updatedAt: serverTimestamp() });
  } catch (e) {}
};

window._saveSession = async function (session) {
  if (!uid) return;
  try {
    await setDoc(uDoc("sessions", "s_" + Date.now()), { ...session, savedAt: serverTimestamp() });
  } catch (e) {}
};

window._addCommitment = async function (cmt) {
  if (!uid) return null;
  const id = "cmt_" + Date.now();
  try {
    await setDoc(uDoc("commitments", id), {
      text: cmt.text || "",
      dueDate: cmt.dueDate || "",
      status: "active",
      createdAt: serverTimestamp(),
    });
  } catch (e) {}
  return id;
};
window._resolveCommitment = async function (id, status) {
  if (!uid) return;
  try {
    await setDoc(uDoc("commitments", id), { status, resolvedAt: serverTimestamp() }, { merge: true });
  } catch (e) {}
};

// one stable id per browser install (not per user) — lets a single account
// register a token from their phone AND their laptop without one overwriting
// the other, which is what a single shared doc used to do.
function deviceId() {
  let id = localStorage.getItem("rc_device_id");
  if (!id) { id = "dev_" + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem("rc_device_id", id); }
  return id;
}

window._registerPush = function (kind) {
  if (!uid) return;
  registerForPush(fbApp, uid, async (token, tzOffsetMin) => {
    try {
      window._fcmToken = token;
      await setDoc(uDoc("devices", deviceId()), { token, kind: kind || "mobile", tzOffsetMin, updatedAt: serverTimestamp() }, { merge: true });
      // schedule the backend notification now that we have the token
      window._onFcmTokenReady && window._onFcmTokenReady(token);
    } catch (e) {}
  });
};

window._markNotifValidated = async function () {
  if (!uid) return;
  try {
    await setDoc(uDoc("devices", deviceId()), { notifValidatedAt: serverTimestamp() }, { merge: true });
    // Atomic mobile-completion marker: notifications validated + time pickable
    // (time defaults to 20:00 earlier in app.js — close enough to be considered
    // onboarded). Also still set the older flag for backwards-compatibility.
    if (isPhone()) {
      await setDoc(uDoc("state", "onboarding"), {
        mobileNotifEnabledAt: serverTimestamp(),
        mobileOnboardedAt: serverTimestamp(),
      }, { merge: true });
      // Trigger handoff to desktop
      await window._consumeHandoff && window._consumeHandoff();
    }
  } catch (e) {}
};

// -- hand-off: request / consume --
window._requestHandoff = async function () {
  if (!uid) return;
  try { await setDoc(uDoc("state", "handoff"), { requestedAt: serverTimestamp(), consumed: false }); } catch (e) {}
};
window._consumeHandoff = async function () {
  if (!uid) return;
  try { await setDoc(uDoc("state", "handoff"), { consumed: true }, { merge: true }); } catch (e) {}
};

// a direct one-time read, not the cached onSnapshot value — resuming a
// session (opening a reflection at all, or consuming a hand-off) needs the
// TRUE current draft, not whatever a background listener happened to have
// merged last, which is a race two separate listeners can lose.
window._fetchLatestDraft = async function () {
  if (!uid) return null;
  try { const snap = await getDoc(uDoc("state", "draft")); return snap.exists() ? snap.data() : null; } catch (e) { return null; }
};

// -- device exclusivity: only one device is ever "active" at a time --
window._deviceId = deviceId();
window._claimActiveDevice = async function (kind, activityPhase) {
  if (!uid) return;
  try { await setDoc(uDoc("state", "activeDevice"), { deviceId: window._deviceId, kind, activityPhase: activityPhase || "idle", claimedAt: serverTimestamp() }); } catch (e) {}
};

// -- install-gate onboarding: a one-way "this kind of device has signed in
// at least once" flag, merged so mobile and desktop never clobber each other --
window._markMobileOnboarded = async function () {
  if (!uid) return;
  try { await setDoc(uDoc("state", "onboarding"), { mobileOnboardedAt: serverTimestamp() }, { merge: true }); } catch (e) {}
};
window._markDeviceSeen = async function (kind) {
  if (!uid) return;
  try { await setDoc(uDoc("state", "onboarding"), { [kind + "SeenAt"]: serverTimestamp() }, { merge: true }); } catch (e) {}
};
// Find the mobile device's FCM token + push notification time, so desktop can
// fire a pairing ping to it. Returns null if no mobile device has registered yet.
window._getMobileDeviceToken = async function () {
  if (!uid) return null;
  try {
    const q = query(uCol("devices"), where("kind", "==", "mobile"));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    for (const d of snap.docs) {
      const data = d.data();
      if (data.token) return { token: data.token, tzOffsetMin: data.tzOffsetMin };
    }
    return null;
  } catch (_) { return null; }
};
// these flags are permanent by design (see above) — the only way back to a
// fresh "waiting for the other device" state, e.g. re-pairing a new phone
// or replaying the onboarding flow, is wiping them outright.
window._resetPairing = async function () {
  if (!uid) return;
  try { await setDoc(uDoc("state", "onboarding"), {}); } catch (e) {}
};

window._fbReady = true;
