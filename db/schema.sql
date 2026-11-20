-- Fasal Bima Saathi: database schema (SQLite / Turso libSQL compatible)
-- The interview is data-driven: questions, options, synonyms, lexicon and rules
-- all live here. The server walks this graph deterministically; the LLM is only
-- a phrasing layer and a low-confidence fallback.

PRAGMA foreign_keys = ON;

-- ───────────────────────── Interview definition ─────────────────────────

-- One row per question in the claim-intimation flow.
CREATE TABLE IF NOT EXISTS questions (
  code            TEXT PRIMARY KEY,          -- stable id, e.g. 'cause_of_loss'
  flow            TEXT NOT NULL DEFAULT 'claim_intimation',
  seq             INTEGER NOT NULL,          -- default order inside the flow
  answer_type     TEXT NOT NULL CHECK (answer_type IN
                    ('enum','yes_no','number','area','percent','date','mobile','policy_ref','photo','free_text')),
  text_en         TEXT NOT NULL,             -- canonical wording (LLM may paraphrase)
  text_hi         TEXT NOT NULL,
  text_kn         TEXT NOT NULL,
  hint_en         TEXT,                      -- spoken on retry / low confidence
  validation_regex TEXT,                     -- applied after normalisation
  min_value       REAL,
  max_value       REAL,
  required        INTEGER NOT NULL DEFAULT 1,
  ask_if          TEXT,                      -- JSON condition on earlier answers; NULL = always ask
  max_retries     INTEGER NOT NULL DEFAULT 2 -- after this, hand over to LLM interpretation
);

-- Fixed lines the agent speaks outside the question flow (greeting, closings).
CREATE TABLE IF NOT EXISTS agent_texts (
  key             TEXT PRIMARY KEY,          -- 'greeting' | 'closing_filed' | 'closing_area_based' | ...
  text_en         TEXT NOT NULL,
  text_hi         TEXT NOT NULL,
  text_kn         TEXT NOT NULL
);

-- Colloquial wording in every supported language. One row per (kind, ref, lang):
--   kind 'question' → ref = questions.code        kind 'rule'   → ref = rules.code
--   kind 'option'   → ref = '<question>:<value>'   kind 'agent'  → ref = agent_texts.key
-- English stays in the base tables; the text_hi / text_kn columns there are legacy fallbacks.
CREATE TABLE IF NOT EXISTS translations (
  kind            TEXT NOT NULL CHECK (kind IN ('question','rule','option','agent')),
  ref             TEXT NOT NULL,
  lang            TEXT NOT NULL,
  text            TEXT NOT NULL,
  PRIMARY KEY (kind, ref, lang)
);

-- Extra synonyms per language (native script and romanised), merged with question_options.synonyms.
CREATE TABLE IF NOT EXISTS option_synonyms (
  question_code   TEXT NOT NULL,
  value           TEXT NOT NULL,
  lang            TEXT NOT NULL,
  synonyms        TEXT NOT NULL,             -- '|' separated, lowercase
  PRIMARY KEY (question_code, value, lang)
);

-- Allowed values for enum questions, with multilingual / code-mixed synonyms
-- used by the exact and fuzzy matchers.
CREATE TABLE IF NOT EXISTS question_options (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  question_code   TEXT NOT NULL REFERENCES questions(code),
  value           TEXT NOT NULL,             -- normalised value stored in answers
  label_en        TEXT NOT NULL,
  label_hi        TEXT NOT NULL,
  label_kn        TEXT NOT NULL,
  synonyms        TEXT NOT NULL,             -- '|' separated, lowercase, Latin + native scripts
  meta            TEXT,                      -- JSON, e.g. {"claim_path":"individual"}
  UNIQUE (question_code, value)
);

-- Shared vocabulary for numbers, relative dates and land units spoken in
-- Hindi / Kannada / Hinglish ("dhai" = 2.5, "parso" = -2 days, "gunta" = 1/40 acre).
CREATE TABLE IF NOT EXISTS lexicon (
  term            TEXT NOT NULL,             -- lowercase
  kind            TEXT NOT NULL CHECK (kind IN ('number','day_offset','area_unit','percent','yes','no')),
  value           REAL NOT NULL,             -- number / offset in days / acres per unit / percent
  lang            TEXT NOT NULL,             -- 'hi' | 'kn' | 'en' | 'mixed'
  PRIMARY KEY (term, kind)                   -- 'aadha' is both a number (0.5) and a percent (50)
);

