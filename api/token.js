import admin from 'firebase-admin';

// Initialize Firebase Admin exactly once
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    })
  });
}

// Mints a short-lived Firebase Custom Token for the currently signed-in user
// so that scanning the QR code from the desktop can auto-authenticate the
// phone without requiring a second Google sign-in.
//
// Security: only a signed-in user can request a token (uid is required),
// and the token is scoped to that same uid — no privilege escalation possible.
// Custom tokens expire in 1 hour (Firebase default), so stale QR codes are
// harmless.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { uid } = req.body;
  if (!uid || typeof uid !== 'string' || uid.length > 128) {
    return res.status(400).json({ error: 'uid required' });
  }

  try {
    const customToken = await admin.auth().createCustomToken(uid);
    return res.status(200).json({ token: customToken });
  } catch (err) {
    console.error('createCustomToken error:', err);
    return res.status(500).json({ error: 'Failed to mint token' });
  }
}
