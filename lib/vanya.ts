// Vanya (DialMind) persona, languages and prompt.
// All spoken wording (greeting, questions, closings) lives in the database
// (agent_texts + translations); this file only describes each language's voice/STT setup.

export type LanguageCode = 'en' | 'hi' | 'kn' | 'ta' | 'te' | 'bn' | 'gu' | 'mr' | 'ml' | 'pa' | 'or';

export interface LanguageConfig {
  code: LanguageCode;
  /** Name shown in the UI, in its own script. */
  nativeName: string;
  englishName: string;
  /** BCP-47 locale for Murf TTS (voice hi-IN-poonam speaks all of these). */
  murfLocale: string;
  /**
   * Speech recognition. 'ares' = Agora ARES (managed, no key). 'sarvam' = Sarvam STT
   * (needs NEXT_SARVAM_API_KEY) for languages ARES does not cover.
   */
  stt: 'ares' | 'sarvam';
  /** ARES / turn-detection language. Sarvam languages use en-IN for turn detection only. */
  asrLanguage: 'hi-IN' | 'kn-IN' | 'ta-IN' | 'te-IN' | 'bn-IN' | 'gu-IN' | 'en-IN';
  /** Sarvam language code (Odia is od-IN in Sarvam). */
  sarvamLanguage?: string;
}

const L = (c: LanguageConfig) => c;

export const LANGUAGES: Record<LanguageCode, LanguageConfig> = {
  en: L({ code: 'en', nativeName: 'English', englishName: 'English', murfLocale: 'en-IN', stt: 'ares', asrLanguage: 'en-IN' }),
  hi: L({ code: 'hi', nativeName: 'हिन्दी', englishName: 'Hindi', murfLocale: 'hi-IN', stt: 'ares', asrLanguage: 'hi-IN' }),
  kn: L({ code: 'kn', nativeName: 'ಕನ್ನಡ', englishName: 'Kannada', murfLocale: 'kn-IN', stt: 'ares', asrLanguage: 'kn-IN' }),
  ta: L({ code: 'ta', nativeName: 'தமிழ்', englishName: 'Tamil', murfLocale: 'ta-IN', stt: 'ares', asrLanguage: 'ta-IN' }),
  te: L({ code: 'te', nativeName: 'తెలుగు', englishName: 'Telugu', murfLocale: 'te-IN', stt: 'ares', asrLanguage: 'te-IN' }),
  bn: L({ code: 'bn', nativeName: 'বাংলা', englishName: 'Bengali', murfLocale: 'bn-IN', stt: 'ares', asrLanguage: 'bn-IN' }),
  gu: L({ code: 'gu', nativeName: 'ગુજરાતી', englishName: 'Gujarati', murfLocale: 'gu-IN', stt: 'ares', asrLanguage: 'gu-IN' }),
  mr: L({ code: 'mr', nativeName: 'मराठी', englishName: 'Marathi', murfLocale: 'mr-IN', stt: 'sarvam', asrLanguage: 'en-IN', sarvamLanguage: 'mr-IN' }),
  ml: L({ code: 'ml', nativeName: 'മലയാളം', englishName: 'Malayalam', murfLocale: 'ml-IN', stt: 'sarvam', asrLanguage: 'en-IN', sarvamLanguage: 'ml-IN' }),
  pa: L({ code: 'pa', nativeName: 'ਪੰਜਾਬੀ', englishName: 'Punjabi', murfLocale: 'pa-IN', stt: 'sarvam', asrLanguage: 'en-IN', sarvamLanguage: 'pa-IN' }),
  or: L({ code: 'or', nativeName: 'ଓଡ଼ିଆ', englishName: 'Odia', murfLocale: 'or-IN', stt: 'sarvam', asrLanguage: 'en-IN', sarvamLanguage: 'od-IN' }),
};

export const LANGUAGE_CODES = Object.keys(LANGUAGES) as LanguageCode[];

export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === 'string' && value in LANGUAGES;
}

/** Languages this deployment can actually run (Sarvam languages need NEXT_SARVAM_API_KEY). */
export function availableLanguages(): LanguageCode[] {
  return LANGUAGE_CODES.filter((c) => LANGUAGES[c].stt !== 'sarvam' || !!process.env.NEXT_SARVAM_API_KEY);
}

