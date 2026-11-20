import { randomUUID } from 'node:crypto';
import { queryAll, queryOne, run } from '@/lib/db';
import type { LanguageCode } from '@/lib/vanya';
import {
  getInterviewData,
  optionLabel,
  questionText,
  ruleMessage,
  type InterviewData,
  type Question,
  type Rule,
} from './data';
import {
  isoDate,
  matchAnswer,
  matchYesNo,
  todayIST,
  validateInterpreted,
  type MatchResult,
} from './match';
import { evaluateCondition, type CropRow, type PolicyRow, type RuleContext } from './rules';
import { normalize } from './text';

// The deterministic interview. The database decides what to ask, in what order, and
// validates every answer; the LLM only phrases questions and interprets when matching fails.

export type ToolResult = {
  result:
    | 'question'
    | 'accepted'
    | 'confirm'
    | 'retry'
    | 'needs_interpretation'
    | 'ready_to_file'
    | 'correction_needed'
    | 'ended'
    | 'filed'
    | 'status'
    | 'error';
  /** Plain-English directions for the LLM. */
  instruction: string;
  /** What the engine understood, in the session language. */
  understood?: string;
  /** Lines to speak before the next question (rule messages), in the session language. */
  messages?: string[];
  /** The next thing to ask, in the session language. */
  ask?: string;
  question_code?: string;
  options?: string[];
  progress?: string;
  [key: string]: unknown;
};

interface SessionRow {
  id: string;
  channel: string;
  policy_no: string | null;
  language: LanguageCode;
  current_question: string | null;
  pending_value: string | null;
  status: string;
  caller_name: string | null;
  caller_mobile: string | null;
}

interface Ctx {
  session: SessionRow;
  data: InterviewData;
  answers: Record<string, string>;
  policy: PolicyRow | null;
  crop: CropRow | null;
  policyCrops: CropRow[];
  hasEvidence: boolean;
  firedRules: Set<string>;
}

const ACRES: Record<LanguageCode, string> = { en: 'acres', hi: 'एकड़', kn: 'ಎಕರೆ' };
const YES_NO: Record<LanguageCode, Record<string, string>> = {
  en: { yes: 'yes', no: 'no' },
  hi: { yes: 'हाँ', no: 'नहीं' },
  kn: { yes: 'ಹೌದು', no: 'ಇಲ್ಲ' },
};

// ───────────────────────── session lifecycle ─────────────────────────

export async function createSession(input: {
  channel: string;
  language: LanguageCode;
  callerName?: string;
  callerMobile?: string;
}): Promise<string> {
  const id = randomUUID();
  await run(
    `INSERT INTO sessions (id, channel, language, caller_name, caller_mobile, current_question)
     VALUES (?, ?, ?, ?, ?, 'policy_ref')`,
    [id, input.channel, input.language, input.callerName ?? null, input.callerMobile ?? null],
  );
  return id;
}

export async function attachAgent(sessionId: string, agentId: string, avatarUsed: boolean) {
  await run(`UPDATE sessions SET agent_id = ?, avatar_used = ?, updated_at = datetime('now') WHERE id = ?`, [
    agentId,
    avatarUsed ? 1 : 0,
    sessionId,
  ]);
}

export async function endSession(sessionId: string) {
  await run(
    `UPDATE sessions SET ended_at = COALESCE(ended_at, datetime('now')),
       status = CASE WHEN status IN ('in_progress','awaiting_approval') THEN 'abandoned' ELSE status END
     WHERE id = ?`,
    [sessionId],
  );
}

// ───────────────────────── context ─────────────────────────

