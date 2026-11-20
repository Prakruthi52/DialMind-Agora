'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronRight, FileText, RefreshCw, Search, Video } from 'lucide-react';
import { DISPOSITION_CODES, dispositionLabel } from '@/lib/console/dispositions';
import { DialMindLogo, Toran } from '../brand';
import {
  BarList,
  Card,
  DispositionBadge,
  LANGUAGE_NAMES,
  QUESTION_LABELS,
  Stat,
  formatDuration,
  formatWhen,
  pct,
} from './ui';

type Row = {
  id: string;
  caller_name: string | null;
  caller_mobile: string | null;
  language: string;
  status: string;
  created_at: string;
  ended_at: string | null;
  disposition: string | null;
  quality_score: number | null;
  rule_score: number | null;
  claim_id: string | null;
  recording_url: string | null;
  answered: number;
  failed_attempts: number;
  llm_fallbacks: number;
};

type ConsoleData = {
  sessions: Row[];
  kpis: {
    calls: number;
    completed: number;
    filed: number;
    avgDurationS: number | null;
    answersAccepted: number;
    answersFailed: number;
    llmFallbacks: number;
    fuzzyMatches: number;
    avgToolMs: number | null;
    avgQuality: number | null;
    avgRuleScore: number | null;
  };
  retryHotspots: { question_code: string; failures: number }[];
  dispositions: { disposition: string; n: number }[];
  languages: { language: string; n: number }[];
};

