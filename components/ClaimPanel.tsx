'use client';

import { BadgeCheck, CalendarClock, FileText, Flag, IndianRupee, MapPin, Sprout } from 'lucide-react';
import { hasKey, type Translate } from '@/lib/i18n';
import type { LanguageCode } from '@/types/conversation';

export interface SessionState {
  sessionId: string;
  status: 'in_progress' | 'awaiting_approval' | 'filed' | 'area_claim' | 'not_covered' | 'abandoned';
  language: LanguageCode;
  progress: string;
  currentQuestion: string | null;
  policy: { policy_no: string; farmer_name: string; village: string; district: string } | null;
  fields: { code: string; value: string; method: string; confidence: number }[];
  flags: string[];
  claim: {
    claim_id: string;
    claim_path: string;
    indicative_payout_inr: number;
    within_72h: boolean;
    flags: string[];
  } | null;
  followUps: { kind: string; scheduled_for: string; message: string; status: string }[];
}

// How each answer was understood: deterministic methods in calm colours, LLM fallback highlighted.
const METHOD_STYLE: Record<string, string> = {
  exact: 'bg-emerald-400/15 text-emerald-300',
  synonym: 'bg-emerald-400/15 text-emerald-300',
  regex: 'bg-sky-400/15 text-sky-300',
  lexicon: 'bg-teal-400/15 text-teal-300',
  fuzzy: 'bg-amber-400/15 text-amber-300',
  llm: 'bg-fuchsia-400/15 text-fuchsia-300',
};

function label(t: Translate, key: string, fallback: string) {
  return hasKey(key) ? t(key) : fallback;
}

function formatDay(iso: string, lang: LanguageCode) {
  const locale = `${lang}-IN`;
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${iso}T00:00:00Z`),
  );
}

export function ClaimPanel({ state, t, lang }: { state: SessionState | null; t: Translate; lang: LanguageCode }) {
  if (!state) {
    return (
      <p className="m-auto max-w-[16rem] px-4 text-center text-sm text-white/50">{t('claimEmpty')}</p>
    );
  }
  const [done, total] = state.progress.split('/').map(Number);
  const pct = total ? Math.round((done / total) * 100) : 0;
  const flags = state.claim?.flags ?? state.flags;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
      {/* Filed claim card */}
      {state.claim && (
        <section className="animate-fade-up rounded-2xl border border-[#f4a51c]/40 bg-gradient-to-br from-[#1f6b45] to-[#14472f] p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-[#f4c451]">
            <BadgeCheck className="h-5 w-5" /> {t('claimRegistered')}
          </p>
          <p className="mt-2 text-xs uppercase tracking-wider text-white/60">{t('claimNumber')}</p>
          <p className="font-mono text-2xl font-bold tracking-wider">{state.claim.claim_id}</p>
          <div className="mt-3 flex items-end justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wider text-white/60">{t('estimatedPayout')}</p>
              <p className="flex items-center text-xl font-semibold">
                <IndianRupee className="h-5 w-5" />
                {state.claim.indicative_payout_inr.toLocaleString('en-IN')}
              </p>
            </div>
            <p className="max-w-[9rem] text-right text-[11px] leading-4 text-white/60">{t('payoutNote')}</p>
          </div>
        </section>
      )}

      {(state.status === 'area_claim' || state.status === 'not_covered') && (
        <section className="rounded-2xl border border-[#f4a51c]/40 bg-[#f4a51c]/10 p-4 text-sm">
          <p className="font-semibold text-[#f4c451]">
            {t(state.status === 'area_claim' ? 'outcome_area_claim' : 'outcome_not_covered')}
          </p>
        </section>
      )}

      {/* Progress */}
      {!state.claim && (
        <div>
          <div className="flex items-center justify-between text-xs text-white/60">
            <span>{t('progressLabel', { done, total })}</span>
            <span>{pct}%</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#f4a51c] to-[#e8772e] transition-all duration-700"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      {/* Policy */}
      {state.policy && (
        <section className="rounded-2xl bg-white/5 p-3">
          <p className="flex items-center gap-2 font-semibold">
            <FileText className="h-4 w-4 text-[#f4c451]" /> {state.policy.farmer_name}
          </p>
          <p className="mt-1 font-mono text-xs text-white/70">{state.policy.policy_no}</p>
          <p className="mt-0.5 flex items-center gap-1 text-xs text-white/60">
            <MapPin className="h-3 w-3" /> {state.policy.village}, {state.policy.district}
          </p>
        </section>
      )}

      {/* Answers */}
      {state.fields.filter((f) => f.code !== 'policy_ref').length > 0 && (
        <ul className="space-y-2">
          {state.fields
            .filter((f) => f.code !== 'policy_ref')
            .map((f) => (
              <li key={f.code} className="animate-fade-up rounded-xl bg-white/5 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-white/55">{label(t, `f_${f.code}`, f.code)}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 font-mono text-[10px] ${METHOD_STYLE[f.method] ?? 'bg-white/10 text-white/60'}`}
                    title="How Vanya's engine understood this answer"
                  >
                    {f.method} · {f.confidence.toFixed(2)}
                  </span>
                </div>
                <p className="mt-0.5 font-medium">{f.value}</p>
              </li>
            ))}
        </ul>
      )}

      {/* Flags */}
      {flags.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {flags.map((code) => (
            <span
              key={code}
              className="flex items-center gap-1 rounded-full bg-[#e8772e]/20 px-2.5 py-1 text-xs text-[#ffb98a]"
            >
              <Flag className="h-3 w-3" /> {label(t, `flag_${code}`, code)}
            </span>
          ))}
        </div>
      )}

      {/* Follow-ups */}
      {state.followUps.length > 0 && (
        <section>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/60">{t('followUps')}</p>
          <ol className="relative space-y-3 border-l border-[#f4a51c]/40 pl-4">
            {state.followUps.map((f) => (
              <li key={f.kind + f.scheduled_for} className="relative">
                <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-[#f4a51c]" />
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  {f.kind === 'surveyor_visit' ? (
                    <Sprout className="h-3.5 w-3.5 text-[#f4c451]" />
                  ) : (
                    <CalendarClock className="h-3.5 w-3.5 text-[#f4c451]" />
                  )}
                  {label(t, `fu_${f.kind}`, f.kind)}
                  <span className="text-xs font-normal text-white/50">· {formatDay(f.scheduled_for, lang)}</span>
                  {f.status === 'sent' && (
                    <span className="rounded-full bg-[#25d366]/20 px-1.5 py-0.5 text-[10px] font-semibold text-[#7ff0a8]">
                      ✓ WhatsApp
                    </span>
                  )}
                </p>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
