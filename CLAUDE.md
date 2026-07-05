# CallStack MCP — Complete Build Spec 

This is the single source of truth for building this project. Two things distinguish it from a first-draft spec: `search_businesses` is removed (Claude Desktop's own web search covers business discovery), and every gotcha found during live phone testing on 2026-07-04 is baked in as a correct instruction, not left to rediscover. Follow this exactly and you should not hit any of yesterday's bugs.

---

## 1. What this is

An MCP server that lets Claude Desktop make a real phone call and accomplish any goal, adapting live to whoever/whatever answers: a human, an automated phone menu, or voicemail. One generalized `make_call` tool, not booking-specific. Verified working end-to-end against three real phone calls.

## 2. Stack (exact, verified working)

| Layer | Choice | Notes |
|---|---|---|
| Planner | Claude Desktop | via MCP, local stdio |
| Tool layer | Node 20 + TypeScript, npm workspaces | `mcp-server/`, `app-server/`, `shared/` |
| Call + STT + TTS | Twilio ConversationRelay | see exact TwiML below |
| STT | `transcriptionProvider="google"` | lowercase, this one is NOT case-sensitive |
| TTS | `ttsProvider="ElevenLabs"`, `voice="ZF6FPAbjXT4488VcRRnw-flash_v2_5-1.2_1.0_1.0"` (Amelia) | **CASE-SENSITIVE**, must be exactly `"ElevenLabs"` — see §7 gotcha #1. **OPEN QUESTION:** does Twilio need your ElevenLabs API key linked in the Twilio Console first, or is it native/Twilio-billed like Amazon/Google? Unconfirmed — ask Deb if the first warm-up call fails mysteriously. `ELEVENLABS_API_KEY` to be supplied later. |
| Brain | Groq, model `llama-3.3-70b-versatile` | tool-calling (function calling), `max_tokens: 60` |
| Calendar | Anthropic's built-in Google Calendar connector | NOT a custom tool, Claude Desktop side only |
| App server host | Azure Container Apps (eastus), pinned to 1 replica | or ngrok for local dev |
| Business discovery | Claude Desktop's own built-in web search | NOT a custom tool — no Google Places API key needed |

## 3. Full feature list

### 3.1 MCP tools (the custom server, `mcp-server/`)

**Important design decision (not in the original v1 spec): `make_call` is split into two tools, not one blocking call.** A single blocking `make_call` means Claude gets nothing back — and so can say nothing to the user — until the call is completely finished, which is exactly when opening the live dashboard stops being useful. Splitting it means the first tool returns almost immediately with the dashboard URL, so Claude can hand it to the user WHILE the call is happening, without depending on whether Claude Desktop's client visually surfaces MCP progress notifications (unverified — see §7 gotcha #10 — this makes that uncertainty a non-issue instead of a demo risk).

1. **`start_call(phoneNumber, businessName, callType, objective, constraints, userName, context?, calendarSlot?)`** — triggers the call, returns almost immediately with `{callId, dashboardUrl}`. Tool description must instruct Claude: "ALWAYS tell the user the dashboard URL right away, then call `wait_for_call_result`." `callType` enum: `booking | cancellation | inquiry | complaint | negotiation | information_request | reschedule | order`. `calendarSlot`: `{start, end?, label?}`, pre-verified by Claude Desktop's calendar connector immediately before calling this tool — the app server never touches calendar credentials.
2. **`wait_for_call_result(callId)`** — blocks until the call finishes, returns the final outcome (transcript, receipt). Call immediately after `start_call`, after the dashboard link has already been given to the user. Progress notifications still fire during the wait as a bonus keepalive, but they are no longer load-bearing for the dashboard-link requirement.
3. **`start_compare_calls(businesses[], objective, userName, constraints)`** / **`wait_for_compare_result(compareGroupId)`** — same split, for Smart Parallel Calling (S9.1). ONLY on explicit user request ("compare a few places", "find the cheapest"). 2-3 businesses, min 2 max 3. Every call in the group forces `callType: "inquiry"` — never books mid-compare.
4. **`send_sms_confirmation(toNumber, message)`** — direct Twilio SMS send from `mcp-server` itself (not routed through the app server — it's a simple one-off action, no live-call state needed).

No `search_businesses` tool. No Google Places API key.

### 3.2 The adaptive call itself
One `make_call` tool, one brain, behavior branches on what's heard:
- **HUMAN**: disclose "I'm an AI assistant calling for {userName}" within the first two sentences, then work the objective.
- **AUTOMATED MENU**: press the digit serving the objective (via `press_dtmf` tool call), keep navigating. Dead-end detection: if the same 2-digit sub-sequence repeats (e.g. presses 1,3,1,3), stop and escalate via `ask_human` instead of looping forever.
- **VOICEMAIL**: short scripted message (who, objective, callback ask), then end — never negotiates with a machine.
- **NO_ANSWER / BUSY**: Twilio's call-status callback reports these distinctly from a connected call — resolve `make_call` cleanly with a "could not reach" result, never hang or error.
- **UNCLASSIFIABLE**: if the brain's classification confidence is below 0.5, ask one short clarifying question ("Sorry, is this a person or a machine?") before committing to any branch.

### 3.3 Wow features (all six, happy-path depth)
- **S9.1 Compare calling** — see §3.1.2. Default parallel; add a `COMPARE_MODE_SERIALIZE=true` env escape hatch to run them one after another if concurrent load ever regresses latency.
- **S9.2 Human-in-the-loop + live steering** — a dashboard (see §5) with an instruction box (typed live, folds into the brain's next turn as a system message) and an `ask_human` popup (brain calls `ask_human` tool, dashboard shows it, answer resumes the call).
- **S9.3 Dropped-call recovery** — if the call ends unexpectedly (WS closes) before the goal is met, auto-redial the same number (max 2 attempts), feed the brain the saved transcript + "we got cut off, resume naturally" context.
- **S9.4 Live language switching, scoped to English/Japanese only** — cheaper than it sounds, and worth keeping for a Japan-based, Japanese-judged event. ConversationRelay supports mid-call language switching via a dedicated `language` WebSocket message, which falls back to a pre-configured voice for that language. Build: (1) add a second `<Language>` child tag inside `<ConversationRelay>` for Japanese — look up the exact Japanese Amazon Polly neural voice name against Twilio's voice-configuration docs (something like `Takumi-Neural` or `Kazuha-Neural`, unconfirmed as of this writing); (2) add one new outbound WS message type (`{type: "language", ...}`) in `conversation-relay-handler.ts`; (3) detect Japanese cheaply via a regex check for Japanese Unicode ranges (hiragana/katakana/kanji) in the transcribed text — **not** a second LLM call, so no added latency; (4) trigger the switch when detected, and tell the brain via the system prompt to reply in whichever language the caller used. Budget ~20-30 min to build plus one live test call to confirm the Japanese voice actually pronounces correctly — this is unverified territory, same category as the AMD/interrupt spikes (Twilio documenting it doesn't guarantee it sounds right until you hear it).
- **S9.5 Call receipt** — a rule-based (no extra LLM call) summary built from the outcome + last agent transcript line. Instant, no added latency after the call ends.
- **S9.6 Confidence-based escalation** — do NOT ask the model to emit a separate confidence score via a second field/call (adds latency). Instead infer confidence from the reply text itself: if it contains hedging language ("I think", "maybe", "not sure", "probably", "one moment", "let me check"), treat as low-confidence. Two consecutive low-confidence turns → proactively escalate via `ask_human` before a mistake is made.

### 3.4 Safety basics
- Business-hours check before dialing (simple 8am-9pm local-time window is enough for a hackathon bar).
- AI discloses itself within first two sentences of any human conversation.
- Never handles payment info directly — reports quoted prices back, human pays separately.
- Neural TTS voice only, never Twilio's default "Standard" voice.
- Public app-server endpoint requires: (a) Twilio signature verification on inbound webhooks, (b) a shared-secret header on the endpoint Claude Desktop's `make_call` hits to trigger a dial. **Without this, the public URL is an unauthenticated toll-fraud vector the moment it's live.**

## 4. Architecture / pipeline (exact, this is what gave the working latency numbers)

```
Claude Desktop
    | start_call(...)  <- returns fast: {callId, dashboardUrl}
    | Claude tells the user the dashboard URL right here, before the call ends
    | wait_for_call_result(callId)  <- blocks until the call finishes
    v
mcp-server (local stdio)
    | POST https://<app-server-url>/calls
    | header: x-telephone-mcp-secret: <shared secret>
    v
app-server: routes/calls.ts
    | 1. business-hours check
    | 2. create in-memory call state (single Map, keyed by callId)
    | 3. Twilio REST API: client.calls.create({
    |      to, from, url: /twiml/:callId,
    |      statusCallback: /status/:callId,
    |      statusCallbackEvent: ["initiated","ringing","answered","completed"],
    |      machineDetection: "DetectMessageEnd",
    |      asyncAmd: "true"  <- STRING "true", not boolean true (Twilio SDK type)
    |      asyncAmdStatusCallback: /amd/:callId
    |    })
    v
Twilio dials the real phone (PSTN)
    v
routes/twiml.ts responds:
<Response><Connect><ConversationRelay
  url="wss://<app-server-url>/ws/:callId"
  ttsProvider="ElevenLabs"
  voice="ZF6FPAbjXT4488VcRRnw-flash_v2_5-1.2_1.0_1.0"
  transcriptionProvider="google"
  interruptible="any"
  reportInputDuringAgentSpeech="dtmf"
/></Connect></Response>
    v
app-server: one WebSocket per call, handles Twilio's 5 message types:
  setup    -> build system prompt, milestone "Call connected"
  prompt   -> runBrainTurn(): push transcript, call Groq (see §6),
              run decide() [pure function], execute actions
  dtmf     -> fed into next turn's context
  interrupt -> abort in-flight reply server-side (do NOT rely solely on
               the interruptible attribute — verify with your own abort flag)
  end      -> if goal not met, auto-redial (S9.3)
    v
finalizeCall(): build receipt, broadcast "result" to all subscribers
    |
    +--> dashboard WebSocket (/ws/dashboard/:callId) — live transcript/reasoning/HITL
    +--> MCP server's SSE subscription (/calls/:callId/events) — forwarded to
         Claude Desktop as MCP progress notifications (keeps the tool call
         alive, resets Claude Desktop's client-side timeout)
```

### Call-session state machine
```
SETUP -> LISTENING -> (first prompt) -> CLASSIFY ANSWER
  -> VOICEMAIL (scripted msg, end)
  -> MENU (dtmf loop, dead-end -> ask_human)
  -> HUMAN -> CONVERSING (prompt/brain/reply loop)
       -> "interrupt": abort reply, back to LISTENING
       -> 2 consecutive low-confidence turns -> ASK_HUMAN/HITL -> resume CONVERSING
       -> goal met -> END (confirm_booking, receipt, milestone)
END (unexpected, goal not met) -> DROP RECOVERY -> redial -> resumes at CONVERSING
```

## 5. Dashboard (S9.2) — make this genuinely impressive, not a plain debug view

Plain HTML/CSS/vanilla JS, no build step, no external CDN dependency (keep it self-contained — a live demo can't depend on a CDN being up), served as static files by the app server. Two WebSocket connection modes:
- Single call: connect with `?callId=<id>` in the URL query (this is the URL `start_call` hands back to Claude — see §3.1).
- Compare mode: `?compareGroupId=<id>` (or `?compareCallIds=id1,id2,id3` if resolving individual call ids client-side), opens one WS per call, renders side-by-side cards, highlights the lowest-price winner via a simple regex match on the receipt summary (`/\$(\d+(\.\d+)?)/`).

**Functional requirements (v1, already correct):** status bar with live timer, live transcript (agent vs. other_party vs. system lines, distinct styling), reasoning panel, instruction input box, an ask-human popup (question + optional quick-answer buttons + free-text fallback), a result card, compare-mode cards.

**Visual bar to hit — this is a judged UX/UI category, don't ship the plain version:**
- Dark theme, rich gradient background (deep navy/near-black base) with a subtle animated glow for depth — not a flat single color and never AI like design make AESTHETIC.
- Glassmorphic panels: semi-transparent card backgrounds, `backdrop-filter: blur(...)`, soft border, subtle shadow — not flat bordered boxes.
- Transcript as chat bubbles (like a messaging app), not log lines: agent messages right-aligned with a gradient fill, other_party left-aligned neutral, fade-in animation on new messages, auto-scroll.
- An animated voice-pulse/waveform indicator tied to whose turn it is (agent talking vs. listening) — CSS keyframe bars pulsing, doesn't need real audio analysis, just needs to feel alive.
- Status text and timer in a bold, confident type treatment with a gradient accent color, not default system font at default weight.
- Result card: a clear celebratory moment when a call resolves — an icon/checkmark treatment, a glowing border, not just plain text in a box.
- Compare-mode cards: a real side-by-side "vs" layout, winner gets a visibly distinct badge/glow, not just a CSS class toggle nobody notices.
- Everything animates in (fade/slide) rather than popping in instantly — cheap to add, makes a big visual difference on a projector.

This is worth real build time (see §11 Tier 2) — for a judged UX/UI award, the dashboard is the thing judges actually look at, not the server code.

Must include: status bar with live timer, live transcript (agent vs. other_party vs. system lines, distinct styling), reasoning panel, instruction input box, an ask-human popup (question + optional quick-answer buttons + free-text fallback), a result card, compare-mode cards.

## 6. The brain (Groq) — exact prompt + tool schema that worked

### 6.1 System prompt (trimmed version — use this, not a longer one)

```
Calling {businessName} for your client {userName}.
Type: {callType}. Objective: {objective}
Constraints (never violate): {constraints joined with "; ", or "none stated"}
Context: {context or "none"}
{resumeContext if this is a post-drop redial}

HUMAN: disclose you're an AI calling for {userName} within your first
two sentences, then work the objective. MENU: press the digit serving the
objective, keep navigating. VOICEMAIL: short message (who, objective, callback
ask), then end.

Every reply is ONE short sentence, two only if truly necessary — this is a
real call. No restating what they said, no filler, no reasoning out loud.

Never share payment info or {userName}'s details beyond name/objective
unless required. Negotiate time for bookings, confirm fees for cancellations,
state your target for negotiations, ask-and-report for inquiries.

Unsure? Say a brief hold ("one moment please") and call ask_human — wait for
the answer. Use check_slot_availability before agreeing to any time that
isn't already confirmed. Use confirm_booking once the goal is met, confirm it
back, then end.

First turn only: call classify_answer with your best guess (human/menu/
voicemail) and a 0-1 confidence — say so if unsure, don't guess.
```

Do not add a "keep the call under 90 seconds" line to the prompt — the model won't reliably follow it. Instead, use the server-side backstop in §6.4.

### 6.2 Tool (function-calling) schemas — **every single tool requires a `spokenReply` field**

This is the single most important gotcha from yesterday. **Groq's API returns a completely empty `message.content` whenever the model makes any tool call** — all of its output goes into the tool call's arguments instead, it does not populate both. If you build this without `spokenReply` on every tool, every reply that involves a tool call (which is most of them) will have no spoken text at all, and any fallback default you write ("One moment.") will fire almost every turn, making the AI sound completely broken on a real call.

Six tools, all requiring `spokenReply: string` ("What to say out loud this turn, one short sentence, always include"):

1. `classify_answer(classification: "human"|"menu"|"voicemail", confidence: number 0-1, spokenReply)` — first turn only.
2. `press_dtmf(digit: string, spokenReply)` — one digit, 0-9 * or #.
3. `check_slot_availability(proposedTime: string, spokenReply)` — compares against the pre-confirmed `calendarSlot` passed into `make_call`'s payload. This is a LOCAL string/date comparison, never a live calendar API call — the app server never holds calendar credentials (Claude Desktop's connector already re-verified the slot before calling `make_call`).
4. `confirm_booking(confirmedDetail: string, spokenReply)` — call once the goal is met.
5. `ask_human(question: string, options?: string[], spokenReply)` — escalate when unable to decide within constraints.
6. `end_call(reason: "goal_met"|"voicemail_left"|"nothing_more_to_do", spokenReply)`.

### 6.3 Reading the response

```
message = completion.choices[0].message
spokenReply = message.content?.trim() || ""   // usually empty if a tool was called
for each tool_call in message.tool_calls:
    args = JSON.parse(tool_call.function.arguments)
    if spokenReply is empty and args.spokenReply exists:
        spokenReply = args.spokenReply
    // then switch on tool_call.function.name to extract the rest of args
if spokenReply still empty: spokenReply = "One moment." // last-resort only
```

### 6.4 Timeouts and backstops (all verified necessary against real calls)

- **Groq call timeout: ~1.8s.** If it doesn't respond in time: play a scripted stall ("One moment please."), retry once. If the retry also fails: say a graceful apology and end the call. Never leave dead air.
- **90-second wrap-up nudge**: track elapsed call time server-side (`Date.now() - callStartTime`). Once it crosses ~75 seconds, inject one system message telling the brain to wrap up in its next reply, fire this exactly once per call. The prompt instruction alone is not enough — verified live, a real call ran 144 seconds without this backstop.
- **Interrupt handling**: don't fully trust the `interruptible="any"` TwiML attribute alone. Track your own per-turn ID; when an `interrupt` message arrives, mark the current turn as aborted and stop sending further reply chunks to TTS, regardless of what Twilio does on its own.

## 7. Known gotchas — bake these in from the start, don't rediscover them

1. **`ttsProvider` is case-sensitive.** Originally discovered as `"polly"` (lowercase) instead of `"Amazon"` causing an immediate live-call failure: Twilio plays "Sorry, an application error has occurred" and hangs up within ~8 seconds. Twilio's own error log (queryable via `https://monitor.twilio.com/v1/Alerts` with your account SID/auth token) will show `No enum constant for provided name: <value>` if you get this wrong — check there first if a call fails mysteriously. Now using `ttsProvider="ElevenLabs"` (exact casing) with a compound `voice` string — see §2. `transcriptionProvider="google"` (lowercase) is fine as-is, not case-sensitive the same way.
2. **ElevenLabs voice string format:** `"[voiceId]-[model]-[speed]_[stability]_[similarity]"`, e.g. `"ZF6FPAbjXT4488VcRRnw-flash_v2_5-1.2_1.0_1.0"`. Model defaults to `flash_v2_5` if omitted; speed range 0.7–1.2, stability/similarity 0.0–1.0. Confirmed directly from Twilio's own integration blog post, not guessed.
3. **`asyncAmd` on Twilio's `calls.create()` needs the string `"true"`, not boolean `true`**, per the Node Twilio SDK's types.
4. **`message.content` is empty on tool calls (Groq).** See §6.2/6.3 above — this is the big one.
5. **Twilio trial accounts** only call pre-verified numbers (Console → Phone Numbers → Verified Caller IDs) and play their own trial announcement before your TwiML executes. Treat that announcement as compatible with the "disclose as AI within 2 sentences" rule, not a conflict — don't try to suppress or work around it.
6. **Single Azure Container Apps replica, always.** Call state is a simple in-memory `Map`, no Redis/DB. Pin `--min-replicas 1 --max-replicas 1` on deploy — a second replica would silently lose call state on a mid-call webhook that lands on the wrong instance. One replica can still serve several concurrent calls (compare mode) fine; this is about avoiding *cross-replica* state loss, not limiting concurrency.
7. **Groq-only latency observed: ~860-1030ms average, some turns over 1.2s**, measured via simple `Date.now()` timing around the `getBrainTurn()` call, over ngrok (not a direct connection — ngrok adds its own overhead on top of whatever a real Azure deployment would show). Sub-800ms is the target; treat 800ms-1.2s as a yellow flag and >1.2s as a red flag worth investigating (swap model, shrink prompt further, or reconsider the network path) before you conclude the feature set is the problem.
8. **Keep the system prompt and tool descriptions terse.** Every extra sentence in the prompt or a tool's `description` field is real per-turn token overhead directly adding to the latency numbers above. The trimmed versions in §6.1/§6.2 are already the result of one cut — don't re-bloat them without re-measuring.
9. **`az account show` may show a `Disabled` subscription state** — check this before assuming `az containerapp up` will just work. If disabled, use ngrok for local dev/demo instead of blocking on Azure support.
10. **Don't build `search_businesses`.** Claude Desktop's own built-in web search already covers business discovery with Google Maps/Places data natively — a dedicated tool and API key here is unnecessary scope.
11. **Whether Claude Desktop visually surfaces MCP progress notifications during a long tool call is unverified.** Every test call so far bypassed the MCP layer entirely (direct `curl` to the app server), so this has never actually been checked against real Claude Desktop behavior. Don't depend on it for anything the demo needs to work — this is exactly why `start_call`/`wait_for_call_result` are split (§3.1): the dashboard link travels back to Claude as a normal tool result, not as a progress notification, so it doesn't matter whether Claude Desktop renders those notifications or not.

## 8. File structure (proven layout)

```
telephone-mcp/
├── package.json                 (npm workspaces: shared, mcp-server, app-server)
├── tsconfig.base.json
├── .env / .env.example
├── shared/src/types.ts          (MakeCallRequest, MakeCallResult, CallReceipt,
│                                  TranscriptEntry, CallSessionState,
│                                  AnswerClassification, MilestoneEvent,
│                                  DashboardInboundMessage)
├── mcp-server/src/
│   ├── index.ts                 (McpServer + StdioServerTransport, 3 tools)
│   ├── config.ts
│   ├── lib/app-server-client.ts (trigger + SSE-stream-consume helpers)
│   └── tools/send-sms-confirmation.ts
├── app-server/src/
│   ├── index.ts                 (Express + ws, upgrade routing for /ws/:callId
│   │                              and /ws/dashboard/:callId)
│   ├── config.ts
│   ├── auth/{shared-secret,twilio-signature}.ts
│   ├── state/call-state.ts      (in-memory Map, single source of truth per call)
│   ├── decision/                (PURE, unit-testable, no I/O:
│   │                              state-machine.ts, classify-answer.ts,
│   │                              confidence.ts, dtmf-navigate.ts, drop-recovery.ts)
│   ├── brain/                   (system-prompt.ts, tools.ts, groq-client.ts)
│   ├── ws/                      (conversation-relay-handler.ts, dashboard-handler.ts)
│   ├── routes/                  (calls.ts, twiml.ts, status-callback.ts, subscribe.ts)
│   ├── compare-mode.ts, redial.ts, call-lifecycle.ts, receipt.ts, business-hours.ts
│   └── Dockerfile
├── public/                       (dashboard: index.html, dashboard.css, dashboard.js)
└── deploy.sh                    (az containerapp up, --min-replicas 1 --max-replicas 1)
```

## 9. Environment variables

```
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
GROQ_API_KEY=
GROQ_MODEL=llama-3.3-70b-versatile
APP_SERVER_PUBLIC_URL=          (ngrok URL locally, Container App URL in prod)
APP_SERVER_SHARED_SECRET=       (openssl rand -hex 32)
PORT=3000
TTS_PROVIDER=ElevenLabs
TTS_VOICE=ZF6FPAbjXT4488VcRRnw-flash_v2_5-1.2_1.0_1.0   (Amelia)
ELEVENLABS_API_KEY=                                     (to be supplied later — see §7 gotcha #2)
TRANSCRIPTION_PROVIDER=google
COMPARE_MODE_SERIALIZE=false    (flip to true if concurrent compare-mode calls regress latency)
```

## 10. Build order (fastest path to a working demo)

1. Scaffold the 3 packages, get everything typechecking clean before writing a single call-flow line.
2. Wire `routes/calls.ts` + `routes/twiml.ts` + the shared-secret/Twilio-signature auth. Deploy locally behind ngrok. Place ONE test call with a trivial objective ("say hello, then goodbye") to prove the TTS/auth config from §4/§7 works before building anything else.
3. Build the decision seam (`decision/`) and brain (`brain/`) together, wire them into `ws/conversation-relay-handler.ts`. Test with a real call immediately — don't build the dashboard first, don't mock the WebSocket loop.
4. Build the dashboard once the core loop is proven live.
5. Add drop-recovery and receipt — both low-effort, high-value, bolt on last with no real risk.
6. Add English/Japanese language switching if Tier 1+2 in §11 are solid — cheap and high demo value for this specific audience.
7. Add HITL `ask_human` + confidence escalation if there's still time after that.
8. Compare mode is the last thing to attempt, only with real time to spare — see §11 for why.

## 11. Time-boxed cut priority (4-hour hackathon — cut from the bottom, not the top)

This is the actual answer to "what's possible in 4 hours." Build top to bottom; if you're behind schedule, stop adding and ship whatever tier you're in — never leave a tier half-built when a full lower tier was skippable instead.

**Tier 1 — Never cut (~2-2.25 hrs). Nothing else matters without this working.**
1. Scaffold + checkpoint 1 latency proof (~30-45 min)
2. Core `make_call`: human/menu/voicemail/no-answer branches, proven against a real call (~1-1.5 hrs)
3. Auth (shared secret + Twilio signature) + business-hours check (~15 min, cheap, don't skip)

**Tier 2 — Core demo value (~1-1.25 hrs). This is what makes it a demo, not just a working backend.**
4. Dashboard: live transcript view (skip fancy reasoning-panel styling if short on time) (~30-45 min)
5. `send_sms_confirmation` (~15 min)
6. Drop recovery (~0 min extra — it's cheap once the core loop works; don't rip it out to save time, it doesn't cost any)

**Tier 3 — Cheap differentiators, build only if Tier 1+2 are solid with time to spare (~30-50 min).**
7. English/Japanese language switching (~20-30 min + one live test call) — build this before HITL if forced to choose; higher demo value for a Japan-based, Japanese-judged event than an ask_human round-trip most judges won't personally trigger.
8. HITL `ask_human` + confidence escalation (~30 min) — real feature, same code path either way, but visually less necessary if 1-6 already work.

**Tier 4 — Cut entirely unless way ahead of schedule.**
9. Compare mode (S9.1) (~45min-1hr) — real engineering risk (parallel calls, capacity concerns) for one demo beat. Not worth the risk in a 4-hour window.
10. Business-card picker UI — always skip, let the user type/name businesses directly.

## 12. Demo & pitch — this matters as much as the code

Submission requires (per the event's luma page): a problem statement + solution approach explicitly aligned with your chosen RFS theme, a product/tech/business-model overview, a demo or video under 90 seconds, and a global market perspective. This project's theme is **"Software for Agents"** (not Company Brain, not Dynamic Software Interfaces) — say that explicitly, don't make judges guess. It's a genuinely clean fit: an MCP server giving an agent a new real-world capability (a phone line), not a stretch.

**Pitch structure (90-second budget):**
- ~10s: the problem — phone-only businesses are friction everyone avoids, and it compounds for non-native speakers and people with hearing/speech difficulties (this is your global-market-perspective answer — accessibility, not just convenience, per the original CLAUDE.md §14 framing).
- ~55-60s: the live call itself. Don't narrate over dead air — have the call already dialing before you start talking, so judges see the dashboard's live transcript update in real time while you talk over it. A REAL phone ringing live in front of judges is the single most memorable thing you can do; most other teams will be presenting a screen recording of a chat UI.
- ~15-20s: land on the outcome (booking confirmed / call resolved), then close with the explicit theme statement: "this is agent-first software — Claude gets a new tool, a phone line, via MCP."

---

## 13. Shared GBrain (cross-laptop continuation) — configured 2026-07-05

The gbrain knowledge base lives on **Supabase Postgres** so any laptop can pick up with full context. To connect a second machine:

1. Get the **Session Pooler** URL from Supabase → Settings → Database → Connection Pooler → Session (host `aws-0-us-east-1.pooler.supabase.com`, port `5432`, project ref `wpsbzpyhnyxyiofayiet`).
2. Point gbrain at it (env-var method, NOT `--url` which mis-parses):
   ```
   GBRAIN_DATABASE_URL="postgresql://postgres.wpsbzpyhnyxyiofayiet:<DB_PASSWORD>@aws-0-us-east-1.pooler.supabase.com:5432/postgres" \
     GBRAIN_DISABLE_DIRECT_POOL=1 gbrain init --non-interactive
   ```
3. **Gotcha (baked in):** Supabase's direct DB host `db.<ref>.supabase.co` is **IPv6-only** and unreachable on typical networks. gbrain tries it for DDL/migrations and fails with `getaddrinfo ENOTFOUND`. Fix: always set `GBRAIN_DISABLE_DIRECT_POOL=1` (routes DDL through the session pooler, which handles `ALTER TABLE` fine). Add `export GBRAIN_DISABLE_DIRECT_POOL=1` to your shell profile, and register the MCP with it: `claude mcp add --scope user gbrain -e GBRAIN_DISABLE_DIRECT_POOL=1 -- $(command -v gbrain) serve`.
4. Never commit the DB password or the Supabase service_role key — they stay in `~/.gbrain/config.json` (0600) and env only.

## 14. Eng-review build decisions (2026-07-05, /plan-eng-review — CLEARED)

Locked before implementation. Build order per §10, cut priority per §11.
- **T1 (P1):** Verify ElevenLabs key/linkage in the Twilio Console BEFORE the checkpoint-2 call (§2 open question). Don't dial until confirmed.
- **T2 (P1):** Use **ngrok** as `APP_SERVER_PUBLIC_URL` for build + demo; defer Azure (§7 #9 disabled-sub risk).
- **T3 (P2):** On the Groq 1.8s-timeout retry, fall back to `llama-3.1-8b-instant` (env `GROQ_FALLBACK_MODEL`) instead of repeating the 70B (§6.4).
- **T4 (P2):** Unit-test all `decision/` pure functions (state-machine, classify-answer, confidence, dtmf-navigate, drop-recovery, business-hours, receipt).
- **T5 (P2, CRITICAL):** Schema test asserting **every brain tool includes `spokenReply`** (guards the §6.2 gotcha — the worst live-call failure).
- **T6 (P3):** Known limitation — single-replica in-memory state; **do not redeploy during the demo** (kills active calls + defeats drop-recovery).
- **T7 (P3):** Confirm the exact Japanese Polly neural voice name before building S9.4 (§3.3 unconfirmed).

