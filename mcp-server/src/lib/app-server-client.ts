import type {
  CallReceipt,
  MakeCallRequest,
  StartCallResponse,
} from '@callstack/shared';
import { config } from '../config.js';

const HEADER = 'x-telephone-mcp-secret';

export async function triggerCall(
  request: MakeCallRequest,
): Promise<StartCallResponse> {
  const res = await fetch(`${config.appServer.publicUrl}/calls`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      [HEADER]: config.appServer.sharedSecret,
    },
    body: JSON.stringify(request),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`start_call failed (${res.status}): ${body}`);
  }

  return (await res.json()) as StartCallResponse;
}

/**
 * Consumes the app server's SSE stream for a call until the terminal
 * "result" event arrives (§4 pipeline). Each intermediate event is handed
 * to onEvent so the caller can surface MCP progress notifications.
 */
export async function streamCallResult(
  callId: string,
  onEvent?: (event: unknown) => void,
): Promise<CallReceipt> {
  const res = await fetch(`${config.appServer.publicUrl}/calls/${callId}/events`, {
    headers: { [HEADER]: config.appServer.sharedSecret },
  });

  if (!res.ok || !res.body) {
    throw new Error(`wait_for_call_result failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';

    for (const chunk of chunks) {
      const line = chunk.split('\n').find((l) => l.startsWith('data: '));
      if (!line) continue;
      const event = JSON.parse(line.slice('data: '.length)) as {
        type: string;
        receipt?: CallReceipt;
      };
      if (event.type === 'result' && event.receipt) {
        return event.receipt;
      }
      onEvent?.(event);
    }
  }

  throw new Error('call event stream ended without a result');
}
