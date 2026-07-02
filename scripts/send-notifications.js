// Runs on a GitHub Actions schedule (see .github/workflows/notify.yml).
// No Blaze plan / Cloud Functions needed — just the free Admin SDK talking to
// Firestore + FCM directly from GitHub's own runners.
//
// For every user: reads state/settings.notifyTime ("HH:MM", their local time)
// and state/push.tzOffsetMin (minutes offset from UTC, captured client-side),
// converts notifyTime to a UTC minute-of-day, and — if that matches "now" within
// the run's tolerance window — sends a data-only FCM push to their token.
//
// Run cadence: the workflow fires every 5 minutes, so TOLERANCE_MIN is 5.
// A per-user, per-day dedupe doc (state/lastPush) stops double-sends if a run
// overlaps the same minute twice.

const admin = require("firebase-admin");

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
const messaging = admin.messaging();

const TOLERANCE_MIN = 5;

function utcMinuteOfDay(date) {
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

async function main() {
  const now = new Date();
  const nowUtcMin = utcMinuteOfDay(now);
  const todayKey = now.toISOString().slice(0, 10);

  const usersSnap = await db.collection("users").get();
  let sent = 0;

  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;
    const [settingsSnap, pushSnap, lastPushSnap] = await Promise.all([
      db.doc(`users/${uid}/state/settings`).get(),
      db.doc(`users/${uid}/state/push`).get(),
      db.doc(`users/${uid}/state/lastPush`).get(),
    ]);
    if (!settingsSnap.exists || !pushSnap.exists) continue;

    const { notifyTime } = settingsSnap.data();
    const { token, tzOffsetMin } = pushSnap.data();
    if (!notifyTime || !token || typeof tzOffsetMin !== "number") continue;

    const [h, m] = notifyTime.split(":").map(Number);
    const localMin = h * 60 + m;
    // local = utc + tzOffset  =>  utc = local - tzOffset
    let targetUtcMin = localMin - tzOffsetMin;
    targetUtcMin = ((targetUtcMin % 1440) + 1440) % 1440;

    const diff = Math.min(
      Math.abs(nowUtcMin - targetUtcMin),
      1440 - Math.abs(nowUtcMin - targetUtcMin)
    );
    if (diff > TOLERANCE_MIN) continue;

    const last = lastPushSnap.exists ? lastPushSnap.data() : {};
    if (last.dateKey === todayKey) continue; // already sent today

    try {
      await messaging.send({
        token,
        data: { title: "Time to reflect", body: "Your questions are ready." },
        webpush: { headers: { Urgency: "high" } },
      });
      await db.doc(`users/${uid}/state/lastPush`).set({ dateKey: todayKey, sentAt: now.toISOString() });
      sent++;
    } catch (e) {
      console.error(`send failed for ${uid}:`, e.message);
    }
  }

  console.log(`checked ${usersSnap.size} users, sent ${sent} notifications`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
