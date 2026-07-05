import 'dotenv/config';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

export const config = {
  twilio: {
    accountSid: required('TWILIO_ACCOUNT_SID'),
    authToken: required('TWILIO_AUTH_TOKEN'),
    phoneNumber: required('TWILIO_PHONE_NUMBER'),
  },
  groq: {
    apiKey: required('GROQ_API_KEY'),
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    // T3 (eng review §14): on the 1.8s timeout retry, fall back to the 8B
    // model instead of repeating the 70B call.
    fallbackModel: process.env.GROQ_FALLBACK_MODEL || 'llama-3.1-8b-instant',
  },
  appServer: {
    publicUrl: required('APP_SERVER_PUBLIC_URL').replace(/\/$/, ''),
    sharedSecret: required('APP_SERVER_SHARED_SECRET'),
    port: Number(process.env.PORT || 3000),
  },
  tts: {
    provider: process.env.TTS_PROVIDER || 'ElevenLabs',
    // §3.3 S9.4 — dedicated voice per language, not one voice forced
    // through a multilingual model. A native Japanese voice pronounces
    // Japanese far more naturally than an English voice speaking it.
    voiceEn: process.env.TTS_VOICE_EN || 'ZF6FPAbjXT4488VcRRnw-flash_v2_5-1.2_1.0_1.0',
    voiceJa: process.env.TTS_VOICE_JA || process.env.TTS_VOICE_EN || 'ZF6FPAbjXT4488VcRRnw-flash_v2_5-1.2_1.0_1.0',
    elevenLabsApiKey: process.env.ELEVENLABS_API_KEY || '',
  },
  transcriptionProvider: process.env.TRANSCRIPTION_PROVIDER || 'google',
  compareModeSerialize: process.env.COMPARE_MODE_SERIALIZE === 'true',
};

/** wss:// version of the public URL, for the ConversationRelay <Connect> url. */
export function publicWsUrl(): string {
  return config.appServer.publicUrl.replace(/^http/, 'ws');
}
