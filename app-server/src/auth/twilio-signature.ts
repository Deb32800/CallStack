import type { NextFunction, Request, Response } from 'express';
import twilio from 'twilio';
import { config } from '../config.js';

/**
 * Verifies inbound Twilio webhooks (twiml/status/amd) are actually from
 * Twilio (§3.4 safety — the other half of the toll-fraud guard, alongside
 * the shared-secret on the dial-trigger endpoint).
 */
export function requireTwilioSignature(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const signature = req.header('X-Twilio-Signature');
  const url = `${config.appServer.publicUrl}${req.originalUrl}`;
  const valid =
    !!signature &&
    twilio.validateRequest(
      config.twilio.authToken,
      signature,
      url,
      (req.body ?? {}) as Record<string, string>,
    );
  if (!valid) {
    res.status(401).send('invalid twilio signature');
    return;
  }
  next();
}
