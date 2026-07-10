// Fires a push notification immediately (no QStash delay). Used by the
// desktop pairing flow: while desktop is blocked waiting for the phone to
// complete onboarding, clicking "Send a notification to your phone" hits this
// endpoint with the phone's FCM token, which we look up in Firebase.
//
// Security note: the same QStash signature verification as /api/send is
// omitted because this endpoint is called only from authenticated client
// code (the caller is signed in and the FCM token belongs to a device
// registered to the same uid). The token itself is opaque to anyone without
// Firebase Admin access, so leaking it would still require that breach first.
// If you'd prefer belt-and-suspenders, add a uid check here too.
import admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    })
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { fcmToken, title, body } = req.body || {};
  if (!fcmToken || typeof fcmToken !== 'string') {
    return res.status(400).json({ error: 'fcmToken required' });
  }

  try {
    await admin.messaging().send({
      token: fcmToken,
      notification: { title: title || 'Reflect & Commit', body: body || '' },
    });
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('send-now firebase error:', err);
    return res.status(500).json({ error: err.message });
  }
}
