import type { WebSocket } from 'ws';
import type { CallOutcome } from '@callstack/shared';
import { requireCall } from '../state/call-state.js';
import {
  broadcastAskHuman,
  broadcastMilestone,
  broadcastReasoning,
  broadcastStatus,
  broadcastTranscript,
  finalizeCall,
} from '../call-lifecycle.js';
import { buildOpeningLine, buildSystemPrompt, WRAP_UP_NUDGE } from '../brain/system-prompt.js';
import { getBrainTurn, type ChatMessage } from '../brain/groq-client.js';
import { decideClassification } from '../decision/classify-answer.js';
import { decideConfidence } from '../decision/confidence.js';
import { pressDigit } from '../decision/dtmf-navigate.js';
import { decideDropRecovery } from '../decision/drop-recovery.js';
import { detectLanguage, type CallLanguage } from '../decision/language-detect.js';
import { twilioClient } from '../twilio-client.js';
import { config } from '../config.js';

const WRAP_UP_AT_MS = 75_000; // §6.4 — nudge once elapsed crosses ~75s

// Per-connection chat history. One WS per call, so keyed by callId is safe
// (§7 #6 — this is why the app server must stay single-replica).
const messageHistory = new Map<string, ChatMessage[]>();
// Guards against a stale reply landing after an interrupt/redial superseded it.
const activeTurnId = new Map<string, number>();
// Live ConversationRelay socket per call, so the dashboard handler can push
// a live-steering resume (§9.2) onto the actual call in progress.
export const activeCallSockets = new Map<string, WebSocket>();
// Set right before a drop-recovery redial (§9.3), consumed by the next
// 'setup' event so the reconnect's opening line/system prompt know it's a
// resume, not a fresh call.
const pendingResumeContext = new Map<string, string>();
// Current spoken language per call (§3.3 S9.4 — EN/JP only), defaults to
// English until the caller's transcribed speech contains Japanese text.
const currentLanguage = new Map<string, CallLanguage>();

interface TwilioInboundMessage {
  type: 'setup' | 'prompt' | 'dtmf' | 'interrupt' | 'end';
  voicePrompt?: string;
  lang?: string;
  digit?: string;
  callSid?: string;
  from?: string;
  to?: string;
}

function send(ws: WebSocket, payload: Record<string, unknown>): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload));
}

function speak(ws: WebSocket, callId: string, text: string): void {
  send(ws, { type: 'text', token: text, last: true });
  broadcastTranscript(callId, { role: 'agent', text, ts: Date.now() });
}

const LANGUAGE_CODES: Record<CallLanguage, string> = { en: 'en-US', ja: 'ja-JP' };

/**
 * §3.3 S9.4 — mid-call EN/JP switch. Cheap regex detection (no extra LLM
 * call) on the caller's transcribed text; on a change, send Twilio's
 * dedicated `language` WS message and tell the brain (via a system message,
 * folded in on the next runBrainTurn) to reply in that language from now on.
 */
function maybeSwitchLanguage(ws: WebSocket, callId: string, callerText: string): void {
  if (!callerText) return;
  const detected = detectLanguage(callerText);
  const current = currentLanguage.get(callId) ?? 'en';
  if (detected === current) return;

  currentLanguage.set(callId, detected);
  const code = LANGUAGE_CODES[detected];
  send(ws, { type: 'language', ttsLanguage: code, transcriptionLanguage: code });

  const history = messageHistory.get(callId);
  if (history) {
    history.push({
      role: 'system',
      content:
        detected === 'ja'
          ? 'The caller switched to Japanese — reply in Japanese from now on.'
          : 'The caller switched to English — reply in English from now on.',
    });
  }
}

export function handleConversationRelayConnection(
  ws: WebSocket,
  callId: string,
): void {
  requireCall(callId);
  activeCallSockets.set(callId, ws);

  ws.on('message', (raw: Buffer) => {
    let msg: TwilioInboundMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    void handleMessage(ws, callId, msg).catch((err) => {
      console.error(`[call ${callId}] handler error:`, err);
    });
  });

  ws.on('close', () => {
    activeCallSockets.delete(callId);
    void handleUnexpectedClose(ws, callId);
  });
}

