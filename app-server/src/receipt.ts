import type { CallOutcome, CallReceipt, CallSessionState } from '@callstack/shared';

// Capture prices in the currencies this actually gets used with — dollars,
// yen (¥ or the word/kanji), euros, pounds. Yen was invisible before: a
// negotiated ¥1500 never showed up on the receipt because only "$" matched.
const PRICE_RE =
  /(?:[$€£¥]\s?\d[\d,]*(?:\.\d+)?)|(?:\d[\d,]*(?:\.\d+)?\s?(?:yen|円|ドル|dollars?|euros?|pounds?))/i;

/**
 * §9.5 — rule-based summary, no extra LLM call. Instant, no added latency
 * after the call ends.
 */
export function buildReceipt(
  state: CallSessionState,
  outcome: CallOutcome,
): CallReceipt {
  const lastAgentLine = [...state.transcript]
    .reverse()
    .find((t) => t.role === 'agent');

  const quotedLine = [...state.transcript]
    .reverse()
    .find((t) => PRICE_RE.test(t.text));
  const quotedPrice = quotedLine?.text.match(PRICE_RE)?.[0]?.trim();

  const durationMs = state.startedAt
    ? (state.endedAt ?? Date.now()) - state.startedAt
    : 0;

  const summary = buildSummaryText(outcome, state, lastAgentLine?.text);

  return {
    callId: state.callId,
    businessName: state.request.businessName,
    outcome,
    summary,
    confirmedDetail: state.receipt?.confirmedDetail,
    quotedPrice,
    durationMs,
    transcript: state.transcript,
  };
}

function buildSummaryText(
  outcome: CallOutcome,
  state: CallSessionState,
  lastAgentLine?: string,
): string {
  switch (outcome) {
    case 'goal_met':
      return `Call with ${state.request.businessName} resolved: ${lastAgentLine ?? state.request.objective}`;
    case 'voicemail_left':
      return `Left a voicemail for ${state.request.businessName} — objective: ${state.request.objective}`;
    case 'no_answer':
      return `${state.request.businessName} did not answer.`;
    case 'busy':
      return `${state.request.businessName}'s line was busy.`;
    case 'failed':
      return `Could not complete the call to ${state.request.businessName}.`;
    case 'escalated':
      return `Call with ${state.request.businessName} paused for human input.`;
    case 'nothing_more_to_do':
    default:
      return `Call with ${state.request.businessName} ended: ${lastAgentLine ?? 'no further action needed'}`;
  }
}
