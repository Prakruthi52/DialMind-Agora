import {
  AgoraClient,
  Agent,
  AnamAvatar,
  Area,
  AresSTT,
  MurfTTS,
  OpenAI,
  generateConvoAIToken,
} from 'agora-agents';
import { DEFAULT_AGENT_UID, DEFAULT_AVATAR_UID } from '@/lib/agora';

// The first avatar start after a quiet period often times out on the Agora → Anam handoff
// (~30 s, 400 ErrInternal); starts right after that succeed in ~2 s. The lobby triggers a
// throwaway avatar session to absorb that cold start while the farmer reads the lobby.
//
// Anam's free plan allows one concurrent session, so a real call must never start while the
// warm-up is still running: /api/invite-agent awaits `waitForAvatarWarmup()` first.
//
// State lives on globalThis because Next.js bundles each route separately (module-level
// variables would not be shared between /api/warmup and /api/invite-agent).

const WARM_FOR_MS = 4 * 60 * 1000;
// Pause after the warm-up session stops so Anam has released it before the real call.
const RELEASE_GRACE_MS = 2500;

type WarmState = { lastWarmAt: number; inFlight: Promise<void> | null };
const g = globalThis as typeof globalThis & { __avatarWarm?: WarmState };
const state: WarmState = (g.__avatarWarm ??= { lastWarmAt: 0, inFlight: null });

// Stock Anam avatar used if NEXT_ANAM_AVATAR_ID is missing or malformed (e.g. clipped when pasted).
const FALLBACK_AVATAR_ID = 'a7eb25e8-8c31-460d-a397-8cd8010c76d1';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The configured avatar ID, validated. A typo would otherwise fail silently inside Anam. */
export function anamAvatarId(): string {
  const id = (process.env.NEXT_ANAM_AVATAR_ID ?? '').trim();
  if (UUID_RE.test(id)) return id;
  console.warn(`NEXT_ANAM_AVATAR_ID "${id}" is not a valid avatar ID; using the stock avatar instead.`);
  return FALLBACK_AVATAR_ID;
}

export function isAvatarEnabled(): boolean {
  return process.env.NEXT_ENABLE_AVATAR !== 'false' && !!process.env.NEXT_ANAM_API_KEY;
}

async function runWarmup(): Promise<void> {
  const appId = process.env.NEXT_PUBLIC_AGORA_APP_ID!;
  const appCertificate = process.env.NEXT_AGORA_APP_CERTIFICATE!;
  const channel = `warmup-${Date.now()}`;
  const client = new AgoraClient({ area: Area.US, appId, appCertificate });

  const session = new Agent({ client, instructions: 'Warm-up session. Stay silent.' })
    .withStt(new AresSTT())
    .withLlm(new OpenAI({ model: 'gpt-4o-mini' }))
    .withTts(
      new MurfTTS({
        key: process.env.NEXT_MURF_API_KEY!,
        voiceId: process.env.NEXT_MURF_VOICE_ID ?? 'hi-IN-poonam',
        model: 'FALCON',
        sampleRate: 24000,
      }),
    )
    .withAvatar(
      new AnamAvatar({
        apiKey: process.env.NEXT_ANAM_API_KEY!,
        avatarId: anamAvatarId(),
        additionalParams: {
          agora_uid: String(DEFAULT_AVATAR_UID),
          agora_token: generateConvoAIToken({
            appId,
            appCertificate,
            channelName: channel,
            uid: DEFAULT_AVATAR_UID,
            tokenExpire: 300,
          }),
          sample_rate: 24000,
          avatar_model: process.env.NEXT_ANAM_AVATAR_MODEL ?? 'cara-4',
        },
      }),
    )
    .createSession({
      channel,
      agentUid: String(DEFAULT_AGENT_UID),
      remoteUids: ['1'],
      idleTimeout: 5,
    });

  await session.start();
  await session.stop().catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, RELEASE_GRACE_MS));
}

/** Starts a warm-up unless one ran recently or is running. Returns the in-flight promise, if any. */
export function startAvatarWarmup(): { status: 'skipped' | 'warm' | 'warming'; pending: Promise<void> | null } {
  if (!isAvatarEnabled()) return { status: 'skipped', pending: null };
  if (Date.now() - state.lastWarmAt < WARM_FOR_MS && !state.inFlight) {
    return { status: 'warm', pending: null };
  }
  if (!state.inFlight) {
    state.inFlight = runWarmup()
      .catch((error) => {
        // A failed cold start still warms the path.
        console.warn('Avatar warm-up failed (the next start will likely succeed):', error);
      })
      .finally(() => {
        state.lastWarmAt = Date.now();
        state.inFlight = null;
      });
  }
  return { status: 'warming', pending: state.inFlight };
}

/** Resolves once no warm-up session is running, so the real call never overlaps it. */
export async function waitForAvatarWarmup(): Promise<void> {
  if (state.inFlight) await state.inFlight;
}
