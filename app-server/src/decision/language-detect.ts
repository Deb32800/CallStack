export type CallLanguage = 'en' | 'ja';

// Hiragana (U+3040-U+309F), katakana (U+30A0-U+30FF), and CJK ideograph
// (U+4E00-U+9FFF) unicode ranges — a cheap regex check, not a second LLM
// call (§3.3 S9.4), so no added per-turn latency.
const JAPANESE_RE = /[぀-ゟ゠-ヿ一-鿿]/;

export function detectLanguage(text: string): CallLanguage {
  return JAPANESE_RE.test(text) ? 'ja' : 'en';
}