async function handleMessage(
  ws: WebSocket,
  callId: string,
  msg: TwilioInboundMessage,
): Promise<void> {
  const state = requireCall(callId);

  switch (msg.type) {
    case 'setup': {
      state.startedAt = Date.now();
      state.machine = 'LISTENING';
      state.twilioCallSid = msg.callSid ?? state.twilioCallSid;
      const resumeContext = pendingResumeContext.get(callId);
      pendingResumeContext.delete(callId);
      const opening = buildOpeningLine(state.request, !!resumeContext);
      messageHistory.set(callId, [
        { role: 'system', content: buildSystemPrompt(state.request, resumeContext) },
        { role: 'assistant', content: opening },
      ]);
      broadcastMilestone(callId, 'Call connected');
      broadcastStatus(callId, 'in_progress', 'LISTENING');
      // Outbound call — the AI is the one calling, so it speaks first
      // instead of waiting on the callee (no Groq round-trip, zero added
      // latency before the first word is heard).
      speak(ws, callId, opening);
      return;
    }

    case 'prompt': {
      const text = msg.voicePrompt ?? '';
      broadcastTranscript(callId, { role: 'other_party', text, ts: Date.now() });
      maybeSwitchLanguage(ws, callId, text);
      await runBrainTurn(ws, callId, text);
      return;
    }

    case 'dtmf': {
      // Digits the OTHER party pressed (reportInputDuringAgentSpeech="dtmf"),
      // fed into the next turn's context per §4 pipeline.
      if (msg.digit) {
        broadcastTranscript(callId, {
          role: 'system',
          text: `Caller pressed: ${msg.digit}`,
          ts: Date.now(),
        });
      }
      return;
    }

    case 'interrupt': {
      // Don't fully trust `interruptible="any"` alone — track our own
      // per-turn id and stop sending further reply chunks (§6.4).
      activeTurnId.set(callId, (activeTurnId.get(callId) ?? 0) + 1);
      state.machine = 'LISTENING';
      return;
    }

    case 'end': {
      if (state.machine !== 'END') {
        await handleUnexpectedClose(ws, callId);
      }
      return;
    }

    default:
      return;
  }
}

async function runBrainTurn(
  ws: WebSocket,
  callId: string,
  callerText: string,
): Promise<void> {
  const state = requireCall(callId);
  const myTurnId = (activeTurnId.get(callId) ?? 0) + 1;
  activeTurnId.set(callId, myTurnId);

  const history = messageHistory.get(callId) ?? [
    { role: 'system', content: buildSystemPrompt(state.request) },
  ];

  // §6.4 — 90s wrap-up backstop, fires exactly once per call.
  if (
    !state.wrapUpNudged &&
    state.startedAt &&
    Date.now() - state.startedAt >= WRAP_UP_AT_MS
  ) {
    history.push({ role: 'system', content: WRAP_UP_NUDGE });
    state.wrapUpNudged = true;
  }

  // Live steering (§9.2) — instructions typed on the dashboard fold into
  // the brain's next turn as a system message.
  if (state.liveInstructions.length > 0) {
    for (const instruction of state.liveInstructions) {
      history.push({ role: 'system', content: `Human operator says: ${instruction}` });
    }
    state.liveInstructions = [];
  }

  if (callerText) history.push({ role: 'user', content: callerText });

  const result = await getBrainTurn(history);

  // A newer turn (interrupt/redial) superseded this one — drop it.
  if (activeTurnId.get(callId) !== myTurnId) return;

  history.push({ role: 'assistant', content: result.spokenReply });
  messageHistory.set(callId, history);

  if (result.toolCalls.length > 0) {
    broadcastReasoning(
      callId,
      result.toolCalls.map((t) => `${t.name}(${JSON.stringify(t.args)})`).join('; '),
    );
  }

  speak(ws, callId, result.spokenReply);

  for (const call of result.toolCalls) {
    await executeToolCall(ws, callId, call.name, call.args);
  }

  // §9.6 — two consecutive low-confidence turns escalate via ask_human.
  const confidenceDecision = decideConfidence(result.spokenReply, state.lowConfidenceStreak);
  state.lowConfidenceStreak = confidenceDecision.streak;
  if (confidenceDecision.action === 'escalate') {
    state.machine = 'ASK_HUMAN';
    broadcastAskHuman(
      callId,
      'The AI seems unsure two turns in a row — want to jump in?',
    );
  }
}

