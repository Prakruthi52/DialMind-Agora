import { NextRequest, NextResponse } from 'next/server';
import { queryOne, run } from '@/lib/db';

// Registers the uploaded call recording (a Vercel Blob URL) for a session.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!(await queryOne('SELECT id FROM sessions WHERE id = ?', [id]))) {
    return NextResponse.json({ error: 'Unknown session' }, { status: 404 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    url?: string;
    contentType?: string;
    sizeBytes?: number;
    durationS?: number;
  };
  // Only accept URLs on Vercel Blob storage.
  if (!body.url || !/^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i.test(body.url)) {
    return NextResponse.json({ error: 'Invalid recording URL' }, { status: 400 });
  }
  await run(
    `INSERT OR REPLACE INTO session_recordings (session_id, url, content_type, size_bytes, duration_s)
     VALUES (?, ?, ?, ?, ?)`,
    [id, body.url, body.contentType ?? 'video/webm', body.sizeBytes ?? null, body.durationS ?? null],
  );
  return NextResponse.json({ saved: true });
}
