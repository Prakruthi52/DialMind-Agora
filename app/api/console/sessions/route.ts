import { NextResponse, after } from 'next/server';
import { queryAll } from '@/lib/db';
import { reviewSession } from '@/lib/console/judge';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Claims console: recent sessions with their review, claim and recording, plus KPIs.
export async function GET() {
  const sessions = await queryAll<Record<string, unknown>>(
    `SELECT s.id, s.caller_name, s.caller_mobile, s.language, s.status, s.created_at, s.ended_at,
            s.policy_no, s.avatar_used,
            r.disposition, r.disposition_reason, r.quality_score, r.rule_score, r.judge_model,
            c.claim_id, c.indicative_payout_inr, c.crop, c.cause,
            rec.url AS recording_url,
            (SELECT COUNT(*) FROM answers a WHERE a.session_id = s.id AND a.accepted = 1) AS answered,
            (SELECT COUNT(*) FROM answers a WHERE a.session_id = s.id AND a.accepted = 0) AS failed_attempts,
            (SELECT COUNT(*) FROM answers a WHERE a.session_id = s.id AND a.accepted = 1 AND a.match_method = 'llm') AS llm_fallbacks
       FROM sessions s
       LEFT JOIN session_reviews r ON r.session_id = s.id
       LEFT JOIN claims c ON c.session_id = s.id
       LEFT JOIN session_recordings rec ON rec.session_id = s.id
      ORDER BY s.created_at DESC
      LIMIT 200`,
  );

  const [totals] = await queryAll<Record<string, number>>(
    `SELECT COUNT(*) AS calls,
            SUM(CASE WHEN status IN ('filed','area_claim','not_covered') THEN 1 ELSE 0 END) AS completed,
            SUM(CASE WHEN status = 'filed' THEN 1 ELSE 0 END) AS filed,
            AVG(CASE WHEN ended_at IS NOT NULL
                     THEN (julianday(ended_at) - julianday(created_at)) * 86400 END) AS avg_duration_s
       FROM sessions`,
  );
  const [answerTotals] = await queryAll<Record<string, number>>(
    `SELECT SUM(CASE WHEN accepted = 1 THEN 1 ELSE 0 END) AS accepted,
            SUM(CASE WHEN accepted = 0 THEN 1 ELSE 0 END) AS failed,
            SUM(CASE WHEN accepted = 1 AND match_method = 'llm' THEN 1 ELSE 0 END) AS llm,
            SUM(CASE WHEN accepted = 1 AND match_method = 'fuzzy' THEN 1 ELSE 0 END) AS fuzzy
       FROM answers`,
  );
  const [retryHotspots, toolLatencyRows, qualityRows, dispositions, languages] = await Promise.all([
    queryAll<{ question_code: string; failures: number }>(
      `SELECT question_code, COUNT(*) AS failures FROM answers WHERE accepted = 0
        GROUP BY question_code ORDER BY failures DESC LIMIT 5`,
    ),
    queryAll<Record<string, number>>('SELECT AVG(duration_ms) AS avg_ms, MAX(duration_ms) AS max_ms, COUNT(*) AS n FROM tool_calls'),
    queryAll<Record<string, number>>('SELECT AVG(quality_score) AS avg_quality, AVG(rule_score) AS avg_rule FROM session_reviews'),
    queryAll<{ disposition: string; n: number }>(
      'SELECT disposition, COUNT(*) AS n FROM session_reviews GROUP BY disposition ORDER BY n DESC',
    ),
    queryAll<{ language: string; n: number }>('SELECT language, COUNT(*) AS n FROM sessions GROUP BY language ORDER BY n DESC'),
  ]);
  const toolLatency = toolLatencyRows[0];
  const quality = qualityRows[0];

  // Backfill: review finished (or idle > 10 min) calls that have no review yet, a few per load.
  const pending = await queryAll<{ id: string }>(
    `SELECT s.id FROM sessions s LEFT JOIN session_reviews r ON r.session_id = s.id
      WHERE r.session_id IS NULL
        AND (s.ended_at IS NOT NULL OR s.updated_at < datetime('now', '-10 minutes'))
      ORDER BY s.created_at DESC LIMIT 5`,
  );
  if (pending.length) {
    after(async () => {
      for (const p of pending) await reviewSession(p.id).catch(() => {});
    });
  }

  return NextResponse.json({
    sessions,
    kpis: {
      calls: Number(totals?.calls ?? 0),
      completed: Number(totals?.completed ?? 0),
      filed: Number(totals?.filed ?? 0),
      avgDurationS: totals?.avg_duration_s ? Math.round(Number(totals.avg_duration_s)) : null,
      answersAccepted: Number(answerTotals?.accepted ?? 0),
      answersFailed: Number(answerTotals?.failed ?? 0),
      llmFallbacks: Number(answerTotals?.llm ?? 0),
      fuzzyMatches: Number(answerTotals?.fuzzy ?? 0),
      avgToolMs: toolLatency?.avg_ms ? Math.round(Number(toolLatency.avg_ms)) : null,
      avgQuality: quality?.avg_quality ? Math.round(Number(quality.avg_quality)) : null,
      avgRuleScore: quality?.avg_rule ? Math.round(Number(quality.avg_rule)) : null,
    },
    retryHotspots,
    dispositions,
    languages,
  });
}
