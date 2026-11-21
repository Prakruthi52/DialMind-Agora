import type { InterviewData, Question, QuestionOption } from './data';
import {
  bestNgramSimilarity,
  containsPhrase,
  extractDigits,
  normalize,
  parseNumber,
  tokens,
} from './text';

// Deterministic answer matching. Each matcher returns the normalised value plus the method
// and confidence; the LLM is only consulted (by the flow) when these fail.

export type MatchMethod = 'exact' | 'synonym' | 'regex' | 'lexicon' | 'fuzzy' | 'llm' | 'none';

export interface MatchResult {
  status: 'matched' | 'confirm' | 'nomatch';
  value?: string;
  method: MatchMethod;
  confidence: number;
  /** Why it did not match, for logs and the claims console. */
  reason?: string;
}

const FUZZY_ACCEPT = 0.9;
const FUZZY_CONFIRM = 0.85;

const nomatch = (reason: string): MatchResult => ({ status: 'nomatch', method: 'none', confidence: 0, reason });

// ───────────────────────── yes / no ─────────────────────────

export function matchYesNo(text: string, data: InterviewData): MatchResult {
  const hasAny = (words: Set<string>) => [...words].some((w) => containsPhrase(text, w));
  const yes = hasAny(data.yesWords);
  const no = hasAny(data.noWords);
  if (no && !yes) return { status: 'matched', value: 'no', method: 'lexicon', confidence: 0.95 };
  if (yes && !no) return { status: 'matched', value: 'yes', method: 'lexicon', confidence: 0.95 };
  if (yes && no) return nomatch('both yes and no words');
  return nomatch('no yes/no word');
}

// ───────────────────────── enum ─────────────────────────

export function matchEnum(text: string, options: QuestionOption[]): MatchResult {
  // 1. Exact / synonym phrase, preferring the longest synonym ("bemausam barish" over "barish").
  let best: { option: QuestionOption; len: number; exact: boolean } | null = null;
  for (const option of options) {
    for (const syn of option.synonyms) {
      if (containsPhrase(text, syn) && (!best || syn.length > best.len)) {
        best = { option, len: syn.length, exact: syn === option.value };
      }
    }
  }
  if (best) {
    return {
      status: 'matched',
      value: best.option.value,
      method: best.exact ? 'exact' : 'synonym',
      confidence: 1,
    };
  }

  // 2. Fuzzy against Latin synonyms (absorbs ASR spelling noise: "olavrusti", "togri").
  // Short words ("badh", "ole") are easy to hit by accident ("blah"), so they need a much
  // closer match; the score is penalised instead of using separate thresholds.
  let fuzzy: { option: QuestionOption; score: number } | null = null;
  for (const option of options) {
    for (const syn of option.synonyms) {
      if (!/^[a-z ]+$/.test(syn) || syn.length < 3) continue;
      const raw = bestNgramSimilarity(text, syn);
      const score = syn.length <= 5 ? raw - 0.08 : raw;
      if (!fuzzy || score > fuzzy.score) fuzzy = { option, score };
    }
  }
  if (fuzzy && fuzzy.score >= FUZZY_ACCEPT) {
    return { status: 'matched', value: fuzzy.option.value, method: 'fuzzy', confidence: round(fuzzy.score) };
  }
  if (fuzzy && fuzzy.score >= FUZZY_CONFIRM) {
    return { status: 'confirm', value: fuzzy.option.value, method: 'fuzzy', confidence: round(fuzzy.score) };
  }
  return nomatch(`no option matched${fuzzy ? ` (best fuzzy ${round(fuzzy.score)})` : ''}`);
}

// ───────────────────────── policy / mobile ─────────────────────────

const POLICY_RE = /PMFBY-?([A-Z]{2})-?(\d{2}[KR])-?(\d{6})/;

export function matchPolicyRef(raw: string, text: string, regex: string | null): MatchResult {
  const compact = raw.toUpperCase().replace(/[\s.]/g, '');
  const policy = compact.match(POLICY_RE);
  if (policy) {
    return {
      status: 'matched',
      value: `PMFBY-${policy[1]}-${policy[2]}-${policy[3]}`,
      method: 'regex',
      confidence: 0.95,
    };
  }
  const digits = extractDigits(text);
  const mobile = digits.match(/[6-9]\d{9}/);
  if (mobile) {
    const value = mobile[0];
    if (regex && !new RegExp(regex).test(value)) return nomatch('failed validation regex');
    return { status: 'matched', value, method: 'regex', confidence: digits.length === 10 ? 0.95 : 0.85 };
  }
  // Six-digit policy suffix ("zero zero zero one two three") → looked up by suffix.
  if (/^\d{6}$/.test(digits)) {
    return { status: 'confirm', value: `SUFFIX:${digits}`, method: 'regex', confidence: 0.8 };
  }
  return nomatch(digits ? `only ${digits.length} digits heard` : 'no digits heard');
}

