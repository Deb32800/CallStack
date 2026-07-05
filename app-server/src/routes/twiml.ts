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

  // §3.3 S9.4 — a second <Language> child registers a DEDICATED Japanese
  // voice, so a mid-call `{type:"language"}` WS message switches to a
  // native Japanese voice rather than forcing the English voice through a
  // multilingual model (which was producing romaji/mixed-language output).
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <ConversationRelay
      url="${wsUrl}"
      ttsProvider="${config.tts.provider}"
      voice="${config.tts.voiceEn}"
      transcriptionProvider="${config.transcriptionProvider}"
      interruptible="any"
      reportInputDuringAgentSpeech="dtmf"
    >
      <Language
        code="ja-JP"
        ttsProvider="${config.tts.provider}"
        voice="${config.tts.voiceJa}"
        transcriptionProvider="${config.transcriptionProvider}"
      />
    </ConversationRelay>
  </Connect>
</Response>`;

  res.type('text/xml').send(twiml);
});
