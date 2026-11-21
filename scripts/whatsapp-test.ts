// Twilio setup check: lists the account's phone numbers and sends one test SMS to a verified
// number. Run: npx tsx scripts/whatsapp-test.ts [+91XXXXXXXXXX]
import fs from 'node:fs';
import twilio from 'twilio';

for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].trim();
}

(async () => {
  const to = process.argv[2] ?? '+919945231987';
  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  const numbers = await client.incomingPhoneNumbers.list({ limit: 5 });
  console.log('account numbers:', numbers.map((n) => `${n.phoneNumber} sms=${n.capabilities.sms}`).join(', ') || '(none)');
  const from = numbers.find((n) => n.capabilities.sms)?.phoneNumber;
  if (!from) {
    console.log('No SMS-capable number on this account. Get the free trial number in the Twilio Console.');
    return;
  }
  const msg = await client.messages.create({ from, to, body: 'DialMind test: claim SMS confirmations are connected. - Vanya' });
  console.log('sent', msg.sid, msg.status);
  await new Promise((r) => setTimeout(r, 8000));
  const check = await client.messages(msg.sid).fetch();
  console.log('status after 8s:', check.status, check.errorCode ?? '', check.errorMessage ?? '');
})().catch((e) => console.log('ERROR', e.status ?? '', e.code ?? '', e.message));
