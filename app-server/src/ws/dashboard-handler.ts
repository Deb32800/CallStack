import type { WebSocket } from 'ws';
import type { DashboardInboundMessage } from '@callstack/shared';
import { getCall, subscribe } from '../state/call-state.js';
import { steerCall } from './conversation-relay-handler.js';

/** /ws/dashboard/:callId — live transcript/reasoning + live steering (§5, §9.2). */
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

    // Live steering (§9.2) — a typed instruction. steerCall queues it AND
    // fires an immediate brain turn if the call is live, so the AI acts on
    // it right away rather than waiting for the caller to speak next.
    if (msg.type === 'instruction') {
      void steerCall(callId, msg.text);
      return;
    }
  });

  ws.on('close', () => unsubscribe());
}
