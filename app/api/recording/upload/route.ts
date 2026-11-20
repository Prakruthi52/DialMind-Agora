import { NextResponse } from 'next/server';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { queryOne } from '@/lib/db';

// Issues short-lived upload tokens so the browser can upload the call recording straight to
// Vercel Blob (recordings are too large for a serverless request body).
export async function POST(request: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: 'Recording storage not configured' }, { status: 501 });
  }
  const body = (await request.json()) as HandleUploadBody;
  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        // pathname: recordings/<sessionId>.webm, only for real sessions.
        const sessionId = pathname.match(/^recordings\/([0-9a-f-]{36})\.(webm|mp4)$/)?.[1];
        if (!sessionId || !(await queryOne('SELECT id FROM sessions WHERE id = ?', [sessionId]))) {
          throw new Error('Unknown session');
        }
        return {
          allowedContentTypes: ['video/webm', 'video/mp4', 'audio/webm'],
          maximumSizeInBytes: 200 * 1024 * 1024,
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {
        // The browser registers the URL itself (this callback cannot reach localhost).
      },
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Upload failed' }, { status: 400 });
  }
}
