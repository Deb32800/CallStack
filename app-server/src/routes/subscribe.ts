import { Router } from 'express';
import { requireSharedSecret } from '../auth/shared-secret.js';
import { getCall, subscribe } from '../state/call-state.js';

export const subscribeRouter = Router();

/**
 * SSE stream the mcp-server consumes for wait_for_call_result (§4 pipeline).
 * Forwarded to Claude Desktop as MCP progress notifications while the tool
 * call is in flight; the "result" event is what resolves the tool call.
 */
subscribeRouter.get('/calls/:callId/events', requireSharedSecret, (req, res) => {
  const callId = req.params.callId as string;
  const state = getCall(callId);
  if (!state) {
    res.status(404).json({ error: 'unknown_call' });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const send = (event: unknown) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
    if ((event as { type?: string }).type === 'result') {
      clearInterval(keepalive);
      unsubscribe();
      res.end();
    }
  };

  // Replay current state immediately so a late subscriber doesn't miss
  // a result that already landed (e.g. reconnect after a network blip).
  if (state.receipt) {
    send({ type: 'result', callId, receipt: state.receipt });
    res.end();
    return;
  }

  const unsubscribe = subscribe(callId, send);

  const keepalive = setInterval(() => res.write(':keepalive\n\n'), 15000);

  req.on('close', () => {
    clearInterval(keepalive);
    unsubscribe();
  });
});