// ───────────────────────── dates ─────────────────────────

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, janvari: 1, 'जनवरी': 1, 'ಜನವರಿ': 1,
  feb: 2, february: 2, farvari: 2, 'फरवरी': 2, 'ಫೆಬ್ರವರಿ': 2,
  mar: 3, march: 3, 'मार्च': 3, 'ಮಾರ್ಚ್': 3,
  apr: 4, april: 4, 'अप्रैल': 4, 'ಏಪ್ರಿಲ್': 4,
  may: 5, mai: 5, 'मई': 5, 'ಮೇ': 5,
  jun: 6, june: 6, joon: 6, 'जून': 6, 'ಜೂನ್': 6,
  jul: 7, july: 7, julai: 7, 'जुलाई': 7, 'ಜುಲೈ': 7,
  aug: 8, august: 8, agast: 8, 'अगस्त': 8, 'ಆಗಸ್ಟ್': 8,
  sep: 9, sept: 9, september: 9, sitambar: 9, 'सितंबर': 9, 'ಸೆಪ್ಟೆಂಬರ್': 9,
  oct: 10, october: 10, aktubar: 10, 'अक्टूबर': 10, 'ಅಕ್ಟೋಬರ್': 10,
  nov: 11, november: 11, navambar: 11, 'नवंबर': 11, 'ನವೆಂಬರ್': 11,
  dec: 12, december: 12, disambar: 12, 'दिसंबर': 12, 'ಡಿಸೆಂಬರ್': 12,
};
const DAYS_AGO_WORDS = [
  'days ago', 'day ago', 'din pehle', 'din pahle', 'din hue', 'dino pehle', 'din se',
  'dina hinde', 'dinagala hinde', 'dinada hinde', 'दिन पहले', 'दिन हो गए', 'ದಿನ ಹಿಂದೆ', 'ದಿನಗಳ ಹಿಂದೆ', 'ದಿನ ಆಯ್ತು',
  'நாள் முன்னாடி', 'நாளைக்கு முன்', 'நாட்களுக்கு முன்', 'naal munnadi', // Tamil
  'రోజుల క్రితం', 'రోజుల ముందు', 'rojula kritam', // Telugu
  'দিন আগে', 'din age', // Bengali
  'દિવસ પહેલાં', 'દિવસ પહેલા', 'divas pahela', // Gujarati
  'दिवसांपूर्वी', 'दिवसांआधी', 'दिवस झाले', 'divsanpurvi', // Marathi
  'ദിവസം മുമ്പ്', 'ദിവസം മുൻപ്', 'divasam munpu', // Malayalam
  'ਦਿਨ ਪਹਿਲਾਂ', 'din pehlan', // Punjabi
  'ଦିନ ପୂର୍ବରୁ', 'ଦିନ ଆଗରୁ', 'dina purbaru', // Odia
];
const WEEK_AGO_WORDS = ['last week', 'pichhle hafte', 'pichle hafte', 'kaleda vaara', 'ಕಳೆದ ವಾರ'];

/** "Today" in India (IST), so "kal" means the right calendar day on any server. */
export function todayIST(now = new Date()): Date {
  const ist = new Date(now.getTime() + 5.5 * 3600 * 1000);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function matchDate(text: string, data: InterviewData, now = new Date()): MatchResult {
  const today = todayIST(now);
  const shift = (days: number) => isoDate(new Date(today.getTime() + days * 86400000));

  // "3 din pehle", "teen din pehle", "two days ago"
  if (DAYS_AGO_WORDS.some((w) => text.includes(w))) {
    const n = parseNumber(text, data.numberWords);
    if (n !== null && n >= 0 && n < 120) {
      return { status: 'matched', value: shift(-Math.round(n)), method: 'lexicon', confidence: 0.9 };
    }
  }
  if (WEEK_AGO_WORDS.some((w) => text.includes(w))) {
    return { status: 'confirm', value: shift(-7), method: 'lexicon', confidence: 0.75 };
  }

  // Explicit dates: "18 november", "november 18", "18/11", "18-11-2026"
  const numeric = text.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (numeric) {
    const day = +numeric[1];
    const month = +numeric[2];
    const year = numeric[3] ? normaliseYear(+numeric[3]) : guessYear(today, month, day);
    const iso = safeIso(year, month, day);
    if (iso) return { status: 'matched', value: iso, method: 'regex', confidence: 0.95 };
  }
  const toks = tokens(text);
  for (let i = 0; i < toks.length; i++) {
    const month = MONTHS[toks[i]];
    if (!month) continue;
    const before = toks[i - 1] && /^\d{1,2}$/.test(toks[i - 1]) ? +toks[i - 1] : null;
    const after = toks[i + 1] && /^\d{1,2}$/.test(toks[i + 1]) ? +toks[i + 1] : null;
    const wordBefore = toks[i - 1] ? data.numberWords.get(toks[i - 1]) : undefined;
    const day = before ?? after ?? (wordBefore !== undefined ? wordBefore : null);
    if (day) {
      const iso = safeIso(guessYear(today, month, day), month, day);
      if (iso) return { status: 'matched', value: iso, method: 'regex', confidence: 0.95 };
    }
  }

  // Relative day words: aaj, kal, parso, ninne, monne, yesterday … (longest phrase first)
  const offsets = [...data.dayOffsets.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [term, offset] of offsets) {
    if (containsPhrase(text, term)) {
      return { status: 'matched', value: shift(offset), method: 'lexicon', confidence: 0.9 };
    }
  }
  return nomatch('no date found');
}

function normaliseYear(y: number) {
  return y < 100 ? 2000 + y : y;
}
function guessYear(today: Date, month: number, day: number) {
  // A spoken date without a year is in the past (loss / harvest already happened).
  const y = today.getUTCFullYear();
  const candidate = Date.UTC(y, month - 1, day);
  return candidate > today.getTime() ? y - 1 : y;
}
function safeIso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 ? isoDate(date) : null;
}

