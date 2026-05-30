/* =========================================
   api/solve.js  —  Vercel Serverless Function
   Proxies requests to Gemini so the API key
   stays server-side only (process.env).

   Set  GEMINI_API_KEY  in:
   Vercel Dashboard → Project → Settings → Environment Variables
========================================= */

const MODELS = [
  'gemini-1.5-flash-8b',
  'gemini-1.5-flash',
  'gemini-2.0-flash',
];

const SYSTEM = `You are a brilliant math assistant inside a calculator app.
Solve any math problem clearly. Show step-by-step working when useful.
Use plain text only — no markdown, no asterisks, no hashes.
Keep answers concise. For simple arithmetic: answer + one-line explanation.
For complex problems: numbered steps, final answer clearly labelled.`;

export default async function handler(req, res) {

  /* ── Only allow POST ── */
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  /* ── Key must be set in Vercel env vars ── */
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return res.status(500).json({
      error: 'GEMINI_API_KEY is not set in Vercel Environment Variables.',
    });
  }

  const { prompt } = req.body ?? {};
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid prompt.' });
  }

  const body = JSON.stringify({
    contents: [{ parts: [{ text: `${SYSTEM}\n\nProblem: ${prompt}` }] }],
    generationConfig: { maxOutputTokens: 1000, temperature: 0.2 },
  });

  /* ── Model cascade — same logic as the browser version ── */
  let lastStatus = 500;
  let lastErrBody = {};

  for (const model of MODELS) {
    const endpoint =
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

    let geminiRes;
    try {
      geminiRes = await fetch(endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    } catch (netErr) {
      return res.status(502).json({ error: `Network error reaching Gemini: ${netErr.message}` });
    }

    if (geminiRes.status === 429) {
      // rate-limited → try next model silently
      lastStatus  = 429;
      lastErrBody = await geminiRes.json().catch(() => ({}));
      continue;
    }

    if (geminiRes.status === 404) {
      // model not found → try next model
      lastStatus  = 404;
      lastErrBody = await geminiRes.json().catch(() => ({}));
      continue;
    }

    if (!geminiRes.ok) {
      lastErrBody = await geminiRes.json().catch(() => ({}));
      return res.status(geminiRes.status).json(lastErrBody);
    }

    /* ── Success — extract text and return just the answer ── */
    const data = await geminiRes.json();
    const text  = data.candidates?.[0]?.content?.parts
      ?.map(p => p.text || '').join('\n').trim() || 'No response returned.';

    return res.status(200).json({ text });
  }

  /* ── All models exhausted ── */
  return res.status(lastStatus).json(lastErrBody);
}