-- Business rules evaluated after an answer is accepted (or when filing).
CREATE TABLE IF NOT EXISTS rules (
  code            TEXT PRIMARY KEY,
  question_code   TEXT REFERENCES questions(code),  -- NULL = evaluated at filing time
  description     TEXT NOT NULL,
  rule_type       TEXT NOT NULL CHECK (rule_type IN ('reject','warn','branch','flag')),
  condition       TEXT NOT NULL,             -- JSON condition evaluated by the rules engine
  message_en      TEXT NOT NULL,
  message_hi      TEXT NOT NULL,
  message_kn      TEXT NOT NULL
);

-- ───────────────────────── Reference data (mock insurer) ─────────────────────────

CREATE TABLE IF NOT EXISTS policies (
  policy_no         TEXT PRIMARY KEY,        -- e.g. 'PMFBY-KA-25K-000123'
  farmer_name       TEXT NOT NULL,
  mobile            TEXT NOT NULL,
  aadhaar_last4     TEXT NOT NULL,
  village           TEXT NOT NULL,
  district          TEXT NOT NULL,
  state             TEXT NOT NULL,
  season            TEXT NOT NULL,           -- 'kharif-2026' | 'rabi-2026-27'
  insurer           TEXT NOT NULL,
  bank_account_last4 TEXT NOT NULL,
  preferred_lang    TEXT NOT NULL DEFAULT 'hi'
);

-- A policy can insure several crop plots.
CREATE TABLE IF NOT EXISTS insured_crops (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  policy_no         TEXT NOT NULL REFERENCES policies(policy_no),
  crop              TEXT NOT NULL,           -- matches question_options.value for 'crop_affected'
  survey_no         TEXT NOT NULL,
  insured_area_acres REAL NOT NULL,
  sum_insured_inr   REAL NOT NULL,
  sowing_date       TEXT NOT NULL,           -- ISO date
  UNIQUE (policy_no, crop)
);

-- ───────────────────────── Runtime data ─────────────────────────

-- One session per video call (created by /api/invite-agent).
CREATE TABLE IF NOT EXISTS sessions (
  id                TEXT PRIMARY KEY,        -- uuid, injected into the agent as a template variable
  channel           TEXT NOT NULL,
  agent_id          TEXT,                    -- Agora agent id
  caller_name       TEXT,                    -- from the sign-in screen
  caller_mobile     TEXT,
  policy_no         TEXT REFERENCES policies(policy_no),
  language          TEXT NOT NULL DEFAULT 'hi',
  current_question  TEXT,                    -- question code, or NULL once the interview is over
  pending_value     TEXT,                    -- JSON {value, display, method, confidence} awaiting a "yes"
  status            TEXT NOT NULL DEFAULT 'in_progress'
                    CHECK (status IN ('in_progress','awaiting_approval','filed','area_claim','not_covered','abandoned')),
  outcome_note      TEXT,
  avatar_used       INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  ended_at          TEXT
);

