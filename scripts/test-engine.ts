// End-to-end check of the deterministic interview engine, no Agora needed.
// Run: pnpm test:engine   (uses a throwaway SQLite file, never your real DB)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dbFile = path.join(os.tmpdir(), `dialmind-engine-test-${Date.now()}.db`);
process.env.DATABASE_URL = `file:${dbFile}`;

type Step = [answer: string, expect?: string];

async function main() {
  const flow = await import('../lib/engine/flow');
  let failures = 0;

  async function conversation(title: string, language: import('../lib/vanya').LanguageCode, steps: Step[]) {
    console.log(`\n━━ ${title} (${language}) ━━`);
    const sessionId = await flow.createSession({ channel: 'test', language, callerName: 'Test' });
    const first = await flow.getCurrentQuestion(sessionId);
    console.log(`Vanya: ${first.ask}`);
    let last = first;
    for (const [answer, expect] of steps) {
      if (answer.startsWith('@file')) {
        last = await flow.fileClaim(sessionId, true);
      } else if (answer.startsWith('@llm ')) {
        const [raw, interp] = answer.slice(5).split('=>').map((s) => s.trim());
        last = await flow.submitAnswer(sessionId, raw, interp);
      } else {
        last = await flow.submitAnswer(sessionId, answer);
      }
      const ok = !expect || last.result === expect;
      if (!ok) failures++;
      console.log(
        `${ok ? '✓' : '✗'} Farmer: "${answer}" → ${last.result}` +
          (last.understood ? ` [${last.understood} · ${last.method ?? ''} ${last.confidence ?? ''}]` : '') +
          (expect && !ok ? `  (expected ${expect})` : ''),
      );
      if (last.messages) for (const m of last.messages) console.log(`   Vanya says: ${m}`);
      if (last.ask) console.log(`   Vanya asks: ${last.ask}`);
      if (last.claim_id) console.log(`   CLAIM ${last.claim_id} · payout ₹${last.indicative_payout_inr} · flags ${JSON.stringify(last.flags)}`);
    }
    const state = await flow.getSessionState(sessionId);
    console.log(`   state: ${state.status} · progress ${state.progress} · follow-ups ${state.followUps.length}`);
  }

  // Dates relative to today so the 72-hour and 14-day rules behave the same any day.
  await conversation('Happy path, Hinglish, post-harvest rain', 'hi', [
    ['mera registration number hai four one zero zero zero one zero one', 'accepted'],
    ['haan ji', 'accepted'],
    ['dhaan ka nuksaan hua', 'accepted'],
    ['bahut tez barish hui', 'accepted'],
    ['kat gayi thi, sookhne ke liye rakhi thi', 'accepted'],
    ['parso', 'accepted'],
    ['paanch din pehle', 'accepted'],
    ['dhai acre', 'accepted'],
    ['pura khatam ho gaya', 'accepted'],
    ['haan bhej do', 'accepted'],
    ['haan darj kar do', 'ready_to_file'],
    ['@file', 'filed'],
  ]);

  await conversation('Rules: not my policy, uninsured crop, area too big, fuzzy cause', 'en', [
    ['my registration number is 41000202', 'accepted'],
    ['no', 'retry'],
    ['41000101', 'accepted'],
    ['yes', 'accepted'],
    ['cotton', 'retry'],
    ['ragi', 'accepted'],
    ['olavrushti', 'accepted'],
    ['standing in the field', 'accepted'],
    ['yesterday', 'accepted'],
    ['five acres', 'retry'],
    ['half acre', 'accepted'],
    ['seventy percent', 'accepted'],
    ['no', 'accepted'],
    ['no', 'correction_needed'],
  ]);

  await conversation('Drought → area-based branch', 'kn', [
    ['41000202', 'accepted'],
    ['howdu', 'accepted'],
    ['togari', 'accepted'],
    ['male illa, bara', 'ended'],
  ]);

  // Native-script answers, the way ARES returns them for each language.
  await conversation('Tamil, spoken answers', 'ta', [
    ['என் நம்பர் 41000101', 'accepted'],
    ['ஆமா', 'accepted'],
    ['நெல்', 'accepted'],
    ['ரொம்ப பெரிய மழை', 'accepted'],
    ['வயல்ல நின்னுச்சு', 'accepted'],
    ['நேத்து', 'accepted'],
    ['ரெண்டு ஏக்கர்', 'accepted'],
    ['பாதி', 'accepted'],
    ['சரி அனுப்புங்க', 'accepted'],
    ['ஆமா பண்ணுங்க', 'ready_to_file'],
    ['@file', 'filed'],
  ]);

  await conversation('Telugu, spoken answers', 'te', [
    ['41000202', 'accepted'],
    ['అవును', 'accepted'],
    ['కంది', 'accepted'],
    ['వడగళ్ళు పడ్డాయి', 'accepted'],
    ['పొలంలో నిలబడి ఉంది', 'accepted'],
    ['మొన్న', 'accepted'],
    ['రెండు ఎకరాలు', 'accepted'],
  ]);

  await conversation('Bengali drought branch', 'bn', [
    ['41000303', 'accepted'],
    ['হ্যাঁ', 'accepted'],
    ['ভুট্টা', 'accepted'],
    ['খরা, বৃষ্টি হয়নি', 'ended'],
  ]);

  await conversation('Gujarati, spoken answers', 'gu', [
    ['41000303', 'accepted'],
    ['હા', 'accepted'],
    ['સોયાબીન', 'accepted'],
    ['માવઠું થયું', 'accepted'],
    ['ખેતરમાં ઊભો હતો', 'accepted'],
    ['ગઈકાલે', 'accepted'],
  ]);

  await conversation('Registration number validation', 'en', [
    ['9000000101', 'retry'],          // a mobile number is not a registration number
    ['4100010', 'retry'],             // 7 digits
    ['41009999', 'retry'],            // right format, not in the database
    ['four one zero zero zero three zero three', 'accepted'],
  ]);

  await conversation('Interruptions and "say again"', 'hi', [
    ['kya? phir se boliye', 'repeat'],
    ['41000101', 'accepted'],
    ['hello?', 'repeat'],
    ['haan ji', 'accepted'],
    ['समझ नहीं आया', 'repeat'],
    ['dhaan', 'accepted'],
    ['blah blah tractor', 'retry'],
    ['ole pade', 'accepted'],
  ]);

  await conversation('Tamil interruption', 'ta', [
    ['என்ன?', 'repeat'],
    ['41000202', 'accepted'],
  ]);

  await conversation('LLM fallback after retries', 'en', [
    ['41000303', 'accepted'],
    ['yes', 'accepted'],
    ['the yellow beans one', 'retry'],
    ['you know the one for oil', 'needs_interpretation'],
    ['@llm you know the one for oil => soybean', 'accepted'],
  ]);

  try {
    fs.rmSync(dbFile, { force: true });
  } catch {
    // libSQL may still hold the file on Windows; it lives in the OS temp folder.
  }
  console.log(failures ? `\n${failures} step(s) did not match expectations` : '\nAll steps behaved as expected');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