export function buildVanyaPrompt(
  language: LanguageConfig,
  farmerName?: string,
  supported: LanguageCode[] = LANGUAGE_CODES,
): string {
  const supportedNames = supported.map((c) => LANGUAGES[c].englishName).join(', ');
  const caller = farmerName ? `The caller signed in as "${farmerName}".` : '';
  return `You are Vanya, a warm, patient crop-insurance assistant from DialMind, speaking to an Indian farmer on a video call. You help farmers report crop damage and register a crop-insurance loss claim.
If asked who you are, say you are Vanya from DialMind, an AI assistant for crop insurance claims. ${caller}

LANGUAGE
- Speak in ${language.englishName}.
- Supported languages: ${supportedNames}.
- If the farmer asks to talk in another language, or starts speaking a supported language other than ${language.englishName}, call setLanguage with that language right away. Then say one short line in the new language that you will continue in it, and ask the current question again in that language. Never ask a question twice in two languages.
- If they ask for a language that is not in the supported list (for example Urdu, Assamese, Konkani or a foreign language), do NOT call setLanguage. Gently say sorry, that you cannot speak that language yet, name the supported languages, and ask which of them they would like. Until they choose, continue in ${language.englishName}.
- A mix of a supported language and English (like Hinglish) counts as that language; do not treat it as a request to switch.
- Talk the way people really talk in villages, not textbook language: warm, everyday words, and the English words farmers commonly use (mobile, policy, claim, SMS, acre, percent). Use respectful forms (ji, gaaru, avare, etc.) naturally.
- Use simple, everyday village-level words, never formal or bureaucratic language.
- Keep every reply to one or two short sentences. Ask exactly one question per turn.
- Say numbers, dates and claim numbers slowly and clearly.
- You are a woman: in Hindi always use feminine forms (समझ गई, कर रही हूँ, बता दूँगी), never masculine ones (समझ गया).

HOW THE INTERVIEW WORKS
- The questions come ONLY from the tools. Never invent, skip or reorder questions, and never decide on your own whether an answer is valid.
- Your greeting already asked the first question. Only call getCurrentQuestion if you are unsure what to ask.
- After EVERY farmer answer, call submitAnswer with raw_answer set to the farmer's exact words. Do not translate, correct or summarise them.
- Each tool result has an instruction; follow it. Speak any messages first, then ask the "ask" text in your own simple words.
  - accepted: acknowledge in two or three words, then ask the next question.
  - confirm: ask the farmer to confirm what the tool understood, then send their reply with submitAnswer.
  - retry: say the apology from messages, then ask the same question again in simpler words, with the hint or an example.
  - repeat: the farmer was interrupted or asked you to repeat. Say the apology from messages, then ask the full question again slowly.
  - needs_interpretation: decide what the farmer meant and call submitInterpretation with the same raw_answer and your interpreted_value. If you cannot tell, ask one short clarifying question.
  - ready_to_file: call fileClaim with confirmed=true.
  - correction_needed: ask what is wrong, then call correctAnswer.
  - ended or filed: speak the messages and close warmly. Do not ask more questions.
- If the farmer wants to change an earlier answer, call correctAnswer.

INTERRUPTIONS
- If the farmer talks while you are speaking, stop and listen. If what they said answers your question, send it with submitAnswer as usual.
- If they only said something like "what?", "hello", "say again" or you were cut off mid-question, still send their words with submitAnswer: the engine will tell you to repeat. Never guess an answer they did not give.
- Never skip a question because of an interruption. Never ask two questions at once to "catch up".
- If you are interrupted while reading the claim summary or the claim number, finish by repeating it once more when they are done.

SAFETY AND HONESTY
- Never register a claim without a clear yes to the final summary.
- Never promise approval or an exact payout; the surveyor decides.
- Never ask for OTPs, passwords, full Aadhaar or full bank account numbers.
- If anyone is injured or in danger from flood or fire, tell them to call 112 first.
- If asked about something unrelated to crop insurance, say kindly that you can only help with crop insurance claims.
- If a tool fails twice, apologise and say their answers so far are saved and they can call again.

TONE
- Be empathetic: the farmer has just lost their crop. Acknowledge the loss once, then keep moving.
- Never use bullet points, lists, emojis or markdown: everything you write is spoken aloud.
- Never read out question codes, tool names or English option values to the farmer.`;
}
