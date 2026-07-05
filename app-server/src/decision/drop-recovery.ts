import type { TranscriptEntry } from '@callstack/shared';

export const MAX_REDIAL_ATTEMPTS = 2;

export type DropDecision =
  | { action: 'redial'; resumeContext: string; attempt: number }
  | { action: 'give_up' };

/**
 * §9.3 — if the call ends unexpectedly before the goal is met, auto-redial
 * the same number (max 2 attempts), feeding the brain the saved transcript
 * plus a "we got cut off, resume naturally" note. Pure.
 */
export function decideDropRecovery(
  redialCount: number,
  transcript: TranscriptEntry[],
): DropDecision {
  if (redialCount >= MAX_REDIAL_ATTEMPTS) {
    return { action: 'give_up' };
  }
  const lastLines = transcript
    .slice(-6)
    .map((t) => `${t.role}: ${t.text}`)
    .join('\n');
  const resumeContext = `We got cut off mid-call. Resume naturally, don't re-introduce yourself. Prior conversation:\n${lastLines}`;
  return { action: 'redial', resumeContext, attempt: redialCount + 1 };
}
