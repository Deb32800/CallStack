# CallStack

A phone line for your AI agent. CallStack is an MCP server that lets Claude make real phone calls on your behalf and carry out a goal end to end, adapting live to whoever or whatever answers. It speaks English and Japanese and switches between them the moment the person on the other end does.

Ask Claude in plain language: "Call this clinic and book me a check-up next week," or "Call these three cleaners, ask their price, and tell me the cheapest." Claude makes the call, works the objective, and hands you a live dashboard to watch and steer it in real time.

---

## The problem

If you live in a country whose language you do not speak fluently, the phone is a wall. A large share of everyday services in Japan and many other places still run on phone calls: clinics, salons, restaurants, landlords, delivery, city offices, repair services. A booking that takes a native speaker two minutes becomes something a foreigner avoids, postpones, or pays someone else to do.

The barrier is not only language. It is the live, unscripted nature of a phone call: an automated menu in a language you half-understand, a receptionist who speaks quickly, a follow-up question you did not prepare for. Text translation apps do not help when the interaction is spoken, real time, and two-way.

This is a daily friction for foreign residents, students, tourists, and anyone with a hearing or speech difficulty. It is also a friction for the businesses, which lose customers who simply give up.

## The solution

CallStack gives Claude a real phone line through the Model Context Protocol. You describe the task in the language you are comfortable in. Claude places the call, discloses that it is an assistant calling on your behalf, and then handles whatever happens:

- If a person answers, it works the objective in natural conversation.
- If an automated menu answers, it navigates the menu by pressing digits.
- If voicemail answers, it leaves a short message and ends.
- If the person speaks Japanese, it replies in Japanese; if they switch to English, it follows.

When the call is done you get a plain-language receipt of what was agreed, and, for a booking, Claude can add the event to your calendar and set a reminder.

## Alignment with the RFS: Software for Agents

This project targets the Y Combinator "Software for Agents" request for startups. The thesis of that RFS is that agents need their own tools and interfaces to act in the world, not just to answer questions.

CallStack is exactly that: an MCP server that gives an agent a new real-world capability it did not have before, a telephone. Claude does not simulate a call or draft a script for a human to read. It dials a real number over the public phone network, listens, speaks, and acts. The phone system is one of the largest pieces of software infrastructure that agents have historically been locked out of. CallStack is the adapter that lets an agent use it.

---

## Features

**Talk to anyone or anything.** One general-purpose calling tool. The agent classifies who or what answered on the first turn and branches: a human conversation, an automated menu, or voicemail. It is not limited to bookings; the same tool handles cancellations, inquiries, complaints, negotiations, reschedules, and orders.

**English and Japanese, switched live.** The agent detects the caller's language from what they say, including romanized Japanese that an English transcriber produces before the switch, and moves the whole call, its own speech and its listening, to that language mid-conversation. A dedicated native voice is used for each language.

**Live dashboard.** Every call opens a web dashboard with a real-time transcript shown as a conversation, the agent's reasoning as it decides what to do, a live timer, and a status indicator. The dashboard link is handed to you the instant the call starts, so you can watch while it happens.

**Steer the call while it is happening.** From the dashboard you can type an instruction at any point. It reaches the agent immediately and shapes its next reply. If you want it to offer a specific time, hold a price, or ask a particular question, you type it and the agent does it on the next turn.

**Negotiation.** For a negotiation call, the agent states a target, pushes back on the first offer, and reports the best price it reached. Tested live: it negotiated a home-cleaning price down from an opening range to a firm lower number and confirmed it on a follow-up call.

**Dropped-call recovery.** If a call drops before the goal is met, the agent redials the same number, up to two attempts, and resumes from where it left off rather than starting over.

**Confirmation by SMS.** The agent can send a confirmation text message directly after a call.

**Parallel calls to multiple businesses.** For a "call a few places and compare" request, CallStack can run several calls at once and report the results side by side, so you can choose the best option without making the calls yourself.

**Safety by default.** The agent discloses that it is an AI within the first two sentences of any human conversation. It never handles payment information; it reports quoted prices back to you and you pay separately. Calls are placed only within reasonable local hours. Every public endpoint is authenticated.

---

## How it works

The workflow from your side is short:

1. Open Claude with the CallStack MCP server connected.
2. Tell it what you need, for example: "Call the salon at this number, ask their price for a haircut, negotiate, and book me in for tomorrow afternoon."
3. Claude replies with a dashboard link right away. Open it to watch the call live.
4. The call runs. You can type instructions into the dashboard to steer it.
5. When it ends, Claude tells you what was agreed. For a booking, it can add the event and a reminder to your calendar.

