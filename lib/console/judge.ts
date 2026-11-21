import { GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { run } from '@/lib/db';
import { DISPOSITION_CODES, DISPOSITIONS } from './dispositions';
import { buildSessionReport, type SessionReport } from './report';

// Post-call LLM-as-a-judge with Google Gemini (a fast Flash model by default). It reads the
// full trace of a call and returns a disposition (from a fixed list), rubric scores,
// concrete issues and improvements. Without GEMINI_API_KEY only the rule-based review is stored.

export const JUDGE_MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.8-flash';

const Score = z.number().int().min(1).max(5);

const JudgeSchema = z.object({
  disposition: z.enum(DISPOSITION_CODES as [string, ...string[]]),
  disposition_reason: z.string().describe('One sentence, plain English, citing what happened.'),
  quality_score: z.number().int().min(0).max(100),
  scores: z.object({
    task_completion: Score,
    understanding: Score,
    language_naturalness: Score,
    empathy: Score,
    compliance: Score,
    efficiency: Score,
  }),
  summary: z.string().describe('Two or three sentences for a claims supervisor.'),
  issues: z
    .array(
      z.object({
        moment: z.string().describe('Where it happened, e.g. a quote or question code.'),
        problem: z.string(),
        suggestion: z.string(),
        severity: z.enum(['low', 'medium', 'high']),
      }),
    )
    .max(6),
  improvements: z.array(z.string()).max(5).describe('Concrete changes to prompts, questions, synonyms or flow.'),
});

export type JudgeResult = z.infer<typeof JudgeSchema>;

const SYSTEM = `You are a quality reviewer for DialMind's voice agent "Vanya", which registers crop-insurance (PMFBY-style) loss claims for Indian farmers on video calls in their own language.

The agent asks questions that come from a deterministic engine (database questions, regex/fuzzy/lexicon matching, rules). The LLM only phrases questions and interprets answers when matching fails ("llm" method). Review the call and score each from 1 (poor) to 5 (excellent):
- task_completion: did the call reach a correct outcome (claim filed, area complaint, not covered) or stall?
- understanding: were the farmer's answers understood first time? Retries, fuzzy and llm fallbacks are signals.
- language_naturalness: did Vanya speak warm, colloquial, natural language in the farmer's language (not textbook)?
- empathy: did she acknowledge the loss and stay patient?
- compliance: she must get a clear yes before filing, never promise approval or an exact payout, never ask for OTP / full Aadhaar / bank numbers.
- efficiency: few wasted turns, short replies.

Disposition codes (pick exactly one):
${DISPOSITION_CODES.map((c) => `- ${c}: ${DISPOSITIONS[c].label}`).join('\n')}

The rule-based classifier's disposition is given as a hint; override it when the transcript shows otherwise (e.g. the farmer asked to call back, spoke a different language, or the call was off-topic). quality_score is your overall 0-100 rating. Issues must point at specific moments and give an actionable fix. Be concise and factual; do not invent events that are not in the trace. Write in English.`;

function compactTrace(report: SessionReport) {
  return {
    session: {
      language: report.session.language,
      status: report.session.status,
      duration_s: report.durationS,
      avatar_used: report.session.avatar_used,
    },
    rule_based: { disposition: report.ruleDisposition, score: report.ruleScore },
    transcript: report.transcript.slice(0, 120).map((t) => `${t.speaker === 'agent' ? 'Vanya' : 'Farmer'}: ${t.text}`),
    answer_attempts: report.answers.map((a) => ({
      question: a.question_code,
      farmer_said: a.raw_text,
      understood_as: a.normalized_value,
      method: a.method,
      confidence: a.confidence,
      accepted: a.accepted,
    })),
    tools: report.toolCalls.map((t) => ({ tool: t.tool, result: t.result.result, rule: t.result.rule, ms: t.duration_ms })),
    rules_fired: report.stats.rulesFired,
    errors: report.errors.slice(0, 20).map((e) => e.message),
    latency_ms: report.latency,
    claim: report.claim
      ? { claim_id: report.claim.claim_id, claim_path: report.claim.claim_path, flags: report.claim.flags }
      : null,
  };
}

/**
 * Builds the report, runs the judge (if configured) and stores the review.
 * Always stores at least the deterministic disposition and score.
 */
export async function reviewSession(sessionId: string): Promise<SessionReport | null> {
  const report = await buildSessionReport(sessionId);
  if (!report) return null;

  let judge: JudgeResult | null = null;
  let judgeModel: string | null = null;
  let judgeError: string | null = null;
  if (!process.env.GEMINI_API_KEY) {
    judgeError = 'GEMINI_API_KEY not set: rule-based review only.';
  } else if (report.ruleDisposition.code === 'in_progress') {
    judgeError = 'Call still in progress.';
  } else {
    try {
      const out = await runJudge(report);
      judge = out.result;
      judgeModel = out.model;
    } catch (error) {
      judgeError = error instanceof Error ? error.message.slice(0, 300) : 'Judge failed';
      console.warn('LLM judge failed:', judgeError);
    }
  }

  await run(
    `INSERT OR REPLACE INTO session_reviews
       (session_id, disposition, disposition_reason, rule_disposition, quality_score, rule_score, scores,
        summary, issues, improvements, judge_model, judge_error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      sessionId,
      judge?.disposition ?? report.ruleDisposition.code,
      judge?.disposition_reason ?? report.ruleDisposition.reason,
      report.ruleDisposition.code,
      judge?.quality_score ?? null,
      report.ruleScore,
      judge ? JSON.stringify(judge.scores) : null,
      judge?.summary ?? null,
      JSON.stringify(judge?.issues ?? []),
      JSON.stringify(judge?.improvements ?? []),
      judgeModel,
      judgeError,
    ],
  );
  return buildSessionReport(sessionId);
}

// Fallbacks if the main model is overloaded (503) or rate limited (429).
// Each model has its own free-tier quota, so a quota-exhausted main model still has backups.
const FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS ?? 'gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);

function isTransient(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  return /\b(503|429|500)\b|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand|overloaded/i.test(msg);
}

async function runJudge(report: SessionReport): Promise<{ result: JudgeResult; model: string }> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const request = (model: string) =>
    ai.models.generateContent({
      model,
      contents: `Review this call trace (JSON):\n\n${JSON.stringify(compactTrace(report))}`,
      config: {
        systemInstruction: SYSTEM,
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseJsonSchema: z.toJSONSchema(JudgeSchema),
      },
    });

  let lastError: unknown;
  // Main model with two retries (backoff), then each fallback model once.
  const attempts = [JUDGE_MODEL, JUDGE_MODEL, JUDGE_MODEL, ...FALLBACK_MODELS.filter((m) => m !== JUDGE_MODEL)];
  const exhausted = new Set<string>();
  for (let i = 0; i < attempts.length; i++) {
    const model = attempts[i];
    // A used-up quota (daily/minute limit) will not recover in seconds: skip straight to fallbacks.
    if (exhausted.has(model)) continue;
    try {
      const response = await request(model);
      const text = response.text;
      if (!text) throw new Error('The judge returned an empty response.');
      // Validate: the model's JSON must match the schema before it is stored.
      return { result: JudgeSchema.parse(JSON.parse(text)), model };
    } catch (error) {
      lastError = error;
      if (/exceeded your current quota|RESOURCE_EXHAUSTED/i.test(String((error as Error)?.message))) exhausted.add(model);
      const unknownModel = /\b404\b|not found|no longer available/i.test(String((error as Error)?.message));
      if (!isTransient(error) && !unknownModel) throw error;
      if (i < 2 && !exhausted.has(model)) await new Promise((resolve) => setTimeout(resolve, 1500 * (i + 1)));
    }
  }
  throw lastError;
}