async function loadCtx(sessionId: string): Promise<Ctx> {
  // Independent reads run in parallel: each is a network round trip to Turso.
  const [session, data, rows, policy, policyCropRows] = await Promise.all([
    queryOne<SessionRow>('SELECT * FROM sessions WHERE id = ?', [sessionId]),
    getInterviewData(),
    queryAll<{ question_code: string; normalized_value: string }>(
      'SELECT question_code, normalized_value FROM answers WHERE session_id = ? AND accepted = 1 ORDER BY id',
      [sessionId],
    ),
    queryOne<PolicyRow>(
      'SELECT p.* FROM policies p JOIN sessions s ON s.policy_no = p.policy_no WHERE s.id = ?',
      [sessionId],
    ),
    queryAll<CropRow>(
      'SELECT c.* FROM insured_crops c JOIN sessions s ON s.policy_no = c.policy_no WHERE s.id = ?',
      [sessionId],
    ),
  ]);
  if (!session) throw new Error('Unknown session');

  const answers: Record<string, string> = {};
  for (const r of rows) answers[r.question_code] = r.normalized_value;
  const policyCrops = policyCropRows.map((c) => ({
    ...c,
    insured_area_acres: Number(c.insured_area_acres),
    sum_insured_inr: Number(c.sum_insured_inr),
  }));
  const crop = policyCrops.find((c) => c.crop === answers.crop_affected) ?? null;

  const ctx: Ctx = {
    session: { ...session, language: (session.language as LanguageCode) ?? 'hi' },
    data,
    answers,
    policy,
    crop,
    policyCrops,
    // The crop-photo step was removed; kept for the generic 'photo' answer type.
    hasEvidence: false,
    firedRules: new Set(),
  };
  ctx.firedRules = computeFiredRules(ctx, answers);
  return ctx;
}

function ruleCtx(ctx: Ctx, answers: Record<string, string>, crop = ctx.crop, policy = ctx.policy): RuleContext {
  return { answers, policy, crop, firedRules: ctx.firedRules };
}

/** warn / flag rules currently true for the given answers. */
function computeFiredRules(ctx: Ctx, answers: Record<string, string>): Set<string> {
  const fired = new Set<string>();
  for (const rule of ctx.data.rules) {
    if (rule.rule_type !== 'warn' && rule.rule_type !== 'flag') continue;
    if (rule.question_code && !(rule.question_code in answers)) continue;
    if (!rule.question_code) continue; // filing-time rules are evaluated in fileClaim
    if (evaluateCondition(rule.condition, { answers, policy: ctx.policy, crop: ctx.crop, firedRules: fired })) {
      fired.add(rule.code);
    }
  }
  return fired;
}

// ───────────────────────── rendering ─────────────────────────

function optionsFor(ctx: Ctx, q: Question) {
  const all = ctx.data.options.filter((o) => o.question_code === q.code);
  return all;
}

function labelFor(ctx: Ctx, code: string, value: string): string {
  const lang = ctx.session.language;
  const q = ctx.data.questions.find((x) => x.code === code);
  if (!q) return value;
  switch (q.answer_type) {
    case 'enum': {
      const o = ctx.data.options.find((x) => x.question_code === code && x.value === value);
      return o ? optionLabel(o, lang) : value;
    }
    case 'yes_no':
      return YES_NO[lang][value] ?? value;
    case 'area':
      return `${value} ${ACRES[lang]}`;
    case 'percent':
      return `${value}%`;
    case 'date':
      return formatDate(value, lang);
    case 'policy_ref':
      return ctx.policy ? `${ctx.policy.policy_no} (${ctx.policy.farmer_name})` : value;
    default:
      return value;
  }
}

function formatDate(iso: string, lang: LanguageCode): string {
  const locale = lang === 'hi' ? 'hi-IN' : lang === 'kn' ? 'kn-IN' : 'en-IN';
  try {
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(
      new Date(`${iso}T00:00:00Z`),
    );
  } catch {
    return iso;
  }
}

function cropLabel(ctx: Ctx, crop: string): string {
  const o = ctx.data.options.find((x) => x.question_code === 'crop_affected' && x.value === crop);
  return o ? optionLabel(o, ctx.session.language) : crop;
}

function fill(template: string, ctx: Ctx, extra: Record<string, string> = {}): string {
  const lang = ctx.session.language;
  const vars: Record<string, string> = {
    farmer_name: ctx.policy?.farmer_name ?? ctx.session.caller_name ?? '',
    village: ctx.policy?.village ?? '',
    insured_crops: ctx.policyCrops.map((c) => cropLabel(ctx, c.crop)).join(lang === 'en' ? ' and ' : ', '),
    crop: ctx.crop ? cropLabel(ctx, ctx.crop.crop) : '',
    insured_area: ctx.crop ? String(ctx.crop.insured_area_acres) : '',
    sowing_date: ctx.crop ? formatDate(ctx.crop.sowing_date, lang) : '',
    mobile_last4: ctx.policy?.mobile.slice(-4) ?? '',
    summary: buildSummary(ctx),
    ...extra,
  };
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? '');
}