## Architecture

```
Claude (with the CallStack MCP server)
    |  start_call(...)  -> returns a call id and a live dashboard link
    |  wait_for_call_result(...)
    v
MCP server (local, stdio)
    |  authenticated request to the app server
    v
App server (Node + TypeScript)
    |  places the call through Twilio, then runs the conversation:
    |    - a decision layer classifies the answer and drives the call state
    |    - the language model plans each spoken turn
    |    - language detection switches English / Japanese mid-call
    v
Twilio ConversationRelay  <->  the real phone call
    |
    +--> live dashboard (WebSocket): transcript, reasoning, your instructions
    +--> Claude: the final receipt, transcript, and outcome
```

The app server holds all live call state in memory and streams every event to both the dashboard and back to Claude. Calendar access stays on the Claude side through its own connector; the call infrastructure never touches your calendar credentials.

## Technology

| Layer | Choice |
| --- | --- |
| Agent | Claude, via the Model Context Protocol |
| Tool and call server | Node 20, TypeScript, npm workspaces |
| Telephony, speech-to-text, text-to-speech | Twilio ConversationRelay |
| Speech synthesis | ElevenLabs, a dedicated voice per language |
| Turn-by-turn reasoning | Groq, running Llama 3.3 with automatic key rotation and a smaller fallback model |
| Calendar | Claude's own calendar connector, on the agent side |

The turn-by-turn model is kept fast and terse so the conversation feels like a real call rather than a chatbot reading paragraphs. Multiple language-model keys rotate automatically so a single daily quota does not interrupt a call.

## Repository layout

```
shared/       shared TypeScript types, the contract between all parts
mcp-server/   the MCP server Claude connects to (start_call, wait_for_call_result, send_sms_confirmation)
app-server/   the call server: telephony, the reasoning loop, the decision layer, the dashboard back end
public/       the live dashboard (plain HTML, CSS, and JavaScript, no build step)
```

---

## Getting started

Requirements: Node 20, a Twilio account with a phone number, a Groq API key, an ElevenLabs API key, and a way to expose the local server to the internet for Twilio webhooks (a tunnel such as ngrok is enough for development).

```bash
git clone https://github.com/Deb32800/CallStack.git
cd CallStack
npm install
cp .env.example .env      # then fill in your keys
npm run typecheck
```

Fill in `.env` with your Twilio credentials, your Groq key or keys (comma-separated for automatic rotation), your ElevenLabs voice ids, a shared secret, and your public URL. Then start a tunnel to the app server's port and run it:

```bash
ngrok http --url=<your-domain> 3001
npx tsx app-server/src/index.ts
```

Register the MCP server with Claude by pointing its configuration at `mcp-server/src/index.ts` with the same environment values, then restart Claude. Once connected, ask Claude to make a call.

Note: a Twilio trial account can only call numbers you have verified in the Twilio console. Upgrade the account to call any number.

## Business model

The value is per successful call, which maps cleanly to pricing:

- Consumer subscription for individuals: a monthly plan with an included number of calls, aimed at foreign residents, students, and anyone who avoids the phone.
- Usage-based billing above the included amount, since each call has a real, small underlying cost.
- Business and team plans for relocation agencies, language schools, universities, and serviced-apartment operators who handle many calls for the people they support.

The underlying costs, telephony minutes and model tokens, are low and scale with usage, so the margin structure is straightforward.

## Market and global expansion

The immediate market is foreign residents in Japan, a large and growing population facing a phone-first service culture in a language that is hard to learn quickly. Japan is a strong first market precisely because the gap between "everyday task" and "phone call in Japanese" is so wide.

The same problem exists wherever people live, study, or travel outside their first language, which is a global condition rather than a local one. The design generalizes: adding a language is a matter of a voice, a transcriber setting, and detection rules, not a rewrite. Beyond language, the same capability serves anyone for whom a live phone call is a barrier, including people with hearing or speech difficulties, which broadens the market past foreign residents alone.

Because the agent, not the user, is on the call, the product scales across languages and countries without asking the user to learn anything new. The user always speaks to Claude in the language they are comfortable in.

## Demo

A demo video under 90 seconds accompanies this submission. It shows a single request typed to Claude, the live dashboard updating as the call happens, a mid-call language switch, and the confirmed outcome at the end.

## Status

The core is built and verified against real phone calls: placing a call, classifying the answer, holding a natural conversation, negotiating, booking, switching between English and Japanese, recovering from a dropped call, and the live dashboard with real-time steering. Parallel comparison calling and the calendar write-back through Claude's connector are part of the same design and integrate through the interfaces already in place.
