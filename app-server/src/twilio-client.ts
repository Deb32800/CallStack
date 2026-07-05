import twilio from 'twilio';
import { config } from './config.js';

export const twilioClient = twilio(
  config.twilio.accountSid,
  config.twilio.authToken,
);
