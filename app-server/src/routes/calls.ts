import { Router } from 'express';
import type { MakeCallRequest, StartCallResponse } from '@callstack/shared';
import { config } from '../config.js';
import { requireSharedSecret } from '../auth/shared-secret.js';
import { isWithinBusinessHours } from '../business-hours.js';
import { createCall } from '../state/call-state.js';
import { twilioClient } from '../twilio-client.js';

export const callsRouter = Router();

callsRouter.post('/calls', requireSharedSecret, async (req, res) => {
  const request = req.body as MakeCallRequest;

  if (!request?.phoneNumber || !request?.businessName || !request?.objective) {
    res.status(400).json({ error: 'phoneNumber, businessName, and objective are required' });
    return;
  }

  if (!isWithinBusinessHours()) {
    res.status(422).json({ error: 'outside_business_hours' });
    return;
  }

  const state = createCall(request);

  try {
    const call = await twilioClient.calls.create({
      to: request.phoneNumber,
      from: config.twilio.phoneNumber,
      url: `${config.appServer.publicUrl}/twiml/${state.callId}`,
      statusCallback: `${config.appServer.publicUrl}/status/${state.callId}`,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      machineDetection: 'DetectMessageEnd',
      asyncAmd: 'true', // §7 #3 — string, not boolean, per the Twilio SDK types
      asyncAmdStatusCallback: `${config.appServer.publicUrl}/amd/${state.callId}`,
    });
    state.twilioCallSid = call.sid;
    state.status = 'ringing';
  } catch (err) {
    state.status = 'failed';
    res.status(502).json({ error: 'twilio_dial_failed', detail: (err as Error).message });
    return;
  }

  const response: StartCallResponse = {
    callId: state.callId,
    dashboardUrl: `${config.appServer.publicUrl}/index.html?callId=${state.callId}`,
  };
  res.json(response);
});
