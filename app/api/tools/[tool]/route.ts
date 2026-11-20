import { NextRequest, NextResponse } from 'next/server';
import { run } from '@/lib/db';
import {
  correctAnswer,
  fileClaim,
  getClaimStatus,
  getCurrentQuestion,
  setLanguage,
  submitAnswer,
  type ToolResult,
} from '@/lib/engine/flow';
import { isLanguageCode } from '@/lib/vanya';

// Endpoint Agora's cloud calls for every tool the LLM uses (see lib/tools.ts).

/** Agora leaves unfilled optional placeholders as literal "{{args.x}}" strings. */
function arg(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const s = String(value).trim();
  return !s || s.startsWith('{{') ? undefined : s;
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ tool: string }> }) {
  const { tool } = await params;
  const started = Date.now();

  const secret = process.env.TOOL_SECRET;
  if (!secret || request.headers.get('x-tool-secret') !== secret) {
    return NextResponse.json({ result: 'error', instruction: 'Unauthorized tool call.' }, { status: 401 });
  }
  const sessionId = request.headers.get('x-session-id') ?? '';
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  let result: ToolResult;
  try {
    switch (tool) {
      case 'getCurrentQuestion':
        result = await getCurrentQuestion(sessionId);
        break;
      case 'submitAnswer':
        result = await submitAnswer(sessionId, arg(body.raw_answer) ?? '');
        break;
      case 'submitInterpretation':
        result = await submitAnswer(sessionId, arg(body.raw_answer) ?? '', arg(body.interpreted_value));
        break;
      case 'correctAnswer':
        result = await correctAnswer(sessionId, arg(body.question_code) ?? '', arg(body.raw_answer) ?? '');
        break;
      case 'setLanguage': {
        const lang = arg(body.language);
        result = isLanguageCode(lang)
          ? await setLanguage(sessionId, lang)
          : { result: 'error', instruction: 'language must be hi, kn or en.' };
        break;
      }
      case 'fileClaim':
        result = await fileClaim(
          sessionId,
          body.confirmed === true || arg(body.confirmed) === 'true',
          arg(body.farmer_words) ?? '',
        );
        break;
      case 'getClaimStatus':
        result = await getClaimStatus(arg(body.claim_id_or_mobile) ?? '');
        break;
      default:
        result = { result: 'error', instruction: `Unknown tool ${tool}.` };
    }
  } catch (error) {
    console.error(`Tool ${tool} failed:`, error);
    result = {
      result: 'error',
      instruction: 'Something went wrong on our side. Apologise briefly and try the same step once more.',
    };
  }

  // Trace for the claims console; never block the reply on logging.
  if (sessionId) {
    run('INSERT INTO tool_calls (session_id, tool, args, result, duration_ms) VALUES (?, ?, ?, ?, ?)', [
      sessionId,
      tool,
      JSON.stringify(body),
      JSON.stringify(result),
      Date.now() - started,
    ]).catch((e) => console.warn('tool_calls log failed', e));
  }
  return NextResponse.json(result);
}
