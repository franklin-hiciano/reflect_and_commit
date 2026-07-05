import { Receiver } from "@upstash/qstash";
import admin from 'firebase-admin';

// Initialize Firebase Admin exactly once
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      // Vercel env vars replace physical newlines with literal "\n", so we must revert them
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    })
  });
}

// Ensure nobody but QStash can trigger this endpoint
const receiver = new Receiver({
  currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
  nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
});

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  
  try {
    const signature = req.headers["upstash-signature"];
    const isValid = await receiver.verify({ signature, body: JSON.stringify(req.body) });
    if (!isValid) throw new Error("Invalid signature");
  } catch (err) {
    return res.status(401).json({ error: "Unauthorized request" });
  }

  const { fcmToken, title, body } = req.body;
  
  try {
    // Fire the push notification to the phone!
    await admin.messaging().send({
      token: fcmToken,
      notification: { title, body }
    });
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Firebase sending error:", err);
    return res.status(500).json({ error: err.message });
  }
}
