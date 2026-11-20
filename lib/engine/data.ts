import { queryAll } from '@/lib/db';
import type { LanguageCode } from '@/lib/vanya';

// Interview definition loaded from the database (questions, options, lexicon, rules, texts).
// Cached in memory; it only changes when the seed is reloaded.

export type AnswerType =
  | 'enum' | 'yes_no' | 'number' | 'area' | 'percent' | 'date' | 'mobile' | 'policy_ref' | 'photo' | 'free_text';

export interface Question {
  code: string;
  seq: number;
  answer_type: AnswerType;
  text_en: string;
  text_hi: string;
  text_kn: string;
  hint_en: string | null;
  validation_regex: string | null;
  min_value: number | null;
  max_value: number | null;
  required: number;
  ask_if: string | null;
  max_retries: number;
}

export interface QuestionOption {
  question_code: string;
  value: string;
  label_en: string;
  label_hi: string;
  label_kn: string;
  synonyms: string[];
  meta: Record<string, unknown> | null;
}

export interface Rule {
  code: string;
  question_code: string | null;
  description: string;
  rule_type: 'reject' | 'warn' | 'branch' | 'flag';
  condition: Record<string, unknown>;
  message_en: string;
  message_hi: string;
  message_kn: string;
}

export interface InterviewData {
  questions: Question[];
  options: QuestionOption[];
  rules: Rule[];
  numberWords: Map<string, number>;
  dayOffsets: Map<string, number>;
  areaUnits: Map<string, number>;
  percentWords: Map<string, number>;
  yesWords: Set<string>;
  noWords: Set<string>;
  texts: Map<string, Record<LanguageCode, string>>;
}

const CACHE_MS = 60_000;

// English number words (ASR often spells these out) merged under the DB lexicon.
const EN_NUMBERS: [string, number][] = (
  [
    ['one', 1], ['two', 2], ['three', 3], ['four', 4], ['five', 5], ['six', 6], ['seven', 7],
    ['eight', 8], ['nine', 9], ['ten', 10], ['eleven', 11], ['twelve', 12], ['fifteen', 15],
    ['twenty', 20], ['twenty five', 25], ['thirty', 30], ['forty', 40], ['fifty', 50],
    ['sixty', 60], ['seventy', 70], ['eighty', 80], ['ninety', 90], ['hundred', 100],
  ] as [string, number][]
);
const g = globalThis as typeof globalThis & {
  __interviewData?: { at: number; data: Promise<InterviewData> };
};

async function load(): Promise<InterviewData> {
  const [questions, optionRows, ruleRows, lexicon, textRows] = await Promise.all([
    queryAll<Question>('SELECT * FROM questions ORDER BY seq'),
    queryAll<Record<string, unknown>>('SELECT * FROM question_options ORDER BY id'),
    queryAll<Record<string, unknown>>('SELECT * FROM rules'),
    queryAll<{ term: string; kind: string; value: number }>('SELECT term, kind, value FROM lexicon'),
    queryAll<{ key: string; text_en: string; text_hi: string; text_kn: string }>('SELECT * FROM agent_texts'),
  ]);

  const options: QuestionOption[] = optionRows.map((r) => ({
    question_code: String(r.question_code),
    value: String(r.value),
    label_en: String(r.label_en),
    label_hi: String(r.label_hi),
    label_kn: String(r.label_kn),
    synonyms: String(r.synonyms)
      .split('|')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    meta: r.meta ? (JSON.parse(String(r.meta)) as Record<string, unknown>) : null,
  }));

  const rules: Rule[] = ruleRows.map((r) => ({
    code: String(r.code),
    question_code: r.question_code ? String(r.question_code) : null,
    description: String(r.description),
    rule_type: r.rule_type as Rule['rule_type'],
    condition: JSON.parse(String(r.condition)) as Record<string, unknown>,
    message_en: String(r.message_en),
    message_hi: String(r.message_hi),
    message_kn: String(r.message_kn),
  }));

  const byKind = (kind: string) =>
    new Map(lexicon.filter((l) => l.kind === kind).map((l) => [l.term.toLowerCase(), Number(l.value)]));

  return {
    questions: questions.map((q) => ({
      ...q,
      seq: Number(q.seq),
      required: Number(q.required),
      max_retries: Number(q.max_retries),
      min_value: q.min_value === null ? null : Number(q.min_value),
      max_value: q.max_value === null ? null : Number(q.max_value),
    })),
    options,
    rules,
    numberWords: new Map([...EN_NUMBERS, ...byKind('number')]),
    dayOffsets: byKind('day_offset'),
    areaUnits: byKind('area_unit'),
    percentWords: byKind('percent'),
    yesWords: new Set(byKind('yes').keys()),
    noWords: new Set(byKind('no').keys()),
    texts: new Map(
      textRows.map((t) => [t.key, { en: t.text_en, hi: t.text_hi, kn: t.text_kn } as Record<LanguageCode, string>]),
    ),
  };
}

export function getInterviewData(): Promise<InterviewData> {
  const cached = g.__interviewData;
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.data;
  const data = load();
  g.__interviewData = { at: Date.now(), data };
  data.catch(() => {
    g.__interviewData = undefined;
  });
  return data;
}

export function questionText(q: Question, lang: LanguageCode): string {
  return lang === 'hi' ? q.text_hi : lang === 'kn' ? q.text_kn : q.text_en;
}

export function optionLabel(o: QuestionOption, lang: LanguageCode): string {
  return lang === 'hi' ? o.label_hi : lang === 'kn' ? o.label_kn : o.label_en;
}

export function ruleMessage(r: Rule, lang: LanguageCode): string {
  return lang === 'hi' ? r.message_hi : lang === 'kn' ? r.message_kn : r.message_en;
}
