# CONTINUE — cross-laptop handoff

Last updated: 2026-07-05. Read this first when resuming on another machine.

## Where we are right now

**Scaffold is done and committed. No dependencies installed yet. No call-flow code yet.**

Done:
- npm workspace scaffolded: `shared/`, `app-server/`, `mcp-server/` (§8 layout).
- `shared/src/types.ts` — full type contract between all packages (done).
- Root `package.json` (workspaces), `tsconfig.base.json`, per-package `package.json` + `tsconfig.json`.
- Dev model: **tsx** for running (no build step), **`npm run typecheck`** (tsc --noEmit) to validate.
- GitHub connected + pushed. GBrain on Supabase (shared across laptops) — see CLAUDE.md §13.
- Eng review CLEARED — build decisions locked in CLAUDE.md §14.

Not done yet (build order below):
- `npm install` (not run — do this first on the new laptop).
- Everything in `app-server/src/` and `mcp-server/src/` (only package.json/tsconfig exist).

## Resume steps on the new laptop

```bash
# 1. clone
git clone https://github.com/Deb32800/CallStack.git && cd CallStack

# 2. connect gbrain to the SHARED Supabase brain (see CLAUDE.md §13 for details)
export GBRAIN_DISABLE_DIRECT_POOL=1
GBRAIN_DATABASE_URL="postgresql://postgres.wpsbzpyhnyxyiofayiet:<DB_PASSWORD>@aws-0-us-east-1.pooler.supabase.com:5432/postgres" \
  GBRAIN_DISABLE_DIRECT_POOL=1 gbrain init --non-interactive
claude mcp add --scope user gbrain -e GBRAIN_DISABLE_DIRECT_POOL=1 -- "$(command -v gbrain)" serve

# 3. install deps
npm install

# 4. typecheck to confirm the scaffold is clean
npm run typecheck

# 5. read the project status page from the shared brain
gbrain get callstack-project-status
```

Then tell Claude Code: "read CONTINUE.md and CLAUDE.md, then continue the build from Phase 2."

## Build order (priority: working call + low latency FIRST)

- [x] **Phase 1 — Scaffold** (done, committed)
- [ ] **Phase 2 — Core call** (`app-server/src/`): config, state/call-state (Map), auth (shared-secret + twilio-signature), routes/calls.ts, routes/twiml.ts (ConversationRelay), routes/status-callback.ts, business-hours, index.ts (express + ws). Goal: a call dials. Place ONE trivial test call ("say hello, then goodbye") — checkpoint 2. **Gate T1: verify ElevenLabs key/linkage in Twilio Console before dialing.**
- [ ] **Phase 3 — Brain + decision + WS** (the priority): brain/system-prompt, brain/tools (6 tools, all with `spokenReply`), brain/groq-client (1.8s timeout + llama-3.1-8b-instant fallback). decision/ pure fns. ws/conversation-relay-handler. Real adaptive call working, low latency.
- [ ] **Phase 4 — mcp-server**: start_call, wait_for_call_result, send_sms_confirmation, app-server-client.
- [ ] **Phase 5 — Dashboard** (`public/`): glassmorphic live transcript, §5.
- [ ] **Phase 6 — receipt + drop-recovery + unit tests** (T4 decision/ tests, T5 spokenReply schema test).
- [ ] Tier 3+: EN/JP language switch, HITL. Tier 4 (cut unless ahead): compare mode.

## API keys still needed (ask the user, put in `.env` — never commit)

- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
- `GROQ_API_KEY`
- `ELEVENLABS_API_KEY` (+ confirm it's linked in the Twilio Console — eng decision T1)
- `APP_SERVER_SHARED_SECRET` (generate: `openssl rand -hex 32`)
- `APP_SERVER_PUBLIC_URL` = your ngrok URL (eng decision T2: ngrok, not Azure, for the demo)

## Locked eng decisions (CLAUDE.md §14)

T1 verify ElevenLabs before first call · T2 ngrok not Azure · T3 Groq 8B fallback on retry ·
T4 unit-test decision/ · T5 assert every tool has spokenReply · T6 no redeploy during demo · T7 confirm JP voice name before S9.4.
