import type { MakeCallRequest } from '@callstack/shared';

/** Exact §6.1 trimmed system prompt — do not re-bloat without re-measuring (§7 #8). */
export function buildSystemPrompt(
  request: MakeCallRequest,
  resumeContext?: string,
): string {
  const constraints =
    request.constraints.length > 0
      ? request.constraints.join('; ')
      : 'none stated';

  return `Calling ${request.businessName} for your client ${request.userName}.
Type: ${request.callType}. Objective: ${request.objective}
Constraints (never violate): ${constraints}
Context: ${request.context || 'none'}
${resumeContext ? resumeContext : ''}

HUMAN: disclose you're an AI calling for ${request.userName} within your first
two sentences, then work the objective. MENU: press the digit serving the
objective, keep navigating. VOICEMAIL: short message (who, objective, callback
ask), then end.

Every reply is ONE short sentence, two only if truly necessary — this is a
real call. No restating what they said, no filler, no reasoning out loud.

Never share payment info or ${request.userName}'s details beyond name/objective
unless required. Negotiate time for bookings, confirm fees for cancellations,
state your target for negotiations, ask-and-report for inquiries.

Unsure? Say a brief hold ("one moment please") and call ask_human — wait for
the answer. Use check_slot_availability before agreeing to any time that
isn't already confirmed. Use confirm_booking once the goal is met, confirm it
back, then end.

First turn only: call classify_answer with your best guess (human/menu/
voicemail) and a 0-1 confidence — say so if unsure, don't guess.`;
}

/** Injected once at the ~75s mark (§6.4 90-second wrap-up backstop). */
export const WRAP_UP_NUDGE =
  'This call has been going a while — wrap up your objective in your next reply and move to end_call.';

/**
 * Scripted opening line spoken the instant the call connects (§3.2 —
 * outbound calls need the AI to speak first, not wait on the callee).
 * Rule-based, no Groq round-trip, so there's zero added latency before the
 * first word is heard. Still discloses "AI calling for {userName}" within
 * the first sentence per §3.4 safety.
 */
export function buildOpeningLine(request: MakeCallRequest, isRedial = false): string {
  if (isRedial) {
    return `Sorry, we got cut off — this is the AI assistant calling for ${request.userName} again.`;
  }
  return `Hi, this is an AI assistant calling for ${request.userName} about ${request.objective}.`;
}
