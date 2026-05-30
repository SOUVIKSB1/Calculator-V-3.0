/* =========================================
   api/solve.js  —  Vercel Serverless Function
   Uses CommonJS (module.exports) — required
   for plain .js files on Vercel Node runtime.
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

module.exports = async function handler(req, res) {

  /* ── CORS headers (allows browser to call this endpoint) ── */
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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

  const geminiBody = JSON.stringify({
    contents: [{ parts: [{ text: `${SYSTEM}\n\nProblem: ${prompt}` }] }],
    generationConfig: { maxOutputTokens: 1000, temperature: 0.2 },
  });

  let lastStatus  = 500;
  let lastErrBody = {};

  for (const model of MODELS) {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

    let geminiRes;
    try {
      geminiRes = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    geminiBody,
      });
    } catch (netErr) {
      return res.status(502).json({ error: `Network error: ${netErr.message}` });
    }

    if (geminiRes.status === 429 || geminiRes.status === 404) {
      lastStatus  = geminiRes.status;
      lastErrBody = await geminiRes.json().catch(() => ({}));
      continue; // try next model
    }

    if (!geminiRes.ok) {
      const body = await geminiRes.json().catch(() => ({}));
      return res.status(geminiRes.status).json(body);
    }

    const data = await geminiRes.json();
    const text = data.candidates?.[0]?.content?.parts
      ?.map(p => p.text || '').join('\n').trim() || 'No response returned.';

    return res.status(200).json({ text });
  }

  return res.status(lastStatus).json(lastErrBody);
};