function buildSummary(ctx: Ctx): string {
  const a = ctx.answers;
  const parts = [
    a.crop_affected && labelFor(ctx, 'crop_affected', a.crop_affected),
    a.cause_of_loss && labelFor(ctx, 'cause_of_loss', a.cause_of_loss),
    a.loss_date && labelFor(ctx, 'loss_date', a.loss_date),
    a.affected_area && labelFor(ctx, 'affected_area', a.affected_area),
    a.loss_percent && labelFor(ctx, 'loss_percent', a.loss_percent),
  ].filter(Boolean);
  return parts.join(', ');
}

function nextQuestion(ctx: Ctx): Question | null {
  for (const q of ctx.data.questions) {
    if (q.code in ctx.answers) continue;
    if (q.ask_if && !evaluateCondition(JSON.parse(q.ask_if), ruleCtx(ctx, ctx.answers))) continue;
    return q;
  }
  return null;
}

function progress(ctx: Ctx): string {
  const applicable = ctx.data.questions.filter(
    (q) => q.code in ctx.answers || !q.ask_if || evaluateCondition(JSON.parse(q.ask_if), ruleCtx(ctx, ctx.answers)),
  );
  const done = applicable.filter((q) => q.code in ctx.answers).length;
  return `${done}/${applicable.length}`;
}

function askPayload(ctx: Ctx, q: Question) {
  const lang = ctx.session.language;
  const opts = q.answer_type === 'enum' ? optionsFor(ctx, q) : [];
  return {
    ask: fill(questionText(q, lang), ctx),
    question_code: q.code,
    ...(opts.length && { options: opts.map((o) => optionLabel(o, lang)) }),
    ...(q.hint_en && { hint: q.hint_en }),
    progress: progress(ctx),
  };
}

function textFor(ctx: Ctx, key: string, extra: Record<string, string> = {}): string {
  const t = ctx.data.texts.get(key);
  return t ? fill(t[ctx.session.language], ctx, extra) : '';
}

async function setCurrent(sessionId: string, code: string | null, status?: string) {
  await run(
    `UPDATE sessions SET current_question = ?, pending_value = NULL, updated_at = datetime('now')
     ${status ? ', status = ?' : ''} WHERE id = ?`,
    status ? [code, status, sessionId] : [code, sessionId],
  );
}

