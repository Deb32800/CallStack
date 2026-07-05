import type {
  CallSessionState,
  MakeCallRequest,
  TranscriptEntry,
} from '@callstack/shared';
import { randomUUID } from 'node:crypto';

// Single in-memory Map, single source of truth per call (§7 gotcha #6 —
// single Azure/ngrok replica only, this is NOT safe to shard across processes).
const calls = new Map<string, CallSessionState>();

// callId -> Set of subscriber callbacks (dashboard WS + MCP SSE), fed by
// broadcast() in call-lifecycle.ts. Kept alongside the state map since both
// are per-process singletons.
export type Subscriber = (event: unknown) => void;
const subscribers = new Map<string, Set<Subscriber>>();

export function createCall(request: MakeCallRequest): CallSessionState {
  const callId = randomUUID();
  const state: CallSessionState = {
    callId,
    request,
    status: 'queued',
    machine: 'SETUP',
    transcript: [],
    redialCount: 0,
    lowConfidenceStreak: 0,
    dtmfHistory: [],
    liveInstructions: [],
    wrapUpNudged: false,
  };
  calls.set(callId, state);
  return state;
}

export function getCall(callId: string): CallSessionState | undefined {
  return calls.get(callId);
}

export function requireCall(callId: string): CallSessionState {
  const s = calls.get(callId);
  if (!s) throw new Error(`Unknown callId: ${callId}`);
  return s;
}

export function appendTranscript(callId: string, entry: TranscriptEntry): void {
  requireCall(callId).transcript.push(entry);
}

export function subscribe(callId: string, cb: Subscriber): () => void {
  let set = subscribers.get(callId);
  if (!set) {
    set = new Set();
    subscribers.set(callId, set);
  }
  set.add(cb);
  return () => {
    set!.delete(cb);
    if (set!.size === 0) subscribers.delete(callId);
  };
}

export function publish(callId: string, event: unknown): void {
  const set = subscribers.get(callId);
  if (!set) return;
  for (const cb of set) cb(event);
}

export function deleteCall(callId: string): void {
  calls.delete(callId);
  subscribers.delete(callId);
}
