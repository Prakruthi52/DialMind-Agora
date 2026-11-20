import { NextRequest, NextResponse } from 'next/server';
import { getSessionState } from '@/lib/engine/flow';

// Live claim state for the call screen (polled every couple of seconds).
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return NextResponse.json(await getSessionState(id));
  } catch {
    return NextResponse.json({ error: 'Unknown session' }, { status: 404 });
  }
}