async function logAnswer(
  sessionId: string,
  code: string,
  raw: string,
  match: MatchResult,
  accepted: boolean,
) {
  await run(
    `INSERT INTO answers (session_id, question_code, raw_text, normalized_value, match_method, confidence, accepted)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [sessionId, code, raw.slice(0, 1000), match.value ?? null, match.method, match.confidence, accepted ? 1 : 0],
  );
}

// ───────────────────────── tools ─────────────────────────

export async function getCurrentQuestion(sessionId: string): Promise<ToolResult> {
  const ctx = await loadCtx(sessionId);
  if (ctx.session.status === 'filed' || ctx.session.status === 'area_claim' || ctx.session.status === 'not_covered') {
    return { result: 'ended', instruction: 'The interview is over. Thank the farmer and close politely.' };
  }
  const q = nextQuestion(ctx);
  if (!q) {
    return {
      result: 'ready_to_file',
      instruction: 'All questions are answered. If the farmer already said yes to the summary, call fileClaim.',
    };
  }
  await setCurrent(sessionId, q.code);
  return {
    result: 'question',
    instruction: 'Ask this question in the session language, in your own simple words, exactly one question.',
    ...askPayload(ctx, q),
  };
}

export async function submitAnswer(
  sessionId: string,
  rawAnswer: string,
  interpretedValue?: string,
): Promise<ToolResult> {
  const ctx = await loadCtx(sessionId);
  const raw = (rawAnswer ?? '').trim();
  if (['filed', 'area_claim', 'not_covered'].includes(ctx.session.status)) {
    return { result: 'ended', instruction: 'The interview is already over. Close politely.' };
  }
  const q =
    ctx.data.questions.find((x) => x.code === ctx.session.current_question && !(x.code in ctx.answers)) ??
    nextQuestion(ctx);
  if (!q) {
    return { result: 'ready_to_file', instruction: 'Everything is answered. Call fileClaim if the farmer confirmed.' };
  }
  const options = optionsFor(ctx, q);
  const matchOpts = { options, hasEvidence: ctx.hasEvidence };

  // A pending fuzzy match is waiting for "yes".
  if (ctx.session.pending_value && !interpretedValue) {
    const pending = JSON.parse(ctx.session.pending_value) as MatchResult & { question: string };
    if (pending.question === q.code) {
      const yn = matchYesNo(normalize(raw), ctx.data);
      if (yn.status === 'matched' && yn.value === 'yes') {
        return acceptAnswer(ctx, q, raw, { ...pending, status: 'matched' });
      }
      await run('UPDATE sessions SET pending_value = NULL WHERE id = ?', [sessionId]);
      if (yn.status === 'matched' && yn.value === 'no') {
        await logAnswer(sessionId, q.code, raw, { status: 'nomatch', method: 'none', confidence: 0 }, false);
        return {
          result: 'retry',
          instruction: 'The farmer said no. Ask the same question again, simply.',
          ...askPayload(ctx, q),
        };
      }
      // Anything else: treat as a fresh answer below.
    }
  }

  let match = interpretedValue
    ? validateInterpreted(q, interpretedValue, ctx.data, matchOpts)
    : matchAnswer(q, raw, ctx.data, matchOpts);

  // Resolve policy references to an actual policy.
  if (q.answer_type === 'policy_ref' && match.status !== 'nomatch' && match.value) {
    const policy = await resolvePolicy(match.value);
    match = policy
      ? { ...match, status: 'matched', value: policy.policy_no }
      : { status: 'nomatch', method: match.method, confidence: match.confidence, value: match.value, reason: 'policy not found' };
    if (!policy) {
      await logAnswer(sessionId, q.code, raw, match, false);
      const rule = ctx.data.rules.find((r) => r.code === 'R_POLICY_NOT_FOUND');
      return {
        result: 'retry',
        instruction: 'No policy matched. Speak the message, then ask again.',
        messages: rule ? [fill(ruleMessage(rule, ctx.session.language), ctx)] : [],
        ...askPayload(ctx, q),
      };
    }
  }

  if (match.status === 'confirm' && match.value) {
    await run('UPDATE sessions SET pending_value = ? WHERE id = ?', [
      JSON.stringify({ ...match, question: q.code }),
      sessionId,
    ]);
    await logAnswer(sessionId, q.code, raw, match, false);
    return {
      result: 'confirm',
      understood: labelFor(ctx, q.code, match.value),
      instruction: `Not fully sure. Ask the farmer to confirm: did they mean "${labelFor(ctx, q.code, match.value)}"? Then call submitAnswer with their reply.`,
      question_code: q.code,
    };
  }

  if (match.status === 'nomatch') {
    await logAnswer(sessionId, q.code, raw, match, false);
    const failures = await queryOne<{ n: number }>(
      `SELECT COUNT(*) AS n FROM answers WHERE session_id = ? AND question_code = ? AND accepted = 0
         AND id > COALESCE((SELECT MAX(id) FROM answers WHERE session_id = ? AND question_code = ? AND accepted = 1), 0)`,
      [sessionId, q.code, sessionId, q.code],
    );
    const attempts = Number(failures?.n ?? 0);
    if (!interpretedValue && attempts >= q.max_retries) {
      return {
        result: 'needs_interpretation',
        instruction:
          q.answer_type === 'enum'
            ? 'The rules could not match the answer. Decide which allowed option the farmer meant and call submitInterpretation with the same raw_answer and interpreted_value set to that option. If you truly cannot tell, ask one short clarifying question.'
            : `The rules could not understand the answer. Work out the ${q.answer_type} the farmer meant (dates as YYYY-MM-DD, areas in acres, percentages as a number) and call submitInterpretation with the same raw_answer and interpreted_value. If you cannot tell, ask one short clarifying question.`,
        reason: match.reason,
        ...askPayload(ctx, q),
      };
    }
    return {
      result: 'retry',
      instruction: 'The answer was not clear. Ask again in simpler words, using the hint.',
      reason: match.reason,
      ...askPayload(ctx, q),
    };
  }

  return acceptAnswer(ctx, q, raw, match);
}

async function resolvePolicy(value: string): Promise<PolicyRow | null> {
  if (value.startsWith('SUFFIX:')) {
    return queryOne<PolicyRow>("SELECT * FROM policies WHERE policy_no LIKE ?", [`%-${value.slice(7)}`]);
  }
  if (/^\d{10}$/.test(value)) {
    return queryOne<PolicyRow>('SELECT * FROM policies WHERE mobile = ?', [value]);
  }
  return queryOne<PolicyRow>('SELECT * FROM policies WHERE policy_no = ?', [value]);
}

async function acceptAnswer(ctx: Ctx, q: Question, raw: string, match: MatchResult): Promise<ToolResult> {
  const sessionId = ctx.session.id;
  const lang = ctx.session.language;
  const value = match.value!;
  const candidate = { ...ctx.answers, [q.code]: value };

  // Context as it would be after accepting (policy / crop may change with this answer).
  let policy = ctx.policy;
  if (q.code === 'policy_ref') {
    policy = await queryOne<PolicyRow>('SELECT * FROM policies WHERE policy_no = ?', [value]);
  }
  const crop =
    q.code === 'crop_affected' ? (ctx.policyCrops.find((c) => c.crop === value) ?? null) : ctx.crop;
  const rc: RuleContext = { answers: candidate, policy, crop, firedRules: ctx.firedRules };

  const rules = ctx.data.rules
    .filter((r) => r.question_code === q.code)
    .sort((a, b) => order(a) - order(b));
  const messages: string[] = [];
  for (const rule of rules) {
    if (!evaluateCondition(rule.condition, rc)) continue;
    const msg = fill(ruleMessage(rule, lang), { ...ctx, policy, crop, answers: candidate });
    if (rule.rule_type === 'reject') {
      await logAnswer(sessionId, q.code, raw, { ...match, reason: rule.code }, false);
      return {
        result: 'retry',
        instruction: 'The answer broke a rule. Speak the message, then ask again.',
        messages: [msg],
        rule: rule.code,
        ...askPayload(ctx, q),
      };
    }
    if (rule.rule_type === 'branch') {
      const goto = String(rule.condition.goto ?? '');
      if (goto === 'END_AREA_BASED' || goto === 'END_NOT_COVERED') {
        await logAnswer(sessionId, q.code, raw, match, true);
        const status = goto === 'END_AREA_BASED' ? 'area_claim' : 'not_covered';
        await run(
          `UPDATE sessions SET current_question = NULL, pending_value = NULL, status = ?, outcome_note = ?,
             updated_at = datetime('now') WHERE id = ?`,
          [status, rule.code, sessionId],
        );
        const closingCtx = { ...ctx, answers: candidate };
        return {
          result: 'ended',
          instruction: 'Speak the messages and the closing line kindly, then stop asking questions.',
          messages: [msg, textFor(closingCtx, goto === 'END_AREA_BASED' ? 'closing_area_based' : 'closing_not_covered')],
          rule: rule.code,
        };
      }
      // Branch back to an earlier question (e.g. "this is not my policy").
      await logAnswer(sessionId, q.code, raw, match, false);
      await run(
        `UPDATE answers SET accepted = 0 WHERE session_id = ? AND question_code IN ('policy_ref','confirm_identity')`,
        [sessionId],
      );
      await run('UPDATE sessions SET policy_no = NULL WHERE id = ?', [sessionId]);
      await setCurrent(sessionId, goto);
      const fresh = await loadCtx(sessionId);
      const target = fresh.data.questions.find((x) => x.code === goto) ?? nextQuestion(fresh)!;
      return {
        result: 'retry',
        instruction: 'Speak the message, then ask the question.',
        messages: [msg],
        ...askPayload(fresh, target),
      };
    }
    // warn / flag: accept and tell the farmer.
    messages.push(msg);
  }

  await logAnswer(sessionId, q.code, raw, match, true);
  if (q.code === 'policy_ref') {
    await run('UPDATE sessions SET policy_no = ? WHERE id = ?', [value, sessionId]);
  }

  // Final confirmation decides between filing and correcting.
  if (q.code === 'final_confirmation') {
    if (value === 'yes') {
      await setCurrent(sessionId, null, 'awaiting_approval');
      return {
        result: 'ready_to_file',
        understood: YES_NO[lang].yes,
        instruction: 'The farmer approved the summary. Call fileClaim with confirmed=true now.',
      };
    }
    await run(
      `UPDATE answers SET accepted = 0 WHERE session_id = ? AND question_code = 'final_confirmation'`,
      [sessionId],
    );
    const fresh = await loadCtx(sessionId);
    return {
      result: 'correction_needed',
      instruction:
        'The farmer wants to change something. Ask what is wrong, then call correctAnswer with the matching question_code and their new answer.',
      answered: Object.keys(fresh.answers).map((code) => ({ question_code: code, value: labelFor(fresh, code, fresh.answers[code]) })),
    };
  }

  const fresh = await loadCtx(sessionId);
  const next = nextQuestion(fresh);
  await setCurrent(sessionId, next?.code ?? null);
  return {
    result: 'accepted',
    understood: labelFor(fresh, q.code, value),
    method: match.method,
    confidence: match.confidence,
    ...(messages.length && { messages }),
    instruction: next
      ? 'Briefly acknowledge, speak any messages, then ask the next question.'
      : 'All questions answered. Read the summary and ask for a clear yes.',
    ...(next ? askPayload(fresh, next) : {}),
  };
}

function order(r: Rule) {
  return { reject: 0, branch: 1, warn: 2, flag: 3 }[r.rule_type];
}

export async function correctAnswer(sessionId: string, questionCode: string, rawAnswer: string): Promise<ToolResult> {
  const ctx = await loadCtx(sessionId);
  const q = ctx.data.questions.find((x) => x.code === questionCode);
  if (!q) {
    return {
      result: 'error',
      instruction: `Unknown question_code. Valid codes: ${ctx.data.questions.map((x) => x.code).join(', ')}.`,
    };
  }
  await run('UPDATE answers SET accepted = 0 WHERE session_id = ? AND question_code IN (?, ?)', [
    sessionId,
    questionCode,
    'final_confirmation',
  ]);
  if (questionCode === 'policy_ref') await run('UPDATE sessions SET policy_no = NULL WHERE id = ?', [sessionId]);
  await run(`UPDATE sessions SET current_question = ?, pending_value = NULL, status = 'in_progress' WHERE id = ?`, [
    questionCode,
    sessionId,
  ]);
  return submitAnswer(sessionId, rawAnswer);
}

export async function setLanguage(sessionId: string, language: LanguageCode): Promise<ToolResult> {
  await run('UPDATE sessions SET language = ? WHERE id = ?', [language, sessionId]);
  const ctx = await loadCtx(sessionId);
  const q = nextQuestion(ctx);
  return {
    result: 'question',
    instruction: `Language switched. Continue in ${language === 'hi' ? 'Hindi' : language === 'kn' ? 'Kannada' : 'English'}.`,
    ...(q ? askPayload(ctx, q) : {}),
  };
}

export async function fileClaim(sessionId: string, confirmed: boolean, farmerWords = ''): Promise<ToolResult> {
  let ctx = await loadCtx(sessionId);
  // The LLM often goes straight to fileClaim on "haan, darj kar do". Record that approval
  // through the normal (deterministic) final_confirmation step first.
  if (
    farmerWords &&
    ctx.session.status === 'in_progress' &&
    !('final_confirmation' in ctx.answers) &&
    nextQuestion(ctx)?.code === 'final_confirmation'
  ) {
    const approval = await submitAnswer(sessionId, farmerWords);
    if (approval.result !== 'ready_to_file') return approval;
    ctx = await loadCtx(sessionId);
  }
  const lang = ctx.session.language;
  if (ctx.session.status === 'filed') {
    const existing = await queryOne<{ claim_id: string }>('SELECT claim_id FROM claims WHERE session_id = ?', [sessionId]);
    return { result: 'filed', instruction: 'Already filed. Repeat the claim number.', claim_id: existing?.claim_id };
  }
  if (!confirmed || ctx.answers.final_confirmation !== 'yes' || ctx.session.status !== 'awaiting_approval') {
    const q = nextQuestion(ctx);
    return {
      result: 'error',
      instruction:
        'Cannot file yet: the farmer must first hear the summary and say yes. Ask the next question instead.',
      ...(q ? askPayload(ctx, q) : {}),
    };
  }
  if (!ctx.policy || !ctx.crop) {
    return { result: 'error', instruction: 'Policy or crop is missing. Ask for them again with correctAnswer.' };
  }

  const a = ctx.answers;
  const cause = ctx.data.options.find((o) => o.question_code === 'cause_of_loss' && o.value === a.cause_of_loss);
  const pathMeta = String(cause?.meta?.claim_path ?? 'individual');
  const claimPath =
    pathMeta === 'by_stage' ? (a.crop_stage === 'harvested_drying' ? 'post_harvest' : 'individual') : pathMeta;
  const today = todayIST();
  const lossDays = Math.round((today.getTime() - Date.parse(a.loss_date)) / 86400000);
  const within72h = lossDays <= 3;
  const area = Number(a.affected_area);
  const pct = Number(a.loss_percent);
  const payout =
    Math.round((ctx.crop.sum_insured_inr * Math.min(1, area / ctx.crop.insured_area_acres) * pct) / 100 / 100) * 100;

  const flags = new Set(ctx.firedRules);
  const filingRules = ctx.data.rules.filter((r) => !r.question_code);
  for (const r of filingRules) {
    if (evaluateCondition(r.condition, ruleCtx(ctx, a))) flags.add(r.code);
  }

  const count = await queryOne<{ n: number }>('SELECT COUNT(*) AS n FROM claims');
  // Short, easy to read aloud: FBS-26 + running number (e.g. FBS-260007).
  const claimId = `FBS-${String(today.getUTCFullYear()).slice(2)}${String(Number(count?.n ?? 0) + 1).padStart(4, '0')}`;

  await run(
    `INSERT INTO claims (claim_id, session_id, policy_no, crop, survey_no, cause, claim_path, loss_date,
       within_72h, affected_area_acres, loss_percent, indicative_payout_inr, flags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      claimId, sessionId, ctx.policy.policy_no, ctx.crop.crop, ctx.crop.survey_no, a.cause_of_loss, claimPath,
      a.loss_date, within72h ? 1 : 0, area, pct, payout, JSON.stringify([...flags]),
    ],
  );

  const day = (n: number) => isoDate(new Date(today.getTime() + n * 86400000));
  const surveyorDate = flags.has('R_HIGH_LOSS_PRIORITY') ? day(1) : day(2);
  const followUps: { kind: string; when: string; message: string }[] = [];
  if (a.confirm_sms === 'yes') {
    followUps.push({
      kind: 'sms_confirmation',
      when: isoDate(today),
      message: `DialMind: Claim ${claimId} registered for ${ctx.crop.crop} (survey ${ctx.crop.survey_no}). Surveyor visit by ${surveyorDate}.`,
    });
  }
  followUps.push({
    kind: 'surveyor_visit',
    when: surveyorDate,
    message: `Surveyor visit to survey no. ${ctx.crop.survey_no}, ${ctx.policy.village}${flags.has('R_HIGH_LOSS_PRIORITY') ? ' (priority)' : ''}.`,
  });
  if (flags.has('R_NO_EVIDENCE')) {
    followUps.push({ kind: 'document_reminder', when: day(1), message: 'Reminder: keep crop photos and bank passbook ready for the surveyor.' });
  }
  followUps.push({ kind: 'status_update', when: day(7), message: `Status update for claim ${claimId}.` });
  for (const f of followUps) {
    await run('INSERT INTO follow_ups (claim_id, kind, scheduled_for, message) VALUES (?, ?, ?, ?)', [
      claimId, f.kind, f.when, f.message,
    ]);
  }
  await run(
    `UPDATE sessions SET status = 'filed', current_question = NULL, outcome_note = ?, updated_at = datetime('now') WHERE id = ?`,
    [claimId, sessionId],
  );

  const spokenId = claimId.replace(/-/g, ' ').split('').join(' ').replace(/\s+/g, ' ');
  return {
    result: 'filed',
    instruction:
      'The claim is registered. Speak the closing line, reading the claim number slowly. Mention the payout only as an estimate if the farmer asks.',
    claim_id: claimId,
    claim_id_spoken: spokenId,
    indicative_payout_inr: payout,
    surveyor_visit_by: formatDate(surveyorDate, lang),
    within_72h: within72h,
    flags: [...flags],
    messages: [textFor(ctx, 'closing_filed', { claim_id: spokenId, surveyor_date: formatDate(surveyorDate, lang) })],
  };
}