// ───────────────────────── area / percent / number ─────────────────────────

export function matchArea(text: string, data: InterviewData): MatchResult {
  const n = parseNumber(text, data.numberWords);
  if (n === null || n <= 0) return nomatch('no quantity heard');
  const units = [...data.areaUnits.entries()].sort((a, b) => b[0].length - a[0].length);
  const unit = units.find(([term]) => containsPhrase(text, term));
  if (unit) {
    const acres = Math.round(n * unit[1] * 1000) / 1000;
    return { status: 'matched', value: String(acres), method: 'lexicon', confidence: 0.9 };
  }
  // No unit: assume acres, but confirm.
  return { status: 'confirm', value: String(n), method: 'lexicon', confidence: 0.8, reason: 'unit assumed acres' };
}

export function matchPercent(text: string, data: InterviewData): MatchResult {
  const words = [...data.percentWords.entries()].sort((a, b) => b[0].length - a[0].length);
  const word = words.find(([term]) => containsPhrase(text, term));
  const n = parseNumber(text, data.numberWords);
  if (n !== null && n > 1 && n <= 100) {
    return { status: 'matched', value: String(Math.round(n)), method: 'lexicon', confidence: 0.9 };
  }
  if (word) return { status: 'matched', value: String(word[1]), method: 'lexicon', confidence: 0.85 };
  return nomatch('no percentage heard');
}

export function matchNumber(text: string, data: InterviewData): MatchResult {
  const n = parseNumber(text, data.numberWords);
  return n === null
    ? nomatch('no number heard')
    : { status: 'matched', value: String(n), method: 'lexicon', confidence: 0.9 };
}

// ───────────────────────── photo / free text ─────────────────────────

const SKIP_WORDS = ['skip', 'later', 'baad mein', 'baad me', 'nahi hai', 'not now', 'illa', 'beda', 'amele', 'aamele', 'no'];

export function matchPhoto(text: string, hasEvidence: boolean): MatchResult {
  if (hasEvidence) return { status: 'matched', value: 'captured', method: 'exact', confidence: 1 };
  if (SKIP_WORDS.some((w) => containsPhrase(text, w))) {
    return { status: 'matched', value: 'skipped', method: 'lexicon', confidence: 0.95 };
  }
  return nomatch('no photo yet; ask the farmer to tap Show crop or say skip');
}

// ───────────────────────── dispatcher ─────────────────────────

export function matchAnswer(
  question: Question,
  raw: string,
  data: InterviewData,
  opts: { options: QuestionOption[]; hasEvidence: boolean; now?: Date },
): MatchResult {
  const text = normalize(raw);
  if (!text) return nomatch('empty answer');
  switch (question.answer_type) {
    case 'yes_no':
      return matchYesNo(text, data);
    case 'enum':
      return matchEnum(text, opts.options);
    case 'policy_ref':
    case 'mobile':
      return matchPolicyRef(raw, text, question.validation_regex);
    case 'date':
      return matchDate(text, data, opts.now);
    case 'area':
      return matchArea(text, data);
    case 'percent':
      return matchPercent(text, data);
    case 'number':
      return matchNumber(text, data);
    case 'photo':
      return matchPhoto(text, opts.hasEvidence);
    case 'free_text':
      return raw.trim().length >= 2
        ? { status: 'matched', value: raw.trim().slice(0, 500), method: 'exact', confidence: 1 }
        : nomatch('too short');
  }
}

/**
 * Validates a value the LLM proposed after deterministic matching failed. The LLM never
 * gets to store anything the engine would not accept.
 */
