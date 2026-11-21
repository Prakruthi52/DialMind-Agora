import { NextResponse, after } from 'next/server';
import { startAvatarWarmup } from '@/lib/avatar-warmup';

// A cold avatar start can take ~30 s before failing; keep the function alive for it.
export const maxDuration = 60;

// Called when the lobby opens: warms the Agora → Anam avatar path (see lib/avatar-warmup.ts).
export async function POST() {
  try {
    const { status, pending } = await startAvatarWarmup();
    // Don't make the browser wait; after() keeps the serverless function alive until it finishes.
    if (pending) after(() => pending);
    return NextResponse.json({ status }, { status: status === 'warming' ? 202 : 200 });
  } catch (error) {
    console.warn('Warm-up skipped:', error);
    return NextResponse.json({ status: 'skipped' });
  }
}
