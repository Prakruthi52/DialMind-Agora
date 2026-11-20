import { NextRequest, NextResponse } from 'next/server';
import { reviewSession } from '@/lib/console/judge';

export const dynamic = 'force-dynamic';
// The judge call can take a few seconds.
export const maxDuration = 60;

// Re-runs the post-call review (disposition + Gemini judge) for one session.
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await reviewSession(id);
  if (!report) return NextResponse.json({ error: 'Unknown session' }, { status: 404 });
  return NextResponse.json(report);
}
