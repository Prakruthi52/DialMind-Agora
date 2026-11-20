'use client';

import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from 'lucide-react';
import { dispositionLabel, dispositionTone } from '@/lib/console/dispositions';

// Shared building blocks for the claims console (light, Indian-themed surface).

export const QUESTION_LABELS: Record<string, string> = {
  policy_ref: 'Policy / mobile',
  confirm_identity: 'Identity confirmed',
  crop_affected: 'Crop',
  cause_of_loss: 'Cause of loss',
  crop_stage: 'Crop stage',
  loss_date: 'Date of loss',
  late_reason: 'Reason for delay',
  harvest_date: 'Harvest date',
  affected_area: 'Damaged area',
  loss_percent: 'Crop lost',
  confirm_sms: 'SMS updates',
  final_confirmation: 'Final approval',
};

export const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', hi: 'Hindi', kn: 'Kannada', ta: 'Tamil', te: 'Telugu', bn: 'Bengali',
  gu: 'Gujarati', mr: 'Marathi', ml: 'Malayalam', pa: 'Punjabi', or: 'Odia',
};

export function Card({
  title,
  action,
  children,
  className = '',
}: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-[#eadfc8] bg-white p-4 shadow-sm sm:p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h2 className="text-sm font-semibold uppercase tracking-wide text-[#6b5b3e]">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-2xl border border-[#eadfc8] bg-white px-4 py-3 shadow-sm" title={hint}>
      <p className="text-xs font-medium text-[#6b5b3e]">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-[#0f2e20]">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-[#8a7a5c]">{hint}</p>}
    </div>
  );
}

/** Horizontal bar list: one hue for magnitude, value labelled directly, hover tooltip. */
export function BarList({
  rows,
  format = (n) => String(n),
  empty = 'No data yet',
}: {
  rows: { label: string; value: number; tooltip?: string }[];
  format?: (n: number) => string;
  empty?: string;
}) {
  if (!rows.length) return <p className="text-sm text-[#8a7a5c]">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.label} title={r.tooltip ?? `${r.label}: ${format(r.value)}`} className="group">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-[#2b2416]">{r.label}</span>
            <span className="shrink-0 font-semibold tabular-nums text-[#0f2e20]">{format(r.value)}</span>
          </div>
          <div className="mt-1 h-2 rounded-full bg-[#f5ecd9]">
            <div
              className="h-full rounded-full bg-[#e8952a] transition-all group-hover:bg-[#c97a14]"
              style={{ width: `${Math.max(3, (r.value / max) * 100)}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

const TONE: Record<string, { cls: string; Icon: typeof CheckCircle2 }> = {
  success: { cls: 'bg-[#e3f3e8] text-[#17573a] ring-[#9fd1b0]', Icon: CheckCircle2 },
  info: { cls: 'bg-[#e8eef8] text-[#294a7a] ring-[#b6c7e3]', Icon: Info },
  warning: { cls: 'bg-[#fdf0d5] text-[#8a5a00] ring-[#f0cf8a]', Icon: AlertTriangle },
  danger: { cls: 'bg-[#fde4e2] text-[#a3261b] ring-[#f2b0aa]', Icon: XCircle },
  neutral: { cls: 'bg-[#f1ece2] text-[#5a5040] ring-[#ddd2bd]', Icon: Loader2 },
};

export function DispositionBadge({ code, size = 'sm' }: { code: string | null | undefined; size?: 'sm' | 'lg' }) {
  if (!code) return <span className="text-xs text-[#8a7a5c]">Not reviewed</span>;
  const { cls, Icon } = TONE[dispositionTone(code)];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium ring-1 ${cls} ${
        size === 'lg' ? 'px-3 py-1.5 text-sm' : 'px-2 py-0.5 text-xs'
      }`}
    >
      <Icon className={size === 'lg' ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
      {dispositionLabel(code)}
    </span>
  );
}

const METHOD_CLS: Record<string, string> = {
  exact: 'bg-[#e3f3e8] text-[#17573a]',
  synonym: 'bg-[#e3f3e8] text-[#17573a]',
  regex: 'bg-[#e8eef8] text-[#294a7a]',
  lexicon: 'bg-[#e2f2f0] text-[#1d5c55]',
  fuzzy: 'bg-[#fdf0d5] text-[#8a5a00]',
  llm: 'bg-[#f6e3f3] text-[#7a2a6e]',
  none: 'bg-[#fde4e2] text-[#a3261b]',
};

export function MethodChip({ method, confidence }: { method: string; confidence?: number }) {
  return (
    <span className={`rounded-full px-2 py-0.5 font-mono text-[11px] ${METHOD_CLS[method] ?? 'bg-[#f1ece2] text-[#5a5040]'}`}>
      {method}
      {confidence !== undefined && ` · ${confidence.toFixed(2)}`}
    </span>
  );
}

export function formatDuration(s: number | null | undefined) {
  if (s === null || s === undefined) return '–';
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function formatWhen(sqlDate: string) {
  const d = new Date(sqlDate.replace(' ', 'T') + 'Z');
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(d);
}

export function pct(n: number, d: number) {
  return d ? `${Math.round((n / d) * 100)}%` : '–';
}