-- Every tool call Vanya makes (trace for the claims console).
CREATE TABLE IF NOT EXISTS tool_calls (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id        TEXT NOT NULL REFERENCES sessions(id),
  tool              TEXT NOT NULL,
  args              TEXT NOT NULL,           -- JSON
  result            TEXT NOT NULL,           -- JSON
  duration_ms       INTEGER NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Client-side call trace: transcript turns, agent state, per-stage latency metrics, errors.
CREATE TABLE IF NOT EXISTS session_events (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id        TEXT NOT NULL REFERENCES sessions(id),
  kind              TEXT NOT NULL,           -- 'transcript' | 'metric' | 'state' | 'error' | 'call'
  payload           TEXT NOT NULL,           -- JSON
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Every attempt is logged, including failed matches: this is the audit trail
-- and shows judges how each answer was understood.
CREATE TABLE IF NOT EXISTS answers (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id        TEXT NOT NULL REFERENCES sessions(id),
  question_code     TEXT NOT NULL REFERENCES questions(code),
  raw_text          TEXT NOT NULL,           -- exactly what the user said (ASR text)
  normalized_value  TEXT,                    -- NULL when not accepted
  match_method      TEXT NOT NULL CHECK (match_method IN ('exact','synonym','regex','lexicon','fuzzy','llm','none')),
  confidence        REAL NOT NULL,           -- 0..1
  accepted          INTEGER NOT NULL,        -- 1 = stored as the answer
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS claims (
  claim_id          TEXT PRIMARY KEY,        -- e.g. 'FBS-20261121-0007'
  session_id        TEXT NOT NULL REFERENCES sessions(id),
  policy_no         TEXT NOT NULL REFERENCES policies(policy_no),
  crop              TEXT NOT NULL,
  survey_no         TEXT NOT NULL,
  cause             TEXT NOT NULL,
  claim_path        TEXT NOT NULL CHECK (claim_path IN ('individual','post_harvest','area_based')),
  loss_date         TEXT NOT NULL,
  intimated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  within_72h        INTEGER NOT NULL,
  affected_area_acres REAL NOT NULL,
  loss_percent      REAL NOT NULL,
  indicative_payout_inr REAL,                -- shown as an estimate only, never promised
  flags             TEXT,                    -- JSON array of rule codes that fired
  status            TEXT NOT NULL DEFAULT 'registered'
                    CHECK (status IN ('registered','surveyor_assigned','surveyed','approved','rejected','paid'))
);

CREATE TABLE IF NOT EXISTS evidence (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id        TEXT NOT NULL REFERENCES sessions(id),
  claim_id          TEXT REFERENCES claims(claim_id),
  image_url         TEXT,                    -- public URL the LLM fetched (served by /api/evidence/:id)
  image_data        TEXT,                    -- JPEG data URL of the snapshot
  ai_observation    TEXT,                    -- what the vision LLM saw (filled by recordEvidence)
  damage_estimate_pct REAL,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS follow_ups (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_id          TEXT NOT NULL REFERENCES claims(claim_id),
  kind              TEXT NOT NULL CHECK (kind IN ('sms_confirmation','surveyor_visit','status_update','document_reminder')),
  scheduled_for     TEXT NOT NULL,
  channel           TEXT NOT NULL DEFAULT 'sms',
  message           TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','sent','failed'))
);

-- Post-call review: rule-based disposition + metrics, refined by the LLM judge (Claude Haiku).
CREATE TABLE IF NOT EXISTS session_reviews (
  session_id        TEXT PRIMARY KEY REFERENCES sessions(id),
  disposition       TEXT NOT NULL,           -- code from lib/console/dispositions.ts
  disposition_reason TEXT NOT NULL,
  rule_disposition  TEXT NOT NULL,           -- what the deterministic classifier said
  quality_score     INTEGER,                 -- 0-100 overall (judge); NULL when only rules ran
  rule_score        INTEGER NOT NULL,        -- 0-100 from measurable signals
  scores            TEXT,                    -- JSON rubric scores (judge)
  summary           TEXT,
  issues            TEXT,                    -- JSON [{moment, problem, suggestion, severity}]
  improvements      TEXT,                    -- JSON string[]
  judge_model       TEXT,                    -- e.g. claude-haiku-5-5; NULL = rules only
  judge_error       TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Call recording (avatar + farmer camera composite with mixed audio), stored in Vercel Blob.
CREATE TABLE IF NOT EXISTS session_recordings (
  session_id        TEXT PRIMARY KEY REFERENCES sessions(id),
  url               TEXT NOT NULL,
  content_type      TEXT NOT NULL,
  size_bytes        INTEGER,
  duration_s        INTEGER,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_answers_session ON answers(session_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id);
CREATE INDEX IF NOT EXISTS idx_events_session ON session_events(session_id);
CREATE INDEX IF NOT EXISTS idx_options_question ON question_options(question_code);
CREATE INDEX IF NOT EXISTS idx_policies_mobile ON policies(mobile);
