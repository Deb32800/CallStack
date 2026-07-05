import twilio from 'twilio';
import { config } from '../config.js';

const client = twilio(config.twilio.accountSid, config.twilio.authToken);

/**
 * §3.1.4 — direct Twilio SMS send from mcp-server itself, not routed through
 * the app server (one-off action, no live-call state needed).
 */
export async function sendSmsConfirmation(
  toNumber: string,
  message: string,
): Promise<{ sid: string }> {
  const sms = await client.messages.create({
    to: toNumber,
    from: config.twilio.phoneNumber,
    body: message,
  });
  return { sid: sms.sid };
}
