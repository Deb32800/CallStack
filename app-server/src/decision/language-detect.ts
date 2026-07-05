export type CallLanguage = 'en' | 'ja';

// Hiragana (U+3040-U+309F), katakana (U+30A0-U+30FF), and CJK ideograph
// (U+4E00-U+9FFF) unicode ranges — a cheap regex check, not a second LLM
// call (§3.3 S9.4), so no added per-turn latency.
const JAPANESE_RE = /[぀-ゟ゠-ヿ一-鿿]/;

// A caller asking (in English) "can you speak Japanese?" never contains
// actual Japanese characters, so the unicode check alone misses one real
// trigger for this feature — an explicit spoken request rather than the
// caller actually switching languages themselves.
const REQUEST_JAPANESE_RE = /\b(japanese|nihongo)\b|日本語/i;

/**
 * Detects which language the NEXT reply should be in, purely from what the
 * caller just said — no "stickiness". Once transcription is actually
 * running in Japanese (after the WS language switch fires), a real Japanese
 * utterance keeps testing positive on JAPANESE_RE turn after turn, so this
 * naturally stays in Japanese without needing to remember prior turns; the
 * moment the caller's utterance is plain English again, it switches back
 * immediately — "clean switching both ways" per the caller's own words.
 */
export function detectLanguage(text: string): CallLanguage {
  if (JAPANESE_RE.test(text)) return 'ja';
  if (REQUEST_JAPANESE_RE.test(text)) return 'ja';
  return 'en';
}
