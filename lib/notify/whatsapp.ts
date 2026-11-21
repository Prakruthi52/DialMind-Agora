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
