// Text utilities for deterministic answer matching: normalisation, spoken digits and
// numbers in Hindi / Kannada / English (Latin and native scripts), and fuzzy similarity.

const DEVANAGARI_ZERO = 0x0966;
const KANNADA_ZERO = 0x0ce6;

const FILLERS = new Set([
  'umm', 'um', 'uh', 'hmm', 'hm', 'matlab', 'yaani', 'andre', 'aa', 'ah', 'so', 'actually',
  'basically', 'like', 'please', 'madam', 'maam', 'sir', 'वो', 'मतलब', 'ಅಂದ್ರೆ',
]);

/** Lowercase, native digits → ASCII, punctuation → space, fillers removed. */
export function normalize(input: string): string {
  let s = (input ?? '').normalize('NFKC').toLowerCase();
  s = s.replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - DEVANAGARI_ZERO));
  s = s.replace(/[೦-೯]/g, (d) => String(d.charCodeAt(0) - KANNADA_ZERO));
  // Keep letters (any script, incl. combining marks), digits, %, /, ., - and spaces.
  s = s.replace(/[^\p{L}\p{M}\p{N}%/.\-\s]/gu, ' ');
  s = s.replace(/(?<!\d)[.\-/](?!\d)/g, ' ');
  return s
    .split(/\s+/)
    .filter((t) => t && !FILLERS.has(t))
    .join(' ');
}

export function tokens(normalized: string): string[] {
  return normalized.split(' ').filter(Boolean);
}

/** True when `phrase` appears in `text` as whole words. */
export function containsPhrase(text: string, phrase: string): boolean {
  if (!phrase) return false;
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\s)${escaped}(?=\\s|$)`, 'u').test(text);
}

// Single spoken digits, for phone and policy numbers said digit by digit.
const DIGIT_WORDS: Record<string, string> = {
  zero: '0', oh: '0', shunya: '0', sunya: '0', sifar: '0', sonne: '0', soonya: '0', 'शून्य': '0', 'ಸೊನ್ನೆ': '0',
  one: '1', ek: '1', ondu: '1', 'एक': '1', 'ಒಂದು': '1',
  two: '2', do: '2', eradu: '2', 'दो': '2', 'ಎರಡು': '2',
  three: '3', teen: '3', tin: '3', mooru: '3', muru: '3', 'तीन': '3', 'ಮೂರು': '3',
  four: '4', char: '4', chaar: '4', naalku: '4', nalku: '4', 'चार': '4', 'ನಾಲ್ಕು': '4',
  five: '5', paanch: '5', panch: '5', aidu: '5', 'पांच': '5', 'पाँच': '5', 'ಐದು': '5',
  six: '6', chhe: '6', che: '6', chah: '6', chhah: '6', aaru: '6', 'छह': '6', 'छः': '6', 'ಆರು': '6',
  seven: '7', saat: '7', elu: '7', yelu: '7', 'सात': '7', 'ಏಳು': '7',
  eight: '8', aath: '8', aat: '8', entu: '8', yentu: '8', 'आठ': '8', 'ಎಂಟು': '8',
  nine: '9', nau: '9', ombattu: '9', 'नौ': '9', 'ಒಂಬತ್ತು': '9',
};

/** Collects digits from a spoken number ("nau zero zero …", "double nine", "98450 12345"). */
export function extractDigits(normalized: string): string {
  const out: string[] = [];
  let repeat = 1;
  for (const tok of tokens(normalized)) {
    if (tok === 'double' || tok === 'dabal') {
      repeat = 2;
      continue;
    }
    if (tok === 'triple' || tok === 'tripal') {
      repeat = 3;
      continue;
    }
    const digits = /^\d+$/.test(tok) ? tok : DIGIT_WORDS[tok];
    if (digits) {
      out.push(digits.length === 1 ? digits.repeat(repeat) : digits);
    }
    repeat = 1;
  }
  return out.join('');
}

// Fractions and modifiers common in Indian speech: "dhai" = 2.5, "saade teen" = 3.5.
const FRACTION_WORDS: Record<string, number> = {
  aadha: 0.5, adha: 0.5, half: 0.5, ardha: 0.5, 'आधा': 0.5, 'ಅರ್ಧ': 0.5,
  dedh: 1.5, derh: 1.5, 'डेढ़': 1.5, ondoovare: 1.5,
  dhai: 2.5, dhaai: 2.5, dhaee: 2.5, 'ढाई': 2.5, eraduvare: 2.5,
  pauna: 0.75, quarter: 0.25, kaal: 0.25,
};
const MODIFIERS: Record<string, number> = { saade: 0.5, sadhe: 0.5, 'साढ़े': 0.5, sava: 0.25, 'सवा': 0.25 };
const NEG_MODIFIERS: Record<string, number> = { paune: -0.25, 'पौने': -0.25 };

/**
 * First number in the text. Handles digits ("2.5"), number words via `numberWords`
 * (lexicon), fractions ("dhai") and modifiers ("saade teen" → 3.5).
 */
export function parseNumber(normalized: string, numberWords: Map<string, number>): number | null {
  const toks = tokens(normalized);
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];
    if (/^\d+(\.\d+)?$/.test(tok)) return parseFloat(tok);
    const pct = tok.match(/^(\d+(?:\.\d+)?)%$/);
    if (pct) return parseFloat(pct[1]);
    if (tok in FRACTION_WORDS) return FRACTION_WORDS[tok];
    if (tok in MODIFIERS || tok in NEG_MODIFIERS) {
      const nextTok = toks[i + 1];
      const base = nextTok
        ? /^\d+$/.test(nextTok)
          ? parseInt(nextTok, 10)
          : numberWords.get(nextTok)
        : undefined;
      if (base !== undefined) return base + (MODIFIERS[tok] ?? NEG_MODIFIERS[tok]);
      continue;
    }
    const word = numberWords.get(tok);
    if (word !== undefined) {
      // "do sau" = 200, "paanch hazaar" = 5000
      const next = toks[i + 1];
      if (next === 'sau' || next === 'nooru' || next === 'hundred') return word * 100;
      return word;
    }
  }
  return null;
}

/** Jaro-Winkler similarity in [0, 1]. */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const window = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatch = new Array<boolean>(a.length).fill(false);
  const bMatch = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - window);
    const hi = Math.min(i + window + 1, b.length);
    for (let j = lo; j < hi; j++) {
      if (bMatch[j] || a[i] !== b[j]) continue;
      aMatch[i] = bMatch[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let t = 0;
  let k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatch[i]) continue;
    while (!bMatch[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Best fuzzy score of `phrase` against every n-gram (same word count) of `text`. */
export function bestNgramSimilarity(text: string, phrase: string): number {
  const t = tokens(text);
  const n = tokens(phrase).length || 1;
  let best = 0;
  for (let i = 0; i + n <= t.length; i++) {
    const gram = t.slice(i, i + n).join(' ');
    best = Math.max(best, jaroWinkler(gram, phrase));
  }
  return best;
}
