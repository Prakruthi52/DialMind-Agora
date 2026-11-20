// Call dispositions: the post-call status of every session. Shared by the rule-based
// classifier, the Claude judge (as an enum it must pick from) and the claims console UI.

export const DISPOSITIONS = {
  completed_claim_filed: { label: 'Call successfully completed – claim filed', tone: 'success' },
  completed_area_complaint: { label: 'Completed – area-based complaint recorded', tone: 'success' },
  completed_not_covered: { label: 'Completed – loss not covered', tone: 'info' },
  farmer_declined: { label: 'Farmer declined to file the claim', tone: 'info' },
  callback_requested: { label: 'Farmer asked to call back later', tone: 'info' },
  farmer_dropped: { label: 'Farmer hung up midway', tone: 'warning' },
  stuck_understanding: { label: "Stuck – Vanya couldn't understand the answers", tone: 'warning' },
  language_mismatch: { label: 'Language mismatch', tone: 'warning' },
  wrong_policy: { label: 'Policy not found / wrong caller', tone: 'warning' },
  no_response: { label: 'No response from the farmer', tone: 'warning' },
  off_topic: { label: 'Off-topic – not a crop claim', tone: 'info' },
  network_issue: { label: 'Network / connection issue', tone: 'danger' },
  agent_failure: { label: 'Technical failure – agent or tool error', tone: 'danger' },
  in_progress: { label: 'Call in progress', tone: 'neutral' },
} as const;

export type DispositionCode = keyof typeof DISPOSITIONS;

export const DISPOSITION_CODES = Object.keys(DISPOSITIONS) as DispositionCode[];

export function dispositionLabel(code: string): string {
  return DISPOSITIONS[code as DispositionCode]?.label ?? code;
}

export function dispositionTone(code: string): 'success' | 'info' | 'warning' | 'danger' | 'neutral' {
  return DISPOSITIONS[code as DispositionCode]?.tone ?? 'neutral';
}
