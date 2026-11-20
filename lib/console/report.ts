import { queryAll, queryOne } from '@/lib/db';
import type { DispositionCode } from './dispositions';

// Everything the claims console knows about one call, plus measurable quality signals,
// a deterministic disposition and a rule-based score. The LLM judge refines these.

export interface LatencyStat {
  avg: number;
  p90: number;
  max: number;
  n: number;
}

export interface SessionReport {
  session: {
    id: string;
    caller_name: string | null;
    caller_mobile: string | null;
    language: string;
    status: string;
    policy_no: string | null;
    agent_id: string | null;
    avatar_used: boolean;
    outcome_note: string | null;
    created_at: string;
    ended_at: string | null;
  };
  durationS: number | null;
  policy: { farmer_name: string; village: string; district: string; state: string } | null;
  claim: Record<string, unknown> | null;
  followUps: { kind: string; scheduled_for: string; message: string; status: string }[];
  answers: {
    question_code: string;
    raw_text: string;
    normalized_value: string | null;
    method: string;
    confidence: number;
    accepted: boolean;
    created_at: string;
  }[];
  toolCalls: { tool: string; args: unknown; result: Record<string, unknown>; duration_ms: number; created_at: string }[];
  transcript: { speaker: 'agent' | 'farmer'; text: string; at: number }[];
  states: { state: string; at: number }[];
  errors: { message: string; source?: string; at: number }[];
  latency: Record<string, LatencyStat>;
  stats: {
    questionsAnswered: number;
    attempts: number;
    failedAttempts: number;
    llmFallbacks: number;
    fuzzyMatches: number;
    deterministicRate: number;
    retriesByQuestion: Record<string, number>;
    methodCounts: Record<string, number>;
    farmerTurns: number;
    agentTurns: number;
    rulesFired: string[];
  };
  ruleDisposition: { code: DispositionCode; reason: string };
  ruleScore: number;
  review: Record<string, unknown> | null;
  recording: { url: string; content_type: string; size_bytes: number | null; duration_s: number | null } | null;
}

