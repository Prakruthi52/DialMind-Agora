import twilio from 'twilio';

// Sends WhatsApp messages through Twilio (the sandbox for the demo). Needs TWILIO_ACCOUNT_SID,
// TWILIO_AUTH_TOKEN and TWILIO_WHATSAPP_FROM. The recipient must have joined the sandbox.

export type SendResult = { ok: true; sid: string } | { ok: false; error: string };

export function isWhatsAppConfigured(): boolean {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
}

/** `mobile` is a 10-digit Indian number or a full +E.164 number. */
export async function sendWhatsApp(mobile: string, body: string): Promise<SendResult> {
  if (!isWhatsAppConfigured()) return { ok: false, error: 'Twilio not configured' };
  const digits = mobile.replace(/\D/g, '');
  const e164 = mobile.trim().startsWith('+') ? `+${digits}` : `+91${digits.slice(-10)}`;
  const from = process.env.TWILIO_WHATSAPP_FROM ?? '+17372508034';
  try {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const message = await client.messages.create({
      from: from.startsWith('whatsapp:') ? from : `whatsapp:${from}`,
      to: `whatsapp:${e164}`,
      body,
    });
    return { ok: true, sid: message.sid };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message.slice(0, 300) : 'send failed' };
  }
}

/** Plain SMS from the account's Twilio number (TWILIO_SMS_FROM). Trial: verified numbers only. */
export async function sendSms(mobile: string, body: string): Promise<SendResult> {
  const from = process.env.TWILIO_SMS_FROM;
  if (!isWhatsAppConfigured() || !from) return { ok: false, error: 'SMS not configured' };
  const digits = mobile.replace(/\D/g, '');
  const e164 = mobile.trim().startsWith('+') ? `+${digits}` : `+91${digits.slice(-10)}`;
  try {
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    // SMS has no emoji-safe guarantee on every handset; keep it plain.
    const message = await client.messages.create({ from, to: e164, body: body.replace(/[^\u0000-￿]/gu, '').trim() });
    return { ok: true, sid: message.sid };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message.slice(0, 300) : 'send failed' };
  }
}

/** WhatsApp first, SMS as fallback. Returns the channel that worked. */
export async function sendConfirmation(
  mobile: string,
  body: string,
): Promise<{ ok: boolean; channel: 'whatsapp' | 'sms' | null; error?: string }> {
  const wa = await sendWhatsApp(mobile, body);
  if (wa.ok) return { ok: true, channel: 'whatsapp' };
  const sms = await sendSms(mobile, body);
  if (sms.ok) return { ok: true, channel: 'sms' };
  return { ok: false, channel: null, error: `whatsapp: ${wa.error}; sms: ${sms.error}` };
}