export async function getClaimStatus(claimIdOrMobile: string): Promise<ToolResult> {
  const key = (claimIdOrMobile ?? '').trim().toUpperCase().replace(/\s+/g, '');
  const claim = await queryOne<Record<string, unknown>>(
    `SELECT c.* FROM claims c JOIN policies p ON p.policy_no = c.policy_no
      WHERE c.claim_id = ? OR p.mobile = ? ORDER BY c.intimated_at DESC LIMIT 1`,
    [key, key.replace(/\D/g, '')],
  );
  if (!claim) return { result: 'status', instruction: 'No claim found. Ask them to check the number.' };
  return {
    result: 'status',
    instruction: 'Tell the farmer the claim status simply.',
    claim_id: claim.claim_id,
    status: claim.status,
    crop: claim.crop,
    loss_date: claim.loss_date,
  };
}

/** Live state for the call screen's claim panel and the claims console. */
export async function getSessionState(sessionId: string) {
  const ctx = await loadCtx(sessionId);
  const current = nextQuestion(ctx);
  const claim = await queryOne<Record<string, unknown>>('SELECT * FROM claims WHERE session_id = ?', [sessionId]);
  const followUps = claim
    ? await queryAll('SELECT kind, scheduled_for, message, status FROM follow_ups WHERE claim_id = ? ORDER BY scheduled_for', [
        claim.claim_id as string,
      ])
    : [];
  const attempts = await queryAll<{ question_code: string; method: string; confidence: number; accepted: number }>(
    'SELECT question_code, match_method AS method, confidence, accepted FROM answers WHERE session_id = ? ORDER BY id',
    [sessionId],
  );
  const lastByQ = new Map<string, { method: string; confidence: number }>();
  for (const a of attempts) if (a.accepted) lastByQ.set(a.question_code, { method: a.method, confidence: Number(a.confidence) });

  return {
    sessionId,
    status: ctx.session.status,
    language: ctx.session.language,
    progress: progress(ctx),
    currentQuestion: ctx.session.status === 'in_progress' ? (current?.code ?? null) : null,
    policy: ctx.policy && {
      policy_no: ctx.policy.policy_no,
      farmer_name: ctx.policy.farmer_name,
      village: ctx.policy.village,
      district: ctx.policy.district,
    },
    fields: ctx.data.questions
      .filter((q) => q.code in ctx.answers && !['confirm_identity', 'final_confirmation'].includes(q.code))
      .map((q) => ({
        code: q.code,
        label: q.code,
        value: labelFor(ctx, q.code, ctx.answers[q.code]),
        method: lastByQ.get(q.code)?.method ?? 'exact',
        confidence: lastByQ.get(q.code)?.confidence ?? 1,
      })),
    flags: [...ctx.firedRules],
    claim: claim && {
      claim_id: claim.claim_id,
      claim_path: claim.claim_path,
      indicative_payout_inr: Number(claim.indicative_payout_inr),
      within_72h: Number(claim.within_72h) === 1,
      flags: JSON.parse(String(claim.flags ?? '[]')),
    },
    followUps,
  };
}