export function validateInterpreted(
  question: Question,
  interpreted: string,
  data: InterviewData,
  opts: { options: QuestionOption[]; hasEvidence: boolean; now?: Date },
): MatchResult {
  const v = interpreted.trim();
  if (!v) return nomatch('empty interpretation');
  const asLlm = (r: MatchResult): MatchResult =>
    r.status === 'nomatch' ? r : { ...r, status: 'matched', method: 'llm', confidence: 0.7 };
  switch (question.answer_type) {
    case 'enum': {
      const lower = v.toLowerCase();
      const direct = opts.options.find(
        (o) => o.value === lower || o.label_en.toLowerCase() === lower,
      );
      if (direct) return { status: 'matched', value: direct.value, method: 'llm', confidence: 0.7 };
      return asLlm(matchEnum(normalize(v), opts.options));
    }
    case 'yes_no':
      return /^(yes|no)$/i.test(v)
        ? { status: 'matched', value: v.toLowerCase(), method: 'llm', confidence: 0.7 }
        : nomatch('interpretation must be yes or no');
    case 'date':
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return { status: 'matched', value: v, method: 'llm', confidence: 0.7 };
      return asLlm(matchDate(normalize(v), data, opts.now));
    default:
      return asLlm(matchAnswer(question, v, data, opts));
  }
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}

// ───────────────────────── interruptions / "say that again" ─────────────────────────

// Short utterances that are not an answer: the farmer was interrupted, greeted, or asked
// Vanya to repeat. Matched only after normal matching failed, so a real answer always wins.
const REPEAT_PHRASES = [
  // English
  'what', 'sorry', 'pardon', 'repeat', 'again', 'come again', 'say again', 'hello', 'hi', 'hey', 'one more time',
  "didn't hear", 'did not hear', 'can you repeat', 'not clear', "didn't understand",
  // Hindi / Hinglish
  'kya', 'kya bola', 'kya kaha', 'phir se', 'fir se', 'dobara', 'ek baar aur', 'samajh nahi aaya', 'suna nahi', 'sunai nahi diya',
  'kaun', 'ji', 'haan ji bolo', 'क्या', 'क्या बोला', 'फिर से', 'दोबारा', 'समझ नहीं आया', 'सुनाई नहीं दिया', 'हैलो',
  // Kannada
  'enu', 'yenu', 'matte heli', 'innondu sala', 'gottagilla', 'kelistilla', 'ಏನು', 'ಏನ್', 'ಮತ್ತೆ ಹೇಳಿ', 'ಗೊತ್ತಾಗಲಿಲ್ಲ', 'ಕೇಳಿಸ್ಲಿಲ್ಲ',
  // Tamil
  'enna', 'ennanga', 'thirumba sollunga', 'puriyala', 'என்ன', 'என்னங்க', 'திரும்ப சொல்லுங்க', 'புரியல', 'கேக்கல',
  // Telugu
  'enti', 'emannaru', 'malli cheppandi', 'artham kaaledu', 'ఏంటి', 'ఏమన్నారు', 'మళ్ళీ చెప్పండి', 'అర్థం కాలేదు', 'వినపడలేదు',
  // Bengali
  'abar bolun', 'bujhlam na', 'কী', 'কি বললেন', 'আবার বলুন', 'বুঝলাম না', 'শুনতে পাইনি',
  // Gujarati
  'shu', 'fari kaho', 'samjayu nahi', 'શું', 'ફરી કહો', 'સમજાયું નહીં', 'સંભળાયું નહીં',
  // Marathi
  'kay', 'parat sanga', 'samajla nahi', 'काय', 'परत सांगा', 'पुन्हा सांगा', 'समजलं नाही', 'ऐकू आलं नाही',
  // Malayalam
  'enthu', 'onnu koode', 'manassilayilla', 'എന്ത്', 'എന്താ', 'ഒന്നുകൂടി പറയൂ', 'മനസ്സിലായില്ല', 'കേട്ടില്ല',
  // Punjabi
  'dubara dasso', 'samajh nahi aayi', 'ਕੀ', 'ਕੀ ਕਿਹਾ', 'ਦੁਬਾਰਾ ਦੱਸੋ', 'ਸਮਝ ਨਹੀਂ ਆਈ', 'ਸੁਣਿਆ ਨਹੀਂ',
  // Odia
  'kana', 'au thare kuhantu', 'bujhi parilini', 'କଣ', 'କ\'ଣ', 'ଆଉ ଥରେ କୁହନ୍ତୁ', 'ବୁଝିପାରିଲି ନାହିଁ', 'ଶୁଣିପାରିଲି ନାହିଁ',
];

/** True when the (normalised) utterance is a short "what? / say again / hello", not an answer. */
export function isRepeatRequest(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (tokens(t).length > 6) return false;
  return REPEAT_PHRASES.some((p) => containsPhrase(t, p.toLowerCase()));
}
