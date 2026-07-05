import type {
  CallOutcome,
  CallStateMachine,
  MilestoneEvent,
  OutboundEvent,
  TranscriptEntry,
} from '@callstack/shared';
import { appendTranscript, publish, requireCall } from './state/call-state.js';
import { buildReceipt } from './receipt.js';

export function broadcastMilestone(callId: string, label: string): void {
  const event: MilestoneEvent = { type: 'milestone', callId, label, ts: Date.now() };
  publish(callId, event);
}

export function broadcastTranscript(callId: string, entry: TranscriptEntry): void {
  appendTranscript(callId, entry);
  const event: OutboundEvent = { type: 'transcript', callId, entry };
  publish(callId, event);
}

export function broadcastReasoning(callId: string, text: string): void {
  publish(callId, { type: 'reasoning', callId, text, ts: Date.now() } as OutboundEvent);
}

export function broadcastStatus(
  callId: string,
  status: import('@callstack/shared').CallStatus,
  machine: CallStateMachine,
): void {
  const state = requireCall(callId);
  state.status = status;
  state.machine = machine;
  publish(callId, { type: 'status', callId, status, machine } as OutboundEvent);
}

export function broadcastAskHuman(
  callId: string,
  question: string,
  options?: string[],
): void {
  const state = requireCall(callId);
  state.pendingHumanQuestion = { question, options };
  publish(callId, {
    type: 'ask_human',
    callId,
    question,
    options,
    ts: Date.now(),
  } as OutboundEvent);
}

/** §5 pipeline final step — builds the receipt and broadcasts it to every subscriber. */
export function finalizeCall(callId: string, outcome: CallOutcome): void {
  const state = requireCall(callId);
  if (!state.endedAt) state.endedAt = Date.now();
  state.machine = 'END';
  state.status = outcome === 'goal_met' || outcome === 'nothing_more_to_do'
    ? 'completed'
    : (outcome as import('@callstack/shared').CallStatus);

  const receipt = buildReceipt(state, outcome);
  state.receipt = receipt;

  publish(callId, { type: 'result', callId, receipt } as OutboundEvent);
}
