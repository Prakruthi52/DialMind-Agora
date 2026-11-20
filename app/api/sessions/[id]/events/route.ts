import { NextRequest, NextResponse, after } from 'next/server';
import { queryOne, run } from '@/lib/db';
import { endSession } from '@/lib/engine/flow';
import { reviewSession } from '@/lib/console/judge';

export const maxDuration = 60;

// Call trace from the browser: transcript turns, agent state changes, per-stage latency
// metrics and errors. Feeds the claims console. Batched by the client.

const KINDS = new Set(['transcript', 'metric', 'state', 'error', 'call']);

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await queryOne('SELECT id FROM sessions WHERE id = ?', [id]);
  if (!session) return NextResponse.json({ error: 'Unknown session' }, { status: 404 });

  const body = (await request.json().catch(() => null)) as {
    events?: { kind: string; payload: unknown }[];
    ended?: boolean;
  } | null;
  const events = (body?.events ?? []).filter((e) => KINDS.has(e.kind)).slice(0, 200);
  for (const e of events) {
    await run('INSERT INTO session_events (session_id, kind, payload) VALUES (?, ?, ?)', [
      id,
      e.kind,
      JSON.stringify(e.payload).slice(0, 8000),
    ]);
  }
  if (body?.ended) {
    await endSession(id);
    // Post-call review (disposition + judge) in the background, after trailing tool-call
    // logs have landed. after() keeps the serverless function alive until it finishes.
    after(async () => {
      await new Promise((resolve) => setTimeout(resolve, 4000));
      await reviewSession(id).catch((error) => console.warn('Post-call review failed:', error));
    });
  }
  return NextResponse.json({ stored: events.length });
}
