// Evaluates the JSON condition DSL stored in `rules.condition` and `questions.ask_if`.
// Ops: eq, in, not_in, gt, lt, days_since_gt (+ "strict":"future"), days_between_gt, missing,
// flag_set, policy_found, crop_on_policy, area_exceeds_insured, before_sowing. Any op may set
// "negate": true.

import { todayIST } from './match';

export interface PolicyRow {
  policy_no: string;
  farmer_name: string;
  mobile: string;
  village: string;
  district: string;
  state: string;
  season: string;
  insurer: string;
  bank_account_last4: string;
}

export interface CropRow {
  crop: string;
  survey_no: string;
  insured_area_acres: number;
  sum_insured_inr: number;
  sowing_date: string;
}

export interface RuleContext {
  /** Accepted answers by question code (normalised values). */
  answers: Record<string, string>;
  policy: PolicyRow | null;
  /** Insured plot for the chosen crop, when known. */
  crop: CropRow | null;
  /** Rule codes that have fired so far (for flag_set). */
  firedRules: Set<string>;
  now?: Date;
}

type Condition = Record<string, unknown> & { op: string; negate?: boolean };

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86400000);
}

export function evaluateCondition(raw: Record<string, unknown>, ctx: RuleContext): boolean {
  const c = raw as Condition;
  const field = (name: unknown) => (typeof name === 'string' ? ctx.answers[name] : undefined);
  const today = todayIST(ctx.now).toISOString().slice(0, 10);
  let result: boolean;

  switch (c.op) {
    case 'eq':
      result = field(c.field) === String(c.value);
      break;
    case 'in':
      result = (c.values as string[]).includes(field(c.field) ?? '');
      break;
    case 'not_in':
      result = !(c.values as string[]).includes(field(c.field) ?? '');
      break;
    case 'gt': {
      const v = field(c.field);
      result = v !== undefined && Number(v) > Number(c.value);
      break;
    }
    case 'lt': {
      const v = field(c.field);
      result = v !== undefined && Number(v) < Number(c.value);
      break;
    }
    case 'days_since_gt': {
      const v = field(c.field);
      if (!v) {
        result = false;
      } else if (c.strict === 'future') {
        // R_FUTURE_DATE: the date is after today. ("negate" is part of the stored encoding.)
        return v > today;
      } else {
        result = daysBetween(v, today) > Number(c.value);
      }
      break;
    }
    case 'days_between_gt': {
      const from = field(c.from);
      const to = field(c.to);
      result = !!from && !!to && daysBetween(from, to) > Number(c.value);
      break;
    }
    case 'missing':
      result = !field(c.field) || field(c.field) === 'skipped';
      break;
    case 'flag_set':
      result = ctx.firedRules.has(String(c.rule));
      break;
    case 'policy_found':
      result = !!ctx.policy;
      break;
    case 'crop_on_policy':
      result = !!ctx.crop;
      break;
    case 'area_exceeds_insured': {
      const v = field(c.field);
      result = !!ctx.crop && v !== undefined && Number(v) > ctx.crop.insured_area_acres + 1e-6;
      break;
    }
    case 'before_sowing': {
      const v = field(c.field);
      result = !!ctx.crop && !!v && v < ctx.crop.sowing_date;
      break;
    }
    default:
      console.warn('Unknown rule op', c.op);
      result = false;
  }
  return c.negate ? !result : result;
}
