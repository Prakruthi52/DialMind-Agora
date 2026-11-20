import { NextRequest, NextResponse } from 'next/server';
import { buildSessionReport } from '@/lib/console/report';

export const dynamic = 'force-dynamic';

// Full trace of one call for the claims console.
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await buildSessionReport(id);
  if (!report) return NextResponse.json({ error: 'Unknown session' }, { status: 404 });
  return NextResponse.json(report);
}
