'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  BadgeCheck,
  Bot,
  CalendarClock,
  Check,
  Lightbulb,
  Loader2,
  RefreshCw,
  Sparkles,
  User,
  VideoOff,
  X,
} from 'lucide-react';
import type { SessionReport } from '@/lib/console/report';
import { DialMindLogo, Toran } from '../brand';
import {
  BarList,
  Card,
  DispositionBadge,
  LANGUAGE_NAMES,
  MethodChip,
  QUESTION_LABELS,
  Stat,
  formatDuration,
  formatWhen,
  pct,
} from './ui';

type Review = {
  disposition: string;
  disposition_reason: string;
  rule_disposition: string;
  quality_score: number | null;
  rule_score: number;
  scores: Record<string, number> | null;
  summary: string | null;
  issues: { moment: string; problem: string; suggestion: string; severity: string }[];
  improvements: string[];
  judge_model: string | null;
  judge_error: string | null;
  created_at: string;
};

const RUBRIC: Record<string, string> = {
  task_completion: 'Task completion',
  understanding: 'Understanding',
  language_naturalness: 'Natural language',
  empathy: 'Empathy',
  compliance: 'Compliance',
  efficiency: 'Efficiency',
};

const LATENCY_LABELS: Record<string, string> = {
  asr_ttfb: 'Speech recognition (first result)',
  llm_ttfb: 'LLM first token',
  llm_ttfs: 'LLM first sentence',
  tts_ttfb: 'Murf voice first audio',
  tool_call: 'Tool call (engine)',
};

const SEVERITY_CLS: Record<string, string> = {
  high: 'bg-[#fde4e2] text-[#a3261b]',
  medium: 'bg-[#fdf0d5] text-[#8a5a00]',
  low: 'bg-[#e8eef8] text-[#294a7a]',
};

function ScoreRing({ value, label }: { value: number | null; label: string }) {
  const v = value ?? 0;
  const color = v >= 75 ? '#1f6b45' : v >= 50 ? '#e8952a' : '#d92d20';
  return (
    <div className="flex flex-col items-center" title={`${label}: ${value ?? '–'}/100`}>
      <div
        className="grid h-20 w-20 place-items-center rounded-full"
        style={{ background: value === null ? '#f1ece2' : `conic-gradient(${color} ${v * 3.6}deg, #f1ece2 0deg)` }}
      >
        <div className="grid h-16 w-16 place-items-center rounded-full bg-white text-xl font-bold tabular-nums">
          {value ?? '–'}
        </div>
      </div>
      <p className="mt-1 text-xs text-[#6b5b3e]">{label}</p>
    </div>
  );
}

