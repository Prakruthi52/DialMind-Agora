// Runs the post-call review (rules + Gemini judge) for one session and prints the result.
// Run: npx tsx scripts/review-session.ts <sessionId>
import fs from 'node:fs';

for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
}

(async () => {
  const { reviewSession } = await import('../lib/console/judge');
  const report = await reviewSession(process.argv[2]);
  if (!report) return console.log('Unknown session');
  const r = report.review as Record<string, unknown> | null;
  console.log(JSON.stringify(
    {
      disposition: r?.disposition,
      reason: r?.disposition_reason,
      quality_score: r?.quality_score,
      rule_score: report.ruleScore,
      scores: r?.scores,
      summary: r?.summary,
      issues: r?.issues,
      improvements: r?.improvements,
      judge_model: r?.judge_model,
      judge_error: r?.judge_error,
    },
    null,
    1,
  ));
})().catch((e) => console.log('ERROR', e));
