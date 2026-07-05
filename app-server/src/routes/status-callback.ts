import { Router } from 'express';
import { requireTwilioSignature } from '../auth/twilio-signature.js';
import { getCall } from '../state/call-state.js';
import { broadcastMilestone, broadcastStatus, finalizeCall } from '../call-lifecycle.js';

export const statusCallbackRouter = Router();

// §3.2 NO_ANSWER / BUSY — Twilio's call-status callback reports these
// distinctly from a connected call. Resolve cleanly, never hang or error.
statusCallbackRouter.post('/status/:callId', requireTwilioSignature, (req, res) => {
  const callId = req.params.callId as string;
  const state = getCall(callId);
  if (!state) {
    res.sendStatus(200);
    return;
  }

  const callStatus = req.body?.CallStatus as string | undefined;

  switch (callStatus) {
    case 'ringing':
      broadcastStatus(callId, 'ringing', state.machine);
      break;
    case 'in-progress':
      broadcastStatus(callId, 'in_progress', state.machine);
      broadcastMilestone(callId, 'Call answered');
      break;
    case 'busy':
      broadcastMilestone(callId, 'Line busy');
      finalizeCall(callId, 'busy');
      break;
    case 'no-answer':
      broadcastMilestone(callId, 'No answer');
      finalizeCall(callId, 'no_answer');
      break;
    case 'failed':
    case 'canceled':
      broadcastMilestone(callId, 'Call failed');
      finalizeCall(callId, 'failed');
      break;
    case 'completed':
      // Normal hangup. If the ws end-handler hasn't already finalized this
      // call (goal met / voicemail / etc.), treat it as a clean end with
      // nothing more to do rather than leaving it dangling.
      if (state.machine !== 'END') {
        finalizeCall(callId, 'nothing_more_to_do');
      }
      break;
    default:
      break;
  }

  res.sendStatus(200);
});

// Async AMD result (§4 pipeline) — a secondary signal alongside the brain's
// own classify_answer; logged as a milestone, not used to override the
// brain's classification.
statusCallbackRouter.post('/amd/:callId', requireTwilioSignature, (req, res) => {
  const callId = req.params.callId as string;
  const state = getCall(callId);
  if (state) {
    const answeredBy = req.body?.AnsweredBy as string | undefined;
    if (answeredBy) {
      broadcastMilestone(callId, `AMD signal: ${answeredBy}`);
    }
  }
  res.sendStatus(200);
});
