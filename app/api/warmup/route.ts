import { NextResponse, after } from 'next/server';
import { startAvatarWarmup } from '@/lib/avatar-warmup';

// Called when the lobby opens: warms the Agora → Anam avatar path (see lib/avatar-warmup.ts).
export async function POST() {
  const { status, pending } = startAvatarWarmup();
  // Don't make the browser wait; after() keeps the serverless function alive until it finishes.
  if (pending) after(() => pending);
  return NextResponse.json({ status }, { status: status === 'warming' ? 202 : 200 });
}
