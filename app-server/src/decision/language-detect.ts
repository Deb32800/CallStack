export type CallLanguage = 'en' | 'ja';

// Hiragana (U+3040-U+309F), katakana (U+30A0-U+30FF), and CJK ideograph
// (U+4E00-U+9FFF) unicode ranges — a cheap regex check, not a second LLM
// call (§3.3 S9.4), so no added per-turn latency.
const JAPANESE_RE = /[぀-ゟ゠-ヿ一-鿿]/;

// A caller asking (in English) "can you speak Japanese?" never contains
// actual Japanese characters, so the unicode check alone misses one real
// trigger — an explicit spoken request rather than switching themselves.
const REQUEST_JAPANESE_RE = /\b(japanese|nihongo)\b|日本語/i;

// THE key fix for "switch as soon as the human speaks Japanese": while the
// call is still transcribing in English, Twilio's English STT renders a
// Japanese speaker's words as ROMAJI ("moshi moshi", "arigato gozaimasu",
// "sumimasen"), never as Japanese characters — so JAPANESE_RE alone would
// never fire and the switch would never happen from voice alone. Matching
// the most common Japanese words/particles in Latin letters lets us flip to
// Japanese on the caller's very first Japanese utterance, before the STT
// language has even changed.
const ROMAJI_JAPANESE_RE =
  /\b(moshi[- ]?moshi|konnichiwa|konbanwa|ohayou|arigatou|gozaimasu|sumimasen|onegaishimasu|onegai|iie|wakarimasu|wakarimasen|daijoubu|desu|kudasai|nihongo|watashi|anata|hajimemashite)\b/i;

/**
 * Detects which language the NEXT reply should be in, purely from what the
 * caller just said — no "stickiness". Once transcription is running in
 * Japanese (after the WS language switch fires), real Japanese utterances
 * keep testing positive turn after turn, so it naturally stays in Japanese;
 * the moment the caller speaks plain English again it switches back — clean
 * both-way switching that follows the human's actual voice.
 */
export function detectLanguage(text: string): CallLanguage {
  if (JAPANESE_RE.test(text)) return 'ja';
  if (REQUEST_JAPANESE_RE.test(text)) return 'ja';
  if (ROMAJI_JAPANESE_RE.test(text)) return 'ja';
  return 'en';
}
