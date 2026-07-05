import { Router } from 'express';
import { config, publicWsUrl } from '../config.js';
import { requireTwilioSignature } from '../auth/twilio-signature.js';
import { requireCall } from '../state/call-state.js';

export const twimlRouter = Router();

// §4 — exact TwiML that gave the working latency numbers. Twilio POSTs here
// (calls.create's `url`) as soon as the call connects.
twimlRouter.post('/twiml/:callId', requireTwilioSignature, (req, res) => {
  const callId = req.params.callId as string;
  requireCall(callId); // 404s (via the thrown error -> 500 handler) if unknown

  const wsUrl = `${publicWsUrl()}/ws/${callId}`;

  // §3.3 S9.4 — a second <Language> child registers the Japanese fallback
  // config so a mid-call `{type:"language"}` WS message can switch without
  // a second round trip. ElevenLabs' flash_v2_5 model is multilingual (32
  // languages, confirmed via /v1/models), so the same voice ID covers
  // Japanese too — no separate JP voice needed. Unverified against a real
  // Japanese call yet; budget one live test to confirm pronunciation (same
  // caveat CLAUDE.md §3.3 flags for this feature).
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay
      url="${wsUrl}"
      ttsProvider="${config.tts.provider}"
      voice="${config.tts.voice}"
      transcriptionProvider="${config.transcriptionProvider}"
      interruptible="any"
      reportInputDuringAgentSpeech="dtmf"
    >
      <Language
        code="ja-JP"
        ttsProvider="${config.tts.provider}"
        voice="${config.tts.voice}"
        transcriptionProvider="${config.transcriptionProvider}"
      />
    </ConversationRelay>
  </Connect>
</Response>`;

  res.type('text/xml').send(twiml);
});
