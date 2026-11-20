# Fasal Bima Saathi: Design

A multilingual **video agent** that lets a farmer report crop damage and register a
crop-insurance (PMFBY-style) loss claim by talking in Hindi, Kannada, Hinglish or English.
The interview is **database-driven and deterministic**; the LLM phrases questions and is
the fallback only when deterministic matching is unsure.

Track: 5 — Voice AI for Bharat: Speak Your Language.

---

## 1. Problem

- Under PMFBY, localised losses (hailstorm, flood/inundation, landslide, cloudburst, natural fire)
  and post-harvest losses (unseasonal rain or cyclone while the cut crop is drying, up to 14 days
  after harvest) must be reported within **72 hours**, with crop, survey number, area, date and cause.
- At harvest time the insurer helpline, bank branches and field staff are overloaded; many farmers
  are not comfortable with English apps or forms; middlemen charge to file claims.
- Claims are delayed or rejected because information is late, incomplete or inconsistent.

**Fasal Bima Saathi** collects a complete, validated claim in the farmer's own language in a few
minutes, checks the PMFBY rules on the spot, captures photo evidence through the camera,
registers the claim, and schedules follow-ups.

> Demo data only: policies, insurer and claim IDs are fictional. Rules are a simplified model of
> PMFBY operational guidelines.

---

## 2. Architecture

```
┌──────────── Browser (Next.js) ────────────┐        ┌──────── Agora Conversational AI (cloud) ────────┐
│ Language picker → Start call              │  RTC   │ ASR: ARES (hi-IN / kn-IN / en-IN, managed)      │
│ Avatar video ◄────────────────────────────┼────────┤ LLM: gpt-4o-mini (managed, text + image input)  │
│ Mic + camera  ────────────────────────────┼───────►│ TTS: Murf Falcon 2.1, voice hi-IN-poonam (BYOK)  │
│ Live claim form (fills as answers land)   │  RTM   │ Avatar vendor (TBD) → lip-synced video           │
│ "Show crop" → snapshot → image message ───┼───────►│                                                  │
└───────────────────────────────────────────┘        │ llm.tools ──HTTPS──┐                             │
                                                      └────────────────────┼─────────────────────────────┘
                                                                           ▼
                              ┌────────── Next.js API on Vercel (/api/tools/*) ──────────┐
                              │ Interview engine: flow → normalise → match → rules       │
                              │ Claim filing, payout estimate, follow-up scheduling      │
                              └───────────────────────────┬──────────────────────────────┘
                                                          ▼
                                     Turso (libSQL) in prod · local SQLite file in dev
                                     questions · options · lexicon · rules · policies
                                     sessions · answers · claims · evidence · follow_ups
```

