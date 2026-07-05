import type { AnswerClassification } from '@callstack/shared';

export const CLASSIFY_CONFIDENCE_THRESHOLD = 0.5;

export type ClassifyDecision =
  | { action: 'commit'; classification: AnswerClassification }
  | { action: 'clarify' };

/**
 * Pure decision for the first-turn classify_answer tool call (§3.2
 * UNCLASSIFIABLE branch). Below the confidence threshold, ask one short
 * clarifying question instead of committing to a branch.
 */
export function decideClassification(
  classification: AnswerClassification,
  confidence: number,
): ClassifyDecision {
  if (confidence < CLASSIFY_CONFIDENCE_THRESHOLD) {
    return { action: 'clarify' };
  }
  return { action: 'commit', classification };
}