async function executeToolCall(
  ws: WebSocket,
  callId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<void> {
  const state = requireCall(callId);

  switch (name) {
    case 'classify_answer': {
      const classification = args.classification as 'human' | 'menu' | 'voicemail';
      const confidence = Number(args.confidence ?? 0);
      const decision = decideClassification(classification, confidence);
      if (decision.action === 'clarify') {
        state.machine = 'CLASSIFY';
      } else {
        state.classification = decision.classification;
        state.machine =
          decision.classification === 'voicemail'
            ? 'VOICEMAIL'
            : decision.classification === 'menu'
              ? 'MENU'
              : 'CONVERSING';
      }
      broadcastStatus(callId, state.status, state.machine);
      return;
    }

    case 'press_dtmf': {
      const digit = String(args.digit ?? '');
      const decision = pressDigit(state.dtmfHistory, digit);
      state.dtmfHistory = decision.history;
      send(ws, { type: 'sendDigits', digits: digit });
      if (decision.deadEnd) {
        state.machine = 'ASK_HUMAN';
        broadcastAskHuman(
          callId,
          `Stuck in a menu loop pressing ${digit} repeatedly — how should I navigate?`,
        );
      }
      return;
    }

    case 'check_slot_availability': {
      // Pure local string/date comparison against the pre-confirmed slot —
      // never a live calendar API call (§6.2 #3, app server holds no
      // calendar credentials).
      const proposedTime = String(args.proposedTime ?? '');
      const slot = state.request.calendarSlot;
      const matches = !!slot && proposedTime.trim() === slot.start.trim();
      broadcastReasoning(
        callId,
        `check_slot_availability: proposed="${proposedTime}" confirmedSlot="${slot?.start ?? 'none'}" -> ${matches ? 'match' : 'no match'}`,
      );
      return;
    }

    case 'confirm_booking': {
      state.receipt = {
        ...(state.receipt ?? {
          callId,
          businessName: state.request.businessName,
          outcome: 'goal_met',
          summary: '',
          durationMs: 0,
          transcript: state.transcript,
        }),
        confirmedDetail: String(args.confirmedDetail ?? ''),
      };
      return;
    }

    case 'ask_human': {
      state.machine = 'ASK_HUMAN';
      broadcastAskHuman(
        callId,
        String(args.question ?? ''),
        args.options as string[] | undefined,
      );
      return;
    }

    case 'end_call': {
      const reason = (args.reason as CallOutcome) ?? 'nothing_more_to_do';
      finalizeCall(callId, reason);
      send(ws, { type: 'end' });
      ws.close();
      return;
    }

    default:
      return;
  }
}

/** §9.2 — dashboard answers fold in and proactively resume the conversation. */
export async function resumeWithHumanAnswer(
  ws: WebSocket,
  callId: string,
  answer: string,
): Promise<void> {
  const state = requireCall(callId);
  state.pendingHumanQuestion = undefined;
  state.machine = 'CONVERSING';
  const history = messageHistory.get(callId) ?? [
    { role: 'system', content: buildSystemPrompt(state.request) },
  ];
  history.push({ role: 'system', content: `Human operator answered: ${answer}` });
  messageHistory.set(callId, history);
  await runBrainTurn(ws, callId, '');
}

/** §9.3 — dropped-call recovery: auto-redial (max 2 attempts) with resume context. */
async function handleUnexpectedClose(ws: WebSocket, callId: string): Promise<void> {
  const state = requireCall(callId);
  if (state.machine === 'END') return; // clean end, nothing to recover

  const decision = decideDropRecovery(state.redialCount, state.transcript);
  if (decision.action === 'give_up') {
    finalizeCall(callId, 'failed');
    return;
  }

  state.redialCount = decision.attempt;
  state.machine = 'DROP_RECOVERY';
  broadcastMilestone(callId, `Call dropped — redialing (attempt ${decision.attempt})`);
  pendingResumeContext.set(callId, decision.resumeContext);

  try {
    await twilioClient.calls.create({
      to: state.request.phoneNumber,
      from: config.twilio.phoneNumber,
      url: `${config.appServer.publicUrl}/twiml/${callId}`,
      statusCallback: `${config.appServer.publicUrl}/status/${callId}`,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      machineDetection: 'DetectMessageEnd',
      asyncAmd: 'true',
      asyncAmdStatusCallback: `${config.appServer.publicUrl}/amd/${callId}`,
    });
  } catch {
    finalizeCall(callId, 'failed');
  }
}
