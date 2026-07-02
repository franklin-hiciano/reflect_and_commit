// Registers this browser for server-sent push (called from firebase-init.js
// once signed in). Requires a VAPID key from Firebase console:
// Project settings → Cloud Messaging → Web Push certificates → generate key pair.
// Paste it into VAPID_KEY below. This step is free — no Blaze plan needed;
// only Cloud Functions/Scheduler cost money, and we're using GitHub Actions instead.
import {
  getMessaging,
  getToken,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js";

const VAPID_KEY =
  "BCk7fqvKWY9rVerejVQP-q8J0HORsj-K70geXegCacDYnYTS5jGjSzj72ZosQ5Abo6gT2RNYBI9J4qjdEZlUUwY";

export async function registerForPush(fbApp, uid, saveTokenFn) {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if (Notification.permission !== "granted") return;
    if (VAPID_KEY.startsWith("PASTE_")) {
      console.warn(
        "Push not registered: set VAPID_KEY in firebase-messaging-setup.js",
      );
      return;
    }
    const reg = await navigator.serviceWorker.ready;
    const messaging = getMessaging(fbApp);
    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: reg,
    });
    if (token) {
      // timezone offset in minutes (e.g. -300 for EST) so the sender script can
      // match your local notifyTime against UTC without guessing your timezone.
      const tzOffsetMin = -new Date().getTimezoneOffset();
      saveTokenFn(token, tzOffsetMin);
    }
  } catch (e) {
    console.error("registerForPush:", e);
  }
}