export default function SessionDetail({ id }: { id: string }) {
  const [report, setReport] = useState<SessionReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/console/sessions/${id}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(res.status === 404 ? 'Session not found' : await res.text());
      setReport(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }, [id]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const runReview = async () => {
    setReviewing(true);
    try {
      const res = await fetch(`/api/console/sessions/${id}/review`, { method: 'POST' });
      if (res.ok) setReport(await res.json());
    } finally {
      setReviewing(false);
    }
  };

  if (error) {
    return (
      <main className="grid min-h-dvh place-items-center bg-[#fbf5e9] p-6 text-center">
        <div>
          <p className="text-[#a3261b]">{error}</p>
          <Link href="/console" className="mt-3 inline-block text-sm underline">Back to console</Link>
        </div>
      </main>
    );
  }
  if (!report) {
    return (
      <main className="grid min-h-dvh place-items-center bg-[#fbf5e9]">
        <Loader2 className="h-8 w-8 animate-spin text-[#1f6b45]" />
      </main>
    );
  }

  const review = report.review as unknown as Review | null;
  const s = report.session;
  const st = report.stats;

  return (
    <main className="min-h-dvh bg-[#fbf5e9] text-[#0f2e20]">
      <Toran />
      <header className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <Link href="/console" className="rounded-full p-2 hover:bg-black/5" aria-label="Back to console">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <DialMindLogo />
          <span className="rounded-full bg-[#0f3d27] px-3 py-1 text-xs font-semibold text-[#f4c451]">Call review</span>
        </div>
        <button
          onClick={runReview}
          disabled={reviewing}
          className="flex items-center gap-2 rounded-full bg-[#1f6b45] px-4 py-2 text-sm font-semibold text-white hover:bg-[#17573a] disabled:opacity-70"
        >
          {reviewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Re-run review
        </button>
      </header>

      <div className="mx-auto max-w-7xl space-y-5 px-4 pb-12 sm:px-6">
        {/* Summary strip */}
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-xl font-bold sm:text-2xl">{report.policy?.farmer_name ?? s.caller_name ?? 'Unknown caller'}</h1>
              <p className="mt-1 text-sm text-[#6b5b3e]">
                {LANGUAGE_NAMES[s.language] ?? s.language} · {formatWhen(s.created_at)} · {formatDuration(report.durationS)}
                {report.policy && ` · ${report.policy.village}, ${report.policy.district}`}
                {s.avatar_used ? ' · video avatar' : ' · voice only'}
              </p>
              <div className="mt-3">
                <DispositionBadge code={review?.disposition ?? report.ruleDisposition.code} size="lg" />
              </div>
              <p className="mt-2 max-w-2xl text-sm text-[#2b2416]">
                {review?.disposition_reason ?? report.ruleDisposition.reason}
              </p>
              {review && review.disposition !== review.rule_disposition && (
                <p className="mt-1 text-xs text-[#8a7a5c]">
                  Rule-based classifier said: <DispositionBadge code={review.rule_disposition} />
                </p>
              )}
            </div>
            <div className="flex gap-5">
              <ScoreRing value={review?.quality_score ?? null} label="Gemini quality" />
              <ScoreRing value={report.ruleScore} label="Rule score" />
            </div>
          </div>
          <p className="mt-3 text-xs text-[#8a7a5c]">
            {review?.judge_model
              ? `Reviewed by ${review.judge_model} · ${formatWhen(review.created_at)}`
              : review?.judge_error ?? 'Not reviewed yet: reviews run automatically when a call ends.'}
          </p>
        </Card>

        <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
          {/* Recording */}
          <Card title="Call recording">
            {report.recording ? (
              <video
                src={report.recording.url}
                controls
                preload="metadata"
                className="aspect-video w-full rounded-xl bg-black"
              />
            ) : (
              <div className="grid aspect-video w-full place-items-center rounded-xl bg-[#f5ecd9] text-center text-sm text-[#8a7a5c]">
                <div>
                  <VideoOff className="mx-auto mb-2 h-8 w-8" />
                  No recording for this call
                </div>
              </div>
            )}
          </Card>

          {/* Judge rubric */}
          <Card title="Rubric (1–5)">
            {review?.scores ? (
              <ul className="space-y-3">
                {Object.entries(RUBRIC).map(([key, label]) => {
                  const v = review.scores?.[key] ?? 0;
                  return (
                    <li key={key} title={`${label}: ${v}/5`}>
                      <div className="flex justify-between text-sm">
                        <span>{label}</span>
                        <span className="font-semibold tabular-nums">{v}/5</span>
                      </div>
                      <div className="mt-1 flex gap-1">
                        {[1, 2, 3, 4, 5].map((i) => (
                          <span key={i} className={`h-2 flex-1 rounded-full ${i <= v ? 'bg-[#1f6b45]' : 'bg-[#f1ece2]'}`} />
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-[#8a7a5c]">The Gemini judge has not scored this call yet.</p>
            )}
          </Card>
        </div>

        {/* Judge findings */}
        {Boolean(review?.summary || review?.issues?.length || review?.improvements?.length) && (
          <div className="grid gap-5 lg:grid-cols-2">
            <Card title="What went wrong">
              {review?.summary && (
                <p className="mb-3 flex gap-2 text-sm">
                  <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[#e8952a]" /> {review.summary}
                </p>
              )}
              <ul className="space-y-3">
                {(review?.issues ?? []).map((i, n) => (
                  <li key={n} className="rounded-xl border border-[#f3ead6] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium text-[#6b5b3e]">{i.moment}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${SEVERITY_CLS[i.severity] ?? ''}`}>
                        {i.severity}
                      </span>
                    </div>
                    <p className="mt-1 text-sm">{i.problem}</p>
                    <p className="mt-1 text-sm text-[#1f6b45]">→ {i.suggestion}</p>
                  </li>
                ))}
                {!review?.issues?.length && <p className="text-sm text-[#8a7a5c]">No issues flagged.</p>}
              </ul>
            </Card>
            <Card title="How to improve">
              <ul className="space-y-2">
                {(review?.improvements ?? []).map((t, n) => (
                  <li key={n} className="flex gap-2 text-sm">
                    <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-[#e8952a]" /> {t}
                  </li>
                ))}
                {!review?.improvements?.length && <p className="text-sm text-[#8a7a5c]">No suggestions.</p>}
              </ul>
            </Card>
          </div>
        )}

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Questions answered" value={st.questionsAnswered} />
          <Stat label="Attempts" value={st.attempts} />
          <Stat label="Retries" value={st.failedAttempts} />
          <Stat label="LLM fallbacks" value={st.llmFallbacks} />
          <Stat label="Rule-matched" value={pct(Math.round(st.deterministicRate * 100), 100)} hint="of accepted answers" />
          <Stat label="Turns" value={`${st.farmerTurns} / ${st.agentTurns}`} hint="farmer / Vanya" />
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          {/* Claim */}
          <Card title="Claim">
            {report.claim ? (
              <div className="space-y-3 text-sm">
                <p className="flex items-center gap-2 font-mono text-lg font-bold">
                  <BadgeCheck className="h-5 w-5 text-[#1f6b45]" /> {String(report.claim.claim_id)}
                </p>
                <p>
                  {String(report.claim.crop)} · {String(report.claim.cause)} · {String(report.claim.claim_path)} ·{' '}
                  {Number(report.claim.affected_area_acres)} acres · {Number(report.claim.loss_percent)}% lost
                </p>
                <p>
                  Indicative payout:{' '}
                  <span className="font-semibold">₹{Number(report.claim.indicative_payout_inr).toLocaleString('en-IN')}</span>
                  {Number(report.claim.within_72h) === 1 ? ' · reported within 72 h' : ' · reported late'}
                </p>
                <ol className="space-y-1.5 border-l-2 border-[#f4a51c] pl-3">
                  {report.followUps.map((f) => (
                    <li key={f.kind + f.scheduled_for} className="flex items-start gap-2">
                      <CalendarClock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#e8952a]" />
                      <span>
                        <span className="font-medium">{f.scheduled_for}</span> · {f.message}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : (
              <p className="text-sm text-[#8a7a5c]">No claim was filed in this call.</p>
            )}
          </Card>

          {/* Latency */}
          <Card title="Latency (avg ms)">
            <BarList
              rows={Object.entries(report.latency).map(([key, v]) => ({
                label: LATENCY_LABELS[key] ?? key,
                value: v.avg,
                tooltip: `${LATENCY_LABELS[key] ?? key}: avg ${v.avg} ms · p90 ${v.p90} ms · max ${v.max} ms · ${v.n} samples`,
              }))}
              format={(n) => `${n} ms`}
              empty="No latency metrics captured"
            />
          </Card>
        </div>

        {/* Interview trace */}
        <Card title="Interview trace (every answer attempt)">
          <div className="-mx-4 overflow-x-auto sm:-mx-5">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b border-[#eadfc8] text-xs uppercase tracking-wide text-[#8a7a5c]">
                <tr>
                  <th className="px-4 py-2 font-medium sm:px-5">Question</th>
                  <th className="px-2 py-2 font-medium">Farmer said</th>
                  <th className="px-2 py-2 font-medium">Understood as</th>
                  <th className="px-2 py-2 font-medium">Match</th>
                  <th className="px-4 py-2 font-medium sm:px-5">OK</th>
                </tr>
              </thead>
              <tbody>
                {report.answers.map((a, n) => (
                  <tr key={n} className="border-b border-[#f3ead6] last:border-0">
                    <td className="px-4 py-2 sm:px-5">{QUESTION_LABELS[a.question_code] ?? a.question_code}</td>
                    <td className="max-w-[260px] truncate px-2 py-2" title={a.raw_text}>{a.raw_text}</td>
                    <td className="px-2 py-2 font-mono text-xs">{a.normalized_value ?? '—'}</td>
                    <td className="px-2 py-2"><MethodChip method={a.method} confidence={a.confidence} /></td>
                    <td className="px-4 py-2 sm:px-5">
                      {a.accepted ? <Check className="h-4 w-4 text-[#1f6b45]" /> : <X className="h-4 w-4 text-[#d92d20]" />}
                    </td>
                  </tr>
                ))}
                {!report.answers.length && (
                  <tr><td colSpan={5} className="px-5 py-6 text-center text-[#8a7a5c]">No answers recorded.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="grid gap-5 lg:grid-cols-2">
          {/* Transcript */}
          <Card title="Transcript">
            <div className="max-h-[480px] space-y-2 overflow-y-auto pr-1">
              {report.transcript.map((t, n) => (
                <div key={n} className={`flex gap-2 ${t.speaker === 'agent' ? '' : 'flex-row-reverse text-right'}`}>
                  <span className={`mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full ${t.speaker === 'agent' ? 'bg-[#0f3d27] text-[#f4c451]' : 'bg-[#f4a51c] text-[#2a1a05]'}`}>
                    {t.speaker === 'agent' ? <Bot className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
                  </span>
                  <p className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${t.speaker === 'agent' ? 'bg-[#f5ecd9]' : 'bg-[#e3f3e8]'}`}>
                    {t.text}
                  </p>
                </div>
              ))}
              {!report.transcript.length && <p className="text-sm text-[#8a7a5c]">No transcript captured.</p>}
            </div>
          </Card>

          {/* Tool calls + errors */}
          <Card title="Tool calls & errors">
            <ul className="max-h-[480px] space-y-1.5 overflow-y-auto pr-1 text-sm">
              {report.toolCalls.map((t, n) => (
                <li key={n} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1 hover:bg-[#fdf6e6]">
                  <span className="truncate">
                    <span className="font-mono text-xs text-[#294a7a]">{t.tool}</span>{' '}
                    <span className="text-[#6b5b3e]">→ {String(t.result.result ?? '')}</span>
                    {t.result.rule ? <span className="ml-1 text-xs text-[#8a5a00]">({String(t.result.rule)})</span> : null}
                  </span>
                  <span className="shrink-0 tabular-nums text-xs text-[#8a7a5c]">{t.duration_ms} ms</span>
                </li>
              ))}
              {report.errors.map((e, n) => (
                <li key={`e${n}`} className="rounded-lg bg-[#fde4e2] px-2 py-1 text-xs text-[#a3261b]">{e.message}</li>
              ))}
              {!report.toolCalls.length && !report.errors.length && (
                <p className="text-sm text-[#8a7a5c]">No tool calls or errors.</p>
              )}
            </ul>
          </Card>
        </div>
      </div>
    </main>
  );
}
