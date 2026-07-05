// Shared types — the contract between mcp-server, app-server, and the dashboard.
// Kept dependency-free so every package can import it cheaply.

export type CallType =
  | 'booking'
  | 'cancellation'
  | 'inquiry'
  | 'complaint'
  | 'negotiation'
  | 'information_request'
  | 'reschedule'
  | 'order';

/** A calendar slot pre-verified by Claude Desktop's connector before the call. */
export interface CalendarSlot {
  start: string; // ISO 8601
  end?: string; // ISO 8601
  label?: string;
}

/** Payload the MCP server sends to the app server to trigger a dial. */
export interface MakeCallRequest {
  phoneNumber: string;
  businessName: string;
  callType: CallType;
  objective: string;
  constraints: string[];
  userName: string;
  context?: string;
  calendarSlot?: CalendarSlot;
}

/** Fast response from start_call — dashboard link travels back to Claude here. */
export interface StartCallResponse {
  callId: string;
  dashboardUrl: string;
}

/** How a call answered / classified. */
export type AnswerClassification = 'human' | 'menu' | 'voicemail';

/** Final disposition of a call. */
export type CallOutcome =
  | 'goal_met'
  | 'voicemail_left'
  | 'no_answer'
  | 'busy'
  | 'failed'
  | 'nothing_more_to_do'
  | 'escalated';

/** One line in the running transcript. */
export interface TranscriptEntry {
  role: 'agent' | 'other_party' | 'system';
  text: string;
  ts: number; // Date.now()
}

/** Rule-based post-call summary (§9.5) — no extra LLM call. */
export interface CallReceipt {
  callId: string;
  businessName: string;
  outcome: CallOutcome;
  summary: string;
  confirmedDetail?: string;
  quotedPrice?: string;
  durationMs: number;
  transcript: TranscriptEntry[];
}

/** Coarse call-lifecycle status. */
export type CallStatus =
  | 'queued'
  | 'ringing'
  | 'in_progress'
  | 'completed'
  | 'no_answer'
  | 'busy'
  | 'failed';

export type CallStateMachine =
  | 'SETUP'
  | 'LISTENING'
  | 'CLASSIFY'
  | 'VOICEMAIL'
  | 'MENU'
  | 'CONVERSING'
  | 'ASK_HUMAN'
  | 'DROP_RECOVERY'
  | 'END';

/** Server-side per-call state (in-memory Map, single source of truth). */
export interface CallSessionState {
  callId: string;
  request: MakeCallRequest;
  status: CallStatus;
  machine: CallStateMachine;
  classification?: AnswerClassification;
  transcript: TranscriptEntry[];
  startedAt?: number; // when the WS connected (ms)
  endedAt?: number;
  receipt?: CallReceipt;
  redialCount: number;
  lowConfidenceStreak: number;
  dtmfHistory: string[];
  pendingHumanQuestion?: AskHumanPayload;
  liveInstructions: string[]; // typed live on the dashboard, folded into next turn
  wrapUpNudged: boolean; // 90s backstop fired once
  twilioCallSid?: string;
  compareGroupId?: string;
}

/** A milestone / status event broadcast to the dashboard + MCP SSE stream. */
export interface MilestoneEvent {
  type: 'milestone';
  callId: string;
  label: string;
  ts: number;
}

export interface TranscriptEvent {
  type: 'transcript';
  callId: string;
  entry: TranscriptEntry;
}

export interface ReasoningEvent {
  type: 'reasoning';
  callId: string;
  text: string;
  ts: number;
}

export interface AskHumanPayload {
  question: string;
  options?: string[];
}

export interface AskHumanEvent {
  type: 'ask_human';
  callId: string;
  question: string;
  options?: string[];
  ts: number;
}

export interface ResultEvent {
  type: 'result';
  callId: string;
  receipt: CallReceipt;
}

export interface StatusEvent {
  type: 'status';
  callId: string;
  status: CallStatus;
  machine: CallStateMachine;
}

/** Events the app server pushes out to dashboard WS + MCP SSE. */
export type OutboundEvent =
  | MilestoneEvent
  | TranscriptEvent
  | ReasoningEvent
  | AskHumanEvent
  | ResultEvent
  | StatusEvent;

/** Messages the dashboard sends back in (live steering + ask-human answers). */
export type DashboardInboundMessage =
  | { type: 'instruction'; text: string }
  | { type: 'ask_human_answer'; answer: string };

/** Compare-mode grouping (§9.1). */
export interface CompareGroupRequest {
  businesses: Array<{ phoneNumber: string; businessName: string }>;
  objective: string;
  userName: string;
  constraints: string[];
}

export interface CompareGroupResponse {
  compareGroupId: string;
  callIds: string[];
  dashboardUrl: string;
}
