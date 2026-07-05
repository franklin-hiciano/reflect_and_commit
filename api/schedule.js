export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  
  const { fcmToken, delayMinutes, title, body } = req.body;
  
  // Dynamically route the webhook back to wherever this is deployed (local vs prod)
  const targetWebhookUrl = `https://${req.headers.host}/api/send`;

  // Tell QStash to hit our /api/send endpoint after X minutes
  const qstashRes = await fetch(`https://qstash.upstash.io/v2/publish/${targetWebhookUrl}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.QSTASH_TOKEN}`,
      'Upstash-Delay': `${delayMinutes}m`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ fcmToken, title, body })
  });

  if (!qstashRes.ok) {
    return res.status(500).json({ error: "Failed to schedule with QStash" });
  }

  res.status(200).json({ success: true });
}
