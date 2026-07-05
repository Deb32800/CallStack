export interface DtmfDecision {
  history: string[];
  deadEnd: boolean;
}

/**
 * Dead-end detection (§3.2 MENU branch): if the same 2-digit sub-sequence
 * repeats (e.g. presses 1,3,1,3), stop and escalate via ask_human instead of
 * looping forever. Pure — takes the existing history + new digit, returns
 * the appended history and whether this press closed a repeating loop.
 */
export function pressDigit(history: string[], digit: string): DtmfDecision {
  const next = [...history, digit];
  const n = next.length;
  const deadEnd =
    n >= 4 &&
    next[n - 4] === next[n - 2] &&
    next[n - 3] === next[n - 1] &&
    next[n - 4] !== next[n - 3];
  return { history: next, deadEnd };
}
