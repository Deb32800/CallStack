import Groq from 'groq-sdk';
import { config } from '../config.js';
import { BRAIN_TOOLS } from './tools.js';

const groq = new Groq({ apiKey: config.groq.apiKey });

const TIMEOUT_MS = 1800; // §6.4 — verified necessary against real calls
const MAX_TOKENS = 60; // §2 — keep replies short, keep latency down

export interface BrainToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface BrainTurnResult {
  spokenReply: string;
  toolCalls: BrainToolCall[];
  modelUsed: string;
  timedOut: boolean;
}

export type ChatMessage = Groq.Chat.Completions.ChatCompletionMessageParam;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('groq_timeout')), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

async function callModel(
  messages: ChatMessage[],
  model: string,
): Promise<BrainTurnResult> {
  const completion = await withTimeout(
    groq.chat.completions.create({
      model,
      messages,
      tools: BRAIN_TOOLS,
      tool_choice: 'auto',
      max_tokens: MAX_TOKENS,
    }),
    TIMEOUT_MS,
  );

  const message = completion.choices[0]?.message;
  // §6.3 — message.content is usually empty when a tool call is made;
  // spokenReply then lives inside the tool call's own arguments instead.
  let spokenReply = message?.content?.trim() || '';
  const toolCalls: BrainToolCall[] = [];

  for (const call of message?.tool_calls ?? []) {
    if (call.type !== 'function') continue;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(call.function.arguments);
    } catch {
      args = {};
    }
    if (!spokenReply && typeof args.spokenReply === 'string') {
      spokenReply = args.spokenReply;
    }
    toolCalls.push({ name: call.function.name, args });
  }

  if (!spokenReply) spokenReply = 'One moment.'; // last-resort only, §6.3

  return { spokenReply, toolCalls, modelUsed: model, timedOut: false };
}

/**
 * §6.4: ~1.8s timeout. On timeout/failure, retry once — on the fallback
 * model per T3 (§14), not by repeating the 70B call. If the retry also
 * fails, return a graceful apology that the caller should speak and then
 * end the call. Never leaves dead air.
 */
export async function getBrainTurn(
  messages: ChatMessage[],
): Promise<BrainTurnResult> {
  try {
    return await callModel(messages, config.groq.model);
  } catch {
    try {
      const result = await callModel(messages, config.groq.fallbackModel);
      return { ...result, timedOut: true };
    } catch {
      return {
        spokenReply: "I'm sorry, I'm having trouble right now. Goodbye.",
        toolCalls: [{ name: 'end_call', args: { reason: 'nothing_more_to_do' } }],
        modelUsed: config.groq.fallbackModel,
        timedOut: true,
      };
    }
  }
}
