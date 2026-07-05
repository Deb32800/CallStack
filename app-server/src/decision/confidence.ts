// §9.6 — infer confidence from reply text rather than asking the model for
// a separate score (avoids a second field/added latency).
const HEDGE_PATTERNS = [
  /\bi think\b/i,
  /\bmaybe\b/i,
  /\bnot sure\b/i,
  /\bprobably\b/i,
  /\bone moment\b/i,
  /\blet me check\b/i,
];

export function isLowConfidenceReply(spokenReply: string): boolean {
  return HEDGE_PATTERNS.some((re) => re.test(spokenReply));
}

export interface ConfidenceState {
  lowConfidenceStreak: number;
}

export type ConfidenceDecision =
  | { action: 'continue'; streak: number }
  | { action: 'escalate'; streak: number };

/**
 * Two consecutive low-confidence turns -> escalate via ask_human before a
 * mistake is made (§9.6). Pure — takes the current streak, returns the next
 * streak + whether to escalate.
 */
export function decideConfidence(
  spokenReply: string,
  currentStreak: number,
): ConfidenceDecision {
  const low = isLowConfidenceReply(spokenReply);
  const streak = low ? currentStreak + 1 : 0;
  if (streak >= 2) return { action: 'escalate', streak };
  return { action: 'continue', streak };
}