function percentile(values: number[], p: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function latencyStat(values: number[]): LatencyStat {
  return {
    avg: values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0,
    p90: Math.round(percentile(values, 90)),
    max: values.length ? Math.round(Math.max(...values)) : 0,
    n: values.length,
  };
}

function parse<T>(text: unknown, fallback: T): T {
  try {
    return JSON.parse(String(text)) as T;
  } catch {
    return fallback;
  }
}

const NETWORK_WORDS = /(timeout|timed out|network|disconnect|reconnect|connection|unreachable|sal status)/i;

export async function buildSessionReport(sessionId: string): Promise<SessionReport | null> {
  const session = await queryOne<Record<string, unknown>>('SELECT * FROM sessions WHERE id = ?', [sessionId]);
  if (!session) return null;

  const [answerRows, toolRows, eventRows, claim, review, recording, policy] = await Promise.all([
    queryAll<Record<string, unknown>>('SELECT * FROM answers WHERE session_id = ? ORDER BY id', [sessionId]),
    queryAll<Record<string, unknown>>('SELECT * FROM tool_calls WHERE session_id = ? ORDER BY id', [sessionId]),
    queryAll<{ kind: string; payload: string }>('SELECT kind, payload FROM session_events WHERE session_id = ? ORDER BY id', [sessionId]),
    queryOne<Record<string, unknown>>('SELECT * FROM claims WHERE session_id = ?', [sessionId]),
    queryOne<Record<string, unknown>>('SELECT * FROM session_reviews WHERE session_id = ?', [sessionId]),
    queryOne<Record<string, unknown>>('SELECT * FROM session_recordings WHERE session_id = ?', [sessionId]),
    session.policy_no
      ? queryOne<{ farmer_name: string; village: string; district: string; state: string }>(
          'SELECT farmer_name, village, district, state FROM policies WHERE policy_no = ?',
          [session.policy_no as string],
        )
      : Promise.resolve(null),
  ]);
  const followUps = claim
    ? await queryAll<{ kind: string; scheduled_for: string; message: string; status: string }>(
        'SELECT kind, scheduled_for, message, status FROM follow_ups WHERE claim_id = ? ORDER BY scheduled_for',
        [claim.claim_id as string],
      )
    : [];

  const answers = answerRows.map((a) => ({
    question_code: String(a.question_code),
    raw_text: String(a.raw_text),
    normalized_value: a.normalized_value === null ? null : String(a.normalized_value),
    method: String(a.match_method),
    confidence: Number(a.confidence),
    accepted: Number(a.accepted) === 1,
    created_at: String(a.created_at),
  }));
  const toolCalls = toolRows.map((t) => ({
    tool: String(t.tool),
    args: parse(t.args, {}),
    result: parse<Record<string, unknown>>(t.result, {}),
    duration_ms: Number(t.duration_ms),
    created_at: String(t.created_at),
  }));

  const transcript: SessionReport['transcript'] = [];
  const states: SessionReport['states'] = [];
  const errors: SessionReport['errors'] = [];
  const metricValues: Record<string, number[]> = {};
  for (const e of eventRows) {
    const p = parse<Record<string, unknown>>(e.payload, {});
    const at = Number(p.at ?? 0);
    if (e.kind === 'transcript' && typeof p.text === 'string' && p.text.trim()) {
      transcript.push({ speaker: p.speaker === 'agent' ? 'agent' : 'farmer', text: p.text.trim(), at });
    } else if (e.kind === 'state') {
      states.push({ state: String(p.state), at });
    } else if (e.kind === 'error') {
      errors.push({ message: String(p.message ?? p.code ?? 'error'), source: p.source as string | undefined, at });
    } else if (e.kind === 'metric' && typeof p.value === 'number') {
      const key = `${p.type ?? 'stage'}_${p.name ?? 'value'}`;
      (metricValues[key] ??= []).push(p.value);
    }
  }
  const latency: Record<string, LatencyStat> = {};
  for (const [key, values] of Object.entries(metricValues)) latency[key] = latencyStat(values);
  if (toolCalls.length) latency.tool_call = latencyStat(toolCalls.map((t) => t.duration_ms));

  // ── Stats ──
  const accepted = answers.filter((a) => a.accepted);
  const failed = answers.filter((a) => !a.accepted);
  const methodCounts: Record<string, number> = {};
  for (const a of accepted) methodCounts[a.method] = (methodCounts[a.method] ?? 0) + 1;
  const retriesByQuestion: Record<string, number> = {};
  for (const a of failed) retriesByQuestion[a.question_code] = (retriesByQuestion[a.question_code] ?? 0) + 1;
  const llmFallbacks = accepted.filter((a) => a.method === 'llm').length;
  const deterministic = accepted.filter((a) => a.method !== 'llm').length;
  const rulesFired = [
    ...new Set(
      toolCalls
        .map((t) => t.result.rule as string | undefined)
        .concat(claim ? (parse<string[]>(claim.flags, [])) : [])
        .filter((r): r is string => !!r),
    ),
  ];

  const startedMs = Date.parse(String(session.created_at).replace(' ', 'T') + 'Z');
  const endedMs = session.ended_at ? Date.parse(String(session.ended_at).replace(' ', 'T') + 'Z') : NaN;
  const lastEventMs = Math.max(0, ...transcript.map((t) => t.at), ...states.map((s) => s.at));
  const durationS = Number.isFinite(endedMs)
    ? Math.max(0, Math.round((endedMs - startedMs) / 1000))
    : lastEventMs
      ? Math.max(0, Math.round((lastEventMs - startedMs) / 1000))
      : null;

  const stats = {
    questionsAnswered: new Set(accepted.map((a) => a.question_code)).size,
    attempts: answers.length,
    failedAttempts: failed.length,
    llmFallbacks,
    fuzzyMatches: accepted.filter((a) => a.method === 'fuzzy').length,
    deterministicRate: accepted.length ? deterministic / accepted.length : 0,
    retriesByQuestion,
    methodCounts,
    farmerTurns: transcript.filter((t) => t.speaker === 'farmer').length,
    agentTurns: transcript.filter((t) => t.speaker === 'agent').length,
    rulesFired,
  };

  const status = String(session.status);
  // A call whose tab was closed without 'End call' never gets ended_at: treat 10 idle minutes as ended.
  const sqlMs = (v: unknown) => Date.parse(String(v).replace(' ', 'T') + 'Z') || 0;
  const lastActivityMs = Math.max(
    sqlMs(session.updated_at),
    lastEventMs,
    ...answers.map((a) => sqlMs(a.created_at)),
    ...toolCalls.map((t) => sqlMs(t.created_at)),
  );
  const stale = !session.ended_at && Date.now() - lastActivityMs > 10 * 60 * 1000;
  const ruleDisposition = classify({
    status,
    ended: !!session.ended_at || stale,
    stats,
    errors,
    policyFound: !!session.policy_no,
    finalNo: answers.some((a) => a.question_code === 'final_confirmation' && a.normalized_value === 'no'),
  });

  return {
    session: {
      id: String(session.id),
      caller_name: (session.caller_name as string) ?? null,
      caller_mobile: (session.caller_mobile as string) ?? null,
      language: String(session.language),
      status,
      policy_no: (session.policy_no as string) ?? null,
      agent_id: (session.agent_id as string) ?? null,
      avatar_used: Number(session.avatar_used) === 1,
      outcome_note: (session.outcome_note as string) ?? null,
      created_at: String(session.created_at),
      ended_at: (session.ended_at as string) ?? null,
    },
    durationS,
    policy,
    claim,
    followUps,
    answers,
    toolCalls,
    transcript,
    states,
    errors,
    latency,
    stats,
    ruleDisposition,
    ruleScore: ruleScore(status, stats, latency, errors),
    review: review
      ? {
          ...review,
          scores: parse(review.scores, null),
          issues: parse(review.issues, []),
          improvements: parse(review.improvements, []),
        }
      : null,
    recording: recording
      ? {
          url: String(recording.url),
          content_type: String(recording.content_type),
          size_bytes: recording.size_bytes === null ? null : Number(recording.size_bytes),
          duration_s: recording.duration_s === null ? null : Number(recording.duration_s),
        }
      : null,
  };
}

function classify(input: {
  status: string;
  ended: boolean;
  stats: SessionReport['stats'];
  errors: SessionReport['errors'];
  policyFound: boolean;
  finalNo: boolean;
}): { code: DispositionCode; reason: string } {
  const { status, ended, stats, errors } = input;
  if (status === 'filed') return { code: 'completed_claim_filed', reason: 'The claim was registered and follow-ups were scheduled.' };
  if (status === 'area_claim') return { code: 'completed_area_complaint', reason: 'Drought / pest loss: complaint recorded for area assessment.' };
  if (status === 'not_covered') return { code: 'completed_not_covered', reason: 'The loss fell outside the covered window or perils.' };
  if (!ended) return { code: 'in_progress', reason: 'The call has not ended yet.' };

  const networkErrors = errors.filter((e) => NETWORK_WORDS.test(e.message));
  const agentErrors = errors.filter((e) => /^(asr|llm|tts|avatar|tool)/i.test(e.message) && !NETWORK_WORDS.test(e.message));
  if (stats.farmerTurns === 0 && stats.attempts === 0) {
    return networkErrors.length
      ? { code: 'network_issue', reason: `No conversation happened; ${networkErrors.length} connection error(s) were logged.` }
      : { code: 'no_response', reason: 'The farmer never answered.' };
  }
  if (networkErrors.length >= 2) return { code: 'network_issue', reason: `${networkErrors.length} connection errors during the call.` };
  if (agentErrors.length >= 2) return { code: 'agent_failure', reason: `${agentErrors.length} agent/tool errors during the call.` };
  if (!input.policyFound && (stats.retriesByQuestion.policy_ref ?? 0) >= 2) {
    return { code: 'wrong_policy', reason: 'No policy matched the numbers the farmer gave.' };
  }
  const worst = Object.entries(stats.retriesByQuestion).sort((a, b) => b[1] - a[1])[0];
  if (worst && worst[1] >= 3) return { code: 'stuck_understanding', reason: `${worst[1]} failed attempts on "${worst[0]}" before the call ended.` };
  if (input.finalNo) return { code: 'farmer_declined', reason: 'The farmer said no at the final summary and did not file.' };
  return { code: 'farmer_dropped', reason: `The call ended after ${stats.questionsAnswered} answered question(s), before filing.` };
}

function ruleScore(
  status: string,
  stats: SessionReport['stats'],
  latency: Record<string, LatencyStat>,
  errors: SessionReport['errors'],
): number {
  const completed = ['filed', 'area_claim', 'not_covered'].includes(status);
  const completion = completed ? 40 : Math.min(30, stats.questionsAnswered * 3);
  const understanding = 25 * (stats.attempts ? (stats.attempts - stats.failedAttempts) / stats.attempts : 0);
  const efficiency = Math.max(0, 15 - stats.failedAttempts * 3 - stats.llmFallbacks * 2);
  const llm = latency.llm_ttfb?.avg ?? 0;
  const speed = llm === 0 ? 5 : llm < 1200 ? 10 : llm < 2000 ? 6 : 2;
  const reliability = Math.max(0, 10 - errors.length * 3);
  return Math.round(completion + understanding + efficiency + speed + reliability);
}
