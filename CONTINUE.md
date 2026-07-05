# CONTINUE — cross-laptop handoff

Last updated: 2026-07-05 (post first live call). Read this first when resuming.

## Where we are right now

**Phases 1-5 are built and working end-to-end against a real phone call.**
Full call flow (Twilio dial → ConversationRelay → ElevenLabs TTS → Google STT →
Groq brain → tool calls → receipt) verified live to +819091644892 on 2026-07-05.

Done:
- `shared/src/types.ts` — full type contract.
- `app-server/src/` — config, state, auth (shared-secret + Twilio signature),
  business-hours, routes (calls/twiml/status-callback/subscribe), `decision/`
  pure functions (state-machine, classify-answer, confidence, dtmf-navigate,
  drop-recovery, language-detect), `brain/` (system-prompt, tools with the
  spokenReply load-time guard, groq-client with 1.8s timeout + 8B fallback),
  `ws/` (conversation-relay-handler, dashboard-handler), call-lifecycle,
  receipt, index.ts.
- `mcp-server/src/` — start_call, wait_for_call_result, send_sms_confirmation.
- `public/` — full glassmorphic dashboard (gradient bg, glass panels, chat
  bubbles, voice-pulse, ask-human popup, celebratory result card) per §5.
- S9.3 drop recovery, S9.5 receipt, S9.6 confidence escalation — all wired
  into the ws handler.
- S9.4 EN/JP language switching — built (regex JP detection, `<Language>`
  TwiML child tag, outbound `language` WS message), **not yet verified on a
  real Japanese-language call** — do that before relying on it live.
- MCP server registered in Claude Desktop's config
  (`~/Library/Application Support/Claude/claude_desktop_config.json` →
  `mcpServers.callstack`) — **restart Claude Desktop to pick it up.**

Not done / deliberately cut:
- Compare mode (S9.1) — Tier 4, cut per CLAUDE.md §11 time-boxing.
- Unit tests for `decision/` (T4) and the spokenReply schema test (T5) — T5's
  guard exists as a runtime assertion in `brain/tools.ts` instead of a
  standalone test file.
- ElevenLabs voice is still the default Amelia — the API key on this account
  is scoped without `voices_read`/`user_read`, so voice browsing wasn't
  possible; user chose to keep the default rather than widen the key.

## Known environment gotchas (this machine, 2026-07-05)

- **Port 3000 is occupied by an unrelated Next.js dev server** (a different
  project, PID varies, `next-server (v16.1.6)`). The app-server runs on
  **3001** here — `.env` has `PORT=3001`. Don't "fix" this by killing that
  process; it's not part of this project.
- **ngrok URL is ephemeral.** Every time the tunnel restarts, the URL
  changes. When that happens, update it in BOTH places:
  1. `.env` → `APP_SERVER_PUBLIC_URL`
  2. `~/Library/Application Support/Claude/claude_desktop_config.json` →
     `mcpServers.callstack.env.APP_SERVER_PUBLIC_URL`
  Then restart the app-server (env is loaded once at boot) and restart
  Claude Desktop (same reason).
- ngrok requires `ngrok config add-authtoken <token>` once per machine
  (account is free, token from https://dashboard.ngrok.com/get-started/your-authtoken).
- Twilio account is a **Trial** account — can only dial pre-verified numbers
  (Console → Phone Numbers → Verified Caller IDs). +819091644892 and
  +817044836092 are verified as of 2026-07-05.

## Resume steps on the new laptop

```bash
git clone https://github.com/Deb32800/CallStack.git && cd CallStack
npm install
npm run typecheck

# .env is gitignored — copy values from .env.example and fill in real
# secrets (ask the user, or pull from the other laptop's .env directly,
# never commit it).
cp .env.example .env

# ngrok (only if not already installed/authed on this machine)
brew install ngrok
ngrok config add-authtoken <token>
ngrok http <PORT from .env>   # update APP_SERVER_PUBLIC_URL with the URL this prints

npm run dev:app   # or: npx tsx app-server/src/index.ts
```

Then update `claude_desktop_config.json`'s `mcpServers.callstack` block (see
above) with this machine's absolute paths + the fresh ngrok URL, and restart
Claude Desktop.

## Locked eng decisions (CLAUDE.md §14)

T1 verify ElevenLabs before first call (done, confirmed working) · T2 ngrok
not Azure (done) · T3 Groq 8B fallback on retry (done) · T4 unit-test
decision/ (not done) · T5 assert every tool has spokenReply (done, as a
runtime guard) · T6 no redeploy during demo · T7 confirm JP voice name before
S9.4 (superseded — ElevenLabs flash_v2_5 is multilingual, same voice used for
both languages, but the JP call itself is still unverified).

## Next candidates (not started)

- Live-test the EN/JP switch with an actual Japanese-speaking call.
- Unit tests for `decision/` (T4) and the tools schema guard (T5) as
  standalone test files rather than the current runtime assertion.
- Consider compare mode (S9.1) only if there's real time to spare.
