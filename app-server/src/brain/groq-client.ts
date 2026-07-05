import Groq from 'groq-sdk';
import { config } from '../config.js';
import { BRAIN_TOOLS } from './tools.js';

const groq = new Groq({ apiKey: config.groq.apiKey });

const TIMEOUT_MS = 1800; // §6.4 — verified necessary against real calls
const MAX_TOKENS_EN = 60; // §2 — keep replies short, keep latency down
// Japanese text costs far more tokens once JSON-escaped inside the tool
// call's arguments (each kanji/kana character can cost several tokens), so
// 60 truncated the function-call JSON mid-string, which Groq then rejected
// outright as `tool_use_failed` — this was the actual cause of the broken/
// romaji-fragment replies, not a prompt-compliance issue.
const MAX_TOKENS_JA = 200;

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

// Groq sometimes does NOT leave message.content empty on a tool call —
// occasionally it leaks raw JSON, the tool schema, or narrated reasoning
// ("my confidence is...") into content alongside the real tool call. That
// text must never reach TTS verbatim. Reject anything that looks like
// JSON/code or is implausibly long for a one-sentence spoken reply.
function isUsableSpokenText(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return false;
  if (trimmed.startsWith('```')) return false;
  if (/"spokenReply"|"classification"|"confidence"\s*:/i.test(trimmed)) return false;
  if (trimmed.length > 400) return false;
  return true;
}

async function callModel(
  messages: ChatMessage[],
  model: string,
  maxTokens: number,
): Promise<BrainTurnResult> {
  const completion = await withTimeout(
    groq.chat.completions.create({
      model,
      messages,
      tools: BRAIN_TOOLS,
      tool_choice: 'auto',
      max_tokens: maxTokens,
    }),
    TIMEOUT_MS,
  );

  const message = completion.choices[0]?.message;
  const toolCalls: BrainToolCall[] = [];
  let toolSpokenReply = '';

  for (const call of message?.tool_calls ?? []) {
    if (call.type !== 'function') continue;
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(call.function.arguments);
    } catch {
      args = {};
    }
    if (!toolSpokenReply && typeof args.spokenReply === 'string' && isUsableSpokenText(args.spokenReply)) {
      toolSpokenReply = args.spokenReply.trim();
    }
    toolCalls.push({ name: call.function.name, args });
  }

  // A tool's own spokenReply always wins when present and clean — content
  // is only a fallback, and only if it actually reads like a sentence
  // (§6.3: content is "usually" empty on a tool call, not always).
  const rawContent = message?.content?.trim() || '';
  let spokenReply = toolSpokenReply || (isUsableSpokenText(rawContent) ? rawContent : '');

  // Last-resort only (§6.3) — deliberately NOT "One moment", which is also
  // a legitimate hedge phrase (§9.6) the model uses intentionally. Reusing
  // it here made every parsing failure look like the model hedging, which
  // could trigger the two-strikes ask_human escalation for reasons that had
  // nothing to do with the model actually being unsure.
  if (!spokenReply) spokenReply = 'Sorry, could you say that again?';

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
  language: 'en' | 'ja' = 'en',
): Promise<BrainTurnResult> {
  const maxTokens = language === 'ja' ? MAX_TOKENS_JA : MAX_TOKENS_EN;
  try {
    return await callModel(messages, config.groq.model, maxTokens);
  } catch (primaryErr) {
    console.error('[groq] primary model failed:', primaryErr);
    try {
      const result = await callModel(messages, config.groq.fallbackModel, maxTokens);
      return { ...result, timedOut: true };
    } catch (fallbackErr) {
      console.error('[groq] fallback model also failed:', fallbackErr);
      return {
        spokenReply: "I'm sorry, I'm having trouble right now. Goodbye.",
        toolCalls: [{ name: 'end_call', args: { reason: 'nothing_more_to_do' } }],
        modelUsed: config.groq.fallbackModel,
        timedOut: true,
      };
    }
  }
}