export default function ConsoleList() {
  const [data, setData] = useState<ConsoleData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [disposition, setDisposition] = useState('all');
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/api/console/sessions', { cache: 'no-store' });
      if (!res.ok) throw new Error(await res.text());
      setData(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, []);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.sessions ?? []).filter(
      (r) =>
        (disposition === 'all' || r.disposition === disposition) &&
        (!q ||
          [r.caller_name, r.caller_mobile, r.claim_id, r.id, LANGUAGE_NAMES[r.language]]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(q))),
    );
  }, [data, query, disposition]);

  const k = data?.kpis;
  const totalAttempts = (k?.answersAccepted ?? 0) + (k?.answersFailed ?? 0);

  return (
    <main className="min-h-dvh bg-[#fbf5e9] text-[#0f2e20]">
      <Toran />
      <header className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
        <div className="flex items-center gap-3">
          <DialMindLogo />
          <span className="rounded-full bg-[#0f3d27] px-3 py-1 text-xs font-semibold text-[#f4c451]">Claims Console</span>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-2 rounded-full border border-[#eadfc8] bg-white px-3 py-1.5 text-sm hover:bg-[#fdf6e6]"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </header>

      <div className="mx-auto max-w-7xl space-y-5 px-4 pb-12 sm:px-6">
        {error && <p className="rounded-xl bg-[#fde4e2] px-4 py-3 text-sm text-[#a3261b]">{error}</p>}

        {/* KPIs */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
          <Stat label="Calls" value={k?.calls ?? '–'} />
          <Stat label="Completed" value={k ? pct(k.completed, k.calls) : '–'} hint={k ? `${k.completed} of ${k.calls}` : undefined} />
          <Stat label="Claims filed" value={k?.filed ?? '–'} />
          <Stat label="Avg call time" value={formatDuration(k?.avgDurationS)} />
          <Stat
            label="Understood 1st try"
            value={k ? pct(k.answersAccepted, totalAttempts) : '–'}
            hint={k ? `${k.answersFailed} retries` : undefined}
          />
          <Stat label="LLM fallback" value={k ? pct(k.llmFallbacks, k.answersAccepted) : '–'} hint="of accepted answers" />
          <Stat label="Avg tool call" value={k?.avgToolMs ? `${k.avgToolMs} ms` : '–'} />
          <Stat
            label="Quality score"
            value={k?.avgQuality ?? k?.avgRuleScore ?? '–'}
            hint={k?.avgQuality ? 'Gemini judge avg' : 'rule-based avg'}
          />
        </div>

        {/* Distributions */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Dispositions">
            <BarList rows={(data?.dispositions ?? []).map((d) => ({ label: dispositionLabel(d.disposition), value: d.n }))} />
          </Card>
          <Card title="Where farmers get stuck">
            <BarList
              rows={(data?.retryHotspots ?? []).map((r) => ({
                label: QUESTION_LABELS[r.question_code] ?? r.question_code,
                value: r.failures,
                tooltip: `${r.failures} failed attempts on "${r.question_code}"`,
              }))}
              empty="No retries yet"
            />
          </Card>
          <Card title="Languages">
            <BarList rows={(data?.languages ?? []).map((l) => ({ label: LANGUAGE_NAMES[l.language] ?? l.language, value: l.n }))} />
          </Card>
        </div>

        {/* Sessions */}
        <Card
          title="Calls"
          action={
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 rounded-full border border-[#eadfc8] bg-[#fffdf7] px-3 py-1.5">
                <Search className="h-4 w-4 text-[#8a7a5c]" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Farmer, mobile, claim…"
                  className="w-36 bg-transparent text-sm outline-none sm:w-48"
                />
              </label>
              <select
                value={disposition}
                onChange={(e) => setDisposition(e.target.value)}
                className="rounded-full border border-[#eadfc8] bg-[#fffdf7] px-3 py-1.5 text-sm"
              >
                <option value="all">All dispositions</option>
                {DISPOSITION_CODES.map((c) => (
                  <option key={c} value={c}>
                    {dispositionLabel(c)}
                  </option>
                ))}
              </select>
            </div>
          }
        >
          <div className="-mx-4 overflow-x-auto sm:-mx-5">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead className="border-b border-[#eadfc8] text-xs uppercase tracking-wide text-[#8a7a5c]">
                <tr>
                  <th className="px-4 py-2 font-medium sm:px-5">When</th>
                  <th className="px-2 py-2 font-medium">Farmer</th>
                  <th className="px-2 py-2 font-medium">Language</th>
                  <th className="px-2 py-2 font-medium">Disposition</th>
                  <th className="px-2 py-2 font-medium">Claim</th>
                  <th className="px-2 py-2 text-right font-medium">Answers</th>
                  <th className="px-2 py-2 text-right font-medium">Retries</th>
                  <th className="px-2 py-2 text-right font-medium">LLM</th>
                  <th className="px-2 py-2 text-right font-medium">Quality</th>
                  <th className="px-4 py-2 sm:px-5" />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={10} className="px-5 py-8 text-center text-[#8a7a5c]">
                      {data ? 'No calls match.' : 'Loading…'}
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-[#f3ead6] last:border-0 hover:bg-[#fdf6e6]">
                    <td className="whitespace-nowrap px-4 py-3 sm:px-5">{formatWhen(r.created_at)}</td>
                    <td className="px-2 py-3">
                      <p className="font-medium">{r.caller_name ?? '—'}</p>
                      {r.caller_mobile && <p className="text-xs text-[#8a7a5c]">+91 ••••{r.caller_mobile.slice(-4)}</p>}
                    </td>
                    <td className="px-2 py-3">{LANGUAGE_NAMES[r.language] ?? r.language}</td>
                    <td className="px-2 py-3">
                      <DispositionBadge code={r.disposition ?? (r.ended_at ? null : 'in_progress')} />
                    </td>
                    <td className="px-2 py-3 font-mono text-xs">
                      {r.claim_id ? (
                        <span className="inline-flex items-center gap-1">
                          <FileText className="h-3.5 w-3.5 text-[#1f6b45]" />
                          {r.claim_id}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-2 py-3 text-right tabular-nums">{r.answered}</td>
                    <td className="px-2 py-3 text-right tabular-nums">{r.failed_attempts}</td>
                    <td className="px-2 py-3 text-right tabular-nums">{r.llm_fallbacks}</td>
                    <td className="px-2 py-3 text-right font-semibold tabular-nums">
                      {r.quality_score ?? r.rule_score ?? '–'}
                    </td>
                    <td className="px-4 py-3 text-right sm:px-5">
                      <Link
                        href={`/console/${r.id}`}
                        className="inline-flex items-center gap-1 rounded-full bg-[#0f3d27] px-3 py-1 text-xs font-semibold text-white hover:bg-[#17573a]"
                      >
                        {r.recording_url && <Video className="h-3.5 w-3.5 text-[#f4c451]" />}
                        Open <ChevronRight className="h-3.5 w-3.5" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </main>
  );
}
