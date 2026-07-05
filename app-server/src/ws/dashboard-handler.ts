import type { WebSocket } from 'ws';
import type { DashboardInboundMessage } from '@callstack/shared';
import { getCall, subscribe } from '../state/call-state.js';
import { activeCallSockets, resumeWithHumanAnswer } from './conversation-relay-handler.js';

/** /ws/dashboard/:callId — live transcript/reasoning/HITL (§5, §9.2). */
export function handleDashboardConnection(ws: WebSocket, callId: string): void {
  const state = getCall(callId);
  if (!state) {
    ws.close(1008, 'unknown call');
    return;
  }

  // Replay current state so a dashboard opened mid-call isn't blank.
  ws.send(JSON.stringify({ type: 'status', callId, status: state.status, machine: state.machine }));
  for (const entry of state.transcript) {
    ws.send(JSON.stringify({ type: 'transcript', callId, entry }));
  }
  if (state.pendingHumanQuestion) {
    ws.send(
      JSON.stringify({
        type: 'ask_human',
        callId,
        question: state.pendingHumanQuestion.question,
        options: state.pendingHumanQuestion.options,
        ts: Date.now(),
      }),
    );
  }
  if (state.receipt) {
    ws.send(JSON.stringify({ type: 'result', callId, receipt: state.receipt }));
  }

  const unsubscribe = subscribe(callId, (event) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(event));
  });

  ws.on('message', (raw: Buffer) => {
    let msg: DashboardInboundMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'instruction') {
      state.liveInstructions.push(msg.text);
      return;
    }

    if (msg.type === 'ask_human_answer') {
      const callWs = activeCallSockets.get(callId);
      if (callWs) {
        void resumeWithHumanAnswer(callWs, callId, msg.answer);
      }
      return;
    }
  });

  ws.on('close', () => unsubscribe());
}
