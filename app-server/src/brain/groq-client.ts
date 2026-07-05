import Groq from 'groq-sdk';
import { config } from '../config.js';
import { BRAIN_TOOLS } from './tools.js';

// One client per API key, for daily-quota rotation. `currentKey` points at
// the key we last succeeded on, so we don't restart from a dead key each turn.
const clients = config.groq.apiKeys.map((apiKey) => new Groq({ apiKey }));
let currentKey = 0;

function isRateLimit(err: unknown): boolean {
  return (err as { status?: number })?.status === 429;
}

const TIMEOUT_MS = 1800; // §6.4 — verified necessary against real calls
// The spoken text stays short, but the model returns it INSIDE a tool call
// whose JSON (field names, options arrays, classification/confidence) also
// counts against max_tokens. 60 was fine for a bare spokenReply but
// truncated multi-field calls like ask_human mid-string → Groq rejected the
// whole turn as `tool_use_failed` and the call died. 120 leaves room for
// the JSON overhead at a negligible latency cost.
const MAX_TOKENS_EN = 120;
// Japanese text costs far more tokens once JSON-escaped inside the tool
// call's arguments (each kanji/kana can be several tokens), so it needs an
// even larger budget to avoid the same mid-string truncation.
const MAX_TOKENS_JA = 320;

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
  client: Groq,
  messages: ChatMessage[],
  model: string,
  maxTokens: number,
): Promise<BrainTurnResult> {
  const completion = await withTimeout(
    client.chat.completions.create({
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
 * Try one model across every API key, rotating on a 429 (daily-quota) error
 * so an exhausted key doesn't kill the turn. Returns null if all keys are
 * rate-limited; rethrows any non-rate-limit error (timeout / tool_use_failed)
 * so the caller can move to the fallback model rather than burn every key.
 */
async function tryModelAcrossKeys(
  messages: ChatMessage[],
  model: string,
  maxTokens: number,
): Promise<BrainTurnResult | null> {
  const n = clients.length;
  for (let attempt = 0; attempt < n; attempt++) {
    const idx = (currentKey + attempt) % n;
    try {
      const result = await callModel(clients[idx]!, messages, model, maxTokens);
      currentKey = idx; // stick to whichever key just worked
      return result;
    } catch (err) {
      if (isRateLimit(err)) {
        console.warn(`[groq] key #${idx} rate-limited on ${model}, rotating`);
        continue; // try the next key
      }
      throw err; // timeout / bad-request — let the caller try the fallback model
    }
  }
  return null; // every key is rate-limited on this model
}

/**
 * §6.4: ~1.8s timeout. Rotates keys on daily-quota limits, and falls back
 * to the 8B model on a timeout/bad-request (T3, §14). If everything fails,
 * returns a graceful apology + end_call so a real call never hangs.
 */
export async function getBrainTurn(
  messages: ChatMessage[],
  language: 'en' | 'ja' = 'en',
): Promise<BrainTurnResult> {
  const maxTokens = language === 'ja' ? MAX_TOKENS_JA : MAX_TOKENS_EN;

  // 1. Primary model, rotating across keys on daily-quota (429) limits.
  try {
    const primary = await tryModelAcrossKeys(messages, config.groq.model, maxTokens);
    if (primary) return primary;
  } catch (primaryErr) {
    console.error('[groq] primary model failed (non-rate-limit):', primaryErr);
  }

  // 2. Fallback model (also rotating keys) — reached when the primary model
  //    is quota-exhausted on ALL keys, or errored non-recoverably.
  try {
    const fallback = await tryModelAcrossKeys(messages, config.groq.fallbackModel, maxTokens);
    if (fallback) return { ...fallback, timedOut: true };
  } catch (fallbackErr) {
    console.error('[groq] fallback model failed (non-rate-limit):', fallbackErr);
  }

  // 3. Everything exhausted — never leave dead air.
  console.error('[groq] all keys + models exhausted this turn');
  return {
    spokenReply: "I'm sorry, I'm having trouble right now. Goodbye.",
    toolCalls: [{ name: 'end_call', args: { reason: 'nothing_more_to_do' } }],
    modelUsed: config.groq.fallbackModel,
    timedOut: true,
  };
}