- **Same code, two databases:** `DATABASE_URL=file:local.db` locally, `libsql://…turso.io` + token on Vercel.
- **Tools must be public HTTPS** (Agora's cloud calls them). Vercel gives us that; for local testing
  we use a Cloudflare tunnel.
- **Language** is chosen on the start screen (Hindi / ಕನ್ನಡ / English). It sets the ASR language,
  the Murf locale and the session language in one go. This works around the SDK accepting a single
  ASR language per session.

---

## 3. Interview flow (stored in `questions`)

```
policy_ref ─► confirm_identity ─(no)─► policy_ref
                    │yes
                    ▼
             crop_affected ─► cause_of_loss ─┬─(drought / pest)─► END_AREA_BASED (complaint logged, SMS later)
                                             │
                                             ▼
                                        crop_stage ─► loss_date ─┬─(>72h)─► late_reason ─┐
                                                                 └────────────────────────┤
                                     (harvested_drying) harvest_date ◄────────────────────┤
                                                                                          ▼
                                       affected_area ─► loss_percent ─► evidence_photo ─► confirm_sms
                                                                                          ▼
                                                                   final_confirmation (spoken summary)
                                                                                          │ yes
                                                                                          ▼
                                                              file_claim ─► claim ID + follow-ups
```

| # | code | type | Validated by |
|---|---|---|---|
| 1 | `policy_ref` | mobile / policy no. | regex `^[6-9]\d{9}$` or `PMFBY-XX-26K-000000`, then DB lookup |
| 2 | `confirm_identity` | yes / no | lexicon (haan, howdu, nahi, illa…) |
| 3 | `crop_affected` | enum | synonyms + fuzzy; must be on the policy |
| 4 | `cause_of_loss` | enum | synonyms + fuzzy; decides the claim path |
| 5 | `crop_stage` | enum | standing vs harvested-and-drying |
| 6 | `loss_date` | date | lexicon (kal, parso, ninne…) + date parsing; not future, not before sowing |
| 6b | `late_reason` | free text | only when the 72-hour rule fires |
| 7 | `harvest_date` | date | only for harvested crop; loss must be ≤ 14 days after harvest |
| 8 | `affected_area` | area | number + unit (acre, gunta, hectare, bigha) → acres; ≤ insured area |
| 9 | `loss_percent` | percent | number or words (aadha, pura, ardha) |
| 10 | `evidence_photo` | photo | vision LLM observation via `record_evidence`; optional |
| 11 | `confirm_sms` | yes / no | lexicon |
| 12 | `final_confirmation` | yes / no | explicit approval before filing |

Questions have `text_en`, `text_hi`, `text_kn` and placeholders (`{farmer_name}`, `{insured_crops}`…)
filled by the server. `ask_if` holds a JSON condition so branching lives in data, not code.

---

## 4. Answer matching pipeline (deterministic first, LLM last)

For every user answer the server runs, in order, and stops at the first confident match:

| Step | What it does | Confidence |
|---|---|---|
| 1. Normalise | lowercase, trim fillers ("umm", "matlab", "andre"), Devanagari/Kannada digits → 0-9, spoken digits → digits ("nau aath…" → "98…") | — |
| 2. Exact / synonym | match against `question_options.synonyms` (Latin + native scripts) | 1.00 |
| 3. Regex | `questions.validation_regex` (mobile, policy number) | 0.95 |
| 4. Lexicon | numbers ("dhai" = 2.5), day offsets ("parso" = −2), units ("gunta" = 0.025 acre), yes/no | 0.90 |
| 5. Fuzzy | token-level Jaro-Winkler against synonyms (handles ASR errors: "olavrusti", "togri") | ≥ 0.88 accept · 0.75–0.88 confirm · < 0.75 retry |
| 6. LLM fallback | after `max_retries`, the server returns `needs_interpretation` with the allowed values; the LLM proposes `interpreted_value`, and the server **re-validates it** against the allowed values and rules | 0.70, logged as `llm` |

- Every attempt (accepted or not) is written to `answers` with method + confidence → an audit trail
  and a great "how it understood you" panel in the UI.
- The LLM can never write a value the rules engine has not validated.

---

## 5. Rules engine (stored in `rules`)

Rules run after an answer is matched (or at filing time when `question_code` is NULL).
`rule_type`: `reject` (re-ask with message), `warn` (accept, speak message, may unlock a follow-up
question), `branch` (jump via `goto`), `flag` (accept, attach to claim).

Condition DSL (JSON): `eq`, `in`, `not_in`, `gt`, `lt`, `days_since_gt`, `days_between_gt`,
`missing`, `flag_set`, plus lookups `policy_found`, `crop_on_policy`, `area_exceeds_insured`,
`before_sowing`. Any condition supports `"negate": true`.

| Rule | Type | Meaning |
|---|---|---|
| R_POLICY_NOT_FOUND | reject | no matching policy |
| R_IDENTITY_DENIED | branch | "not me" → ask for another number |
| R_CROP_NOT_INSURED | reject | crop not on this policy |
| R_AREA_BASED_CAUSE | branch | drought / pests → area assessment, no individual claim |
| R_WILD_ANIMAL_ADDON | flag | add-on cover, depends on state |
| R_FUTURE_DATE / R_BEFORE_SOWING | reject | impossible dates |
| R_LATE_INTIMATION | warn | > 72 h → ask `late_reason`, flag claim |
| R_POST_HARVEST_WINDOW | reject | > 14 days after harvest → not covered |
| R_AREA_EXCEEDS | reject | damaged area > insured plot |
| R_HIGH_LOSS_PRIORITY | flag | ≥ 75 % loss → priority surveyor |
| R_NO_EVIDENCE | flag | no photo → surveyor takes photos |

**Indicative payout** (shown as an estimate, never promised):
`sum_insured × (affected_area / insured_area) × loss_percent / 100`.

---

## 6. Agent tools (`llm.tools`, HTTPS, sync)

All tools are `POST https://<host>/api/tools/<name>`. The session ID and a shared secret are injected
with Agora `template_variables`, so the LLM never handles them:
headers `{"X-Session-Id": "{{template_variables.session_id}}", "X-Tool-Secret": "{{template_variables.tool_secret}}"}`.
`advanced_features.enable_tools = true` is required.

| Tool | Args (all required) | Returns |
|---|---|---|
| `getCurrentQuestion` | — | `{ask, question_code, options, progress}` in the session language |
| `submitAnswer` | `raw_answer` (verbatim) | `{result, understood, method, confidence, messages[], ask}`; result is accepted · confirm · retry · needs_interpretation · ready_to_file · correction_needed · ended |
| `submitInterpretation` | `raw_answer`, `interpreted_value` | Same as submitAnswer; only after `needs_interpretation`. The engine re-validates the value |
| `correctAnswer` | `question_code`, `raw_answer` | Re-runs matching + rules for an earlier answer |
| `setLanguage` | `language` (hi · kn · en) | Next question in the new language |
| `recordEvidence` | `observation`, `damage_estimate_pct` | Stores what the vision model saw in the crop snapshot |
| `fileClaim` | `confirmed`, `farmer_words` | Records the spoken approval through `final_confirmation` if needed, then `{claim_id, indicative_payout_inr, surveyor_visit_by, flags, messages}` |
| `getClaimStatus` | `claim_id_or_mobile` | Status of an existing claim |

Every tool argument is **required**: Agora cannot render a body placeholder for an optional
argument the LLM omits, and such calls never reach the server (found in live testing).

Tool names follow Agora's `^[a-zA-Z][a-zA-Z0-9]{0,63}$` rule (no underscores).

**Follow-ups created by `fileClaim`** (`follow_ups` table, shown on screen): SMS confirmation now,
surveyor visit within 2 days, status update after 7 days, and a document reminder (bank passbook)
if needed. SMS delivery is simulated in the demo.

---

## 7. Agent system prompt

```text
You are Vanya, a warm, patient crop-insurance assistant from DialMind, speaking to Indian farmers on a
video call. You help farmers report crop damage and register a crop-insurance loss claim.
If asked who you are, say you are Vanya from DialMind, an AI assistant for crop insurance claims.

LANGUAGE
- Speak in the session language: {{template_variables.language_name}}. If the farmer switches
  language (Hindi, Kannada, English or a mix like Hinglish), reply in the language they used and call
  setLanguage. Use simple village-level words, not formal or bureaucratic language.
- Keep every reply to one or two short sentences. Ask exactly one question per turn.
- Say numbers, dates and claim IDs slowly and clearly.

HOW THE INTERVIEW WORKS
- The questions come ONLY from the tools. Never invent, skip or reorder questions.
- At the start (right after your greeting), call getCurrentQuestion and ask it.
- After every farmer answer, call submitAnswer with raw_answer set to the farmer's exact words.
  Do not translate, correct or summarise them.
- Follow the tool result:
  - accepted: briefly acknowledge (e.g. "theek hai"), speak any messages, then ask next_question.
  - confirm: ask the farmer to confirm the value the tool suggests.
  - retry: speak the message or hint and ask the same question again in simpler words.
  - needs_interpretation: decide which allowed option best matches what the farmer meant, then call
    submitAnswer again with the same raw_answer and your interpreted_value. If you cannot tell, ask a
    short clarifying question.
  - branch / ended: speak the messages and follow next_question, or close politely.
- If the farmer wants to change an earlier answer, call correctAnswer.
- When the camera image of the crop arrives, describe what you see in one sentence, then call
  recordEvidence with your honest observation and estimated damage. Never exaggerate damage.

SAFETY AND HONESTY
- Never register a claim without a clear "yes" to the final confirmation. Then call fileClaim.
- Never promise approval or an exact payout; the payout is only an estimate until the surveyor visits.
- Never ask for OTPs, passwords, full Aadhaar or full bank account numbers.
- If anyone is injured or in danger from flood or fire, tell them to call 112 first.
- If asked about something unrelated to crop insurance, say kindly that you can only help with crop
  insurance claims.
- If a tool fails, apologise briefly and try once more; if it fails again, tell the farmer to call the
  Kisan helpline and that their answers so far are saved.

TONE
- Be empathetic: the farmer has just lost their crop. Acknowledge the loss once, then keep moving.
```

**Greeting** (stored in `agent_texts.greeting`, spoken in the language picked on the start screen):
- en: "Hello, I am Vanya from DialMind. I am sorry to hear about your crop damage. I will ask you a few
  questions to register your crop insurance claim."
- hi: "नमस्ते, मैं DialMind से वान्या बोल रही हूँ। आपकी फसल के नुकसान के बारे में सुनकर दुख हुआ। आपका फसल
  बीमा क्लेम दर्ज करने के लिए मैं आपसे कुछ सवाल पूछूँगी।"
- kn: "ನಮಸ್ಕಾರ, ನಾನು DialMind ನಿಂದ ವನ್ಯಾ. ನಿಮ್ಮ ಬೆಳೆ ಹಾನಿಯ ಬಗ್ಗೆ ಕೇಳಿ ಬೇಸರವಾಯಿತು. ನಿಮ್ಮ ಬೆಳೆ ವಿಮೆ ಕ್ಲೈಮ್
  ದಾಖಲಿಸಲು ನಾನು ಕೆಲವು ಪ್ರಶ್ನೆಗಳನ್ನು ಕೇಳುತ್ತೇನೆ."

Closing lines are also in `agent_texts`: `closing_filed` (reads out the claim ID and surveyor date),
`closing_area_based` (drought or pests) and `closing_not_covered` (e.g. outside the 14-day window).
The tool results tell Vanya which closing to use.

---

## 8. Screen layout

```
┌───────────────────────────────┬──────────────────────────────────┐
│                               │  CLAIM  PMFBY-KA-26K-000123       │
│        Avatar video           │  ✓ Farmer   Ramesh Gowda          │
│                               │  ✓ Crop     Paddy  (synonym 1.00) │
│                               │  ✓ Cause    Unseasonal rain       │
│   [ your camera preview ]     │             (fuzzy 0.91)          │
│                               │  ✓ Date     19 Nov (lexicon)      │
│  🎤 Mute   📷 Show crop   ⏹ End │  … Area     —                     │
│                               │  ⚠ Flags: priority surveyor        │
├───────────────────────────────┴──────────────────────────────────┤
│ Transcript (code-mixed text as heard)                             │
└───────────────────────────────────────────────────────────────────┘
```
After filing: a claim card (claim ID, indicative payout, surveyor date, follow-up timeline).

---

## 9. Demo script (≈ 3 minutes)

1. Pick **ಕನ್ನಡ** or **Hindi**, start the call. Vanya (the avatar) introduces herself as Vanya from DialMind.
2. "Mera number nau zero zero zero zero zero zero one zero one" → spoken digits → regex → policy found.
3. "Haan ji" → identity confirmed. "Dhaan ka nuksaan hua" → paddy (synonym).
4. "Bahut tez baarish, kati hui fasal bheeg gayi" → unseasonal rain; stage = harvested_drying.
5. "Parso" → loss date (lexicon); harvest "paanch din pehle" → within the 14-day window.
6. "Dhai acre" → 2.5 acres (≤ insured 2.5). "Pura khatam" → 100 % → priority flag.
7. Tap **Show crop** → the agent describes the soaked, discoloured paddy → evidence stored.
8. Summary → "haan, darj kar do" → claim ID read out slowly, follow-ups appear on screen.
9. Bonus: say "sookha pada" for a drought case to show the area-based branch.

---

## 10. Build order

1. DB layer (`lib/db.ts`, setup script) and the seed in this folder.
2. Interview engine (`lib/engine/`): normalise, matchers, rules, flow. Unit-testable without Agora.
3. Tool routes (`app/api/tools/[tool]/route.ts`) with the shared-secret check.
4. Agent config: prompt, greeting, tools, template variables, language picker → ASR + Murf locale.
5. UI: live claim form, claim card, follow-up timeline.
6. Camera snapshot → image message → `recordEvidence`.
7. Avatar vendor.
8. Deploy: Turso + Vercel; README and demo video.

## 11. Open decisions

- Avatar vendor and key (Anam recommended; LiveAvatar, Tavus or Akool also work with Murf at 24 kHz/16 kHz).
- Native-speaker review of the Hindi and Kannada question text.
- Real SMS (e.g. a test SMS provider) vs simulated.
- Rename the project folder and repo from `arogya-saathi` to `fasal-bima-saathi`.
