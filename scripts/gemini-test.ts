// Gemini setup check: one tiny JSON request with the configured key and model.
// Run: npx tsx scripts/gemini-test.ts
import fs from 'node:fs';
import { GoogleGenAI } from '@google/genai';

for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
}

(async () => {
  const model = process.env.GEMINI_MODEL ?? 'gemini-3.8-flash';
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const res = await ai.models.generateContent({
    model,
    contents: 'Reply with JSON {"ok": true, "model": "<your model name>"}',
    config: { responseMimeType: 'application/json' },
  });
  console.log(model, '->', res.text);
})().catch((e) => console.log('ERROR', e.status ?? '', String(e.message).slice(0, 300)));
