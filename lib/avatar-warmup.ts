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
import { getDb, queryOne } from '@/lib/db';

// The first avatar start after a quiet period often times out on the Agora → Anam handoff
// (~30 s, 400 ErrInternal); starts right after that succeed in ~2 s. The lobby triggers a
// throwaway avatar session to absorb that cold start while the farmer reads the lobby.
//
// Anam's free plan allows one concurrent session, so a real call must never start while the
// warm-up is still running: /api/invite-agent awaits `waitForAvatarWarmup()` first.
//
// The lock lives in the database (table app_locks), not in memory: on Vercel, /api/warmup and
// /api/invite-agent run as separate serverless instances that share no memory.

const LOCK_KEY = 'avatar';
const WARM_FOR_MS = 4 * 60 * 1000;
// Longest a warm-up may hold the lock (a cold start fails after ~30 s).
const WARMUP_MAX_MS = 45 * 1000;
// Pause after the warm-up session stops so Anam has released it before the real call.
const RELEASE_GRACE_MS = 2500;

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

type LockRow = { busy_until_ms: number; last_warm_ms: number };

async function readLock(): Promise<LockRow> {
  const row = await queryOne<LockRow>(
    'SELECT busy_until_ms, last_warm_ms FROM app_locks WHERE key = ?',
    [LOCK_KEY],
  );
  return { busy_until_ms: Number(row?.busy_until_ms ?? 0), last_warm_ms: Number(row?.last_warm_ms ?? 0) };
}

/** Atomically takes the warm-up lock; false if another instance holds it. */
async function claimLock(now: number): Promise<boolean> {
  const db = await getDb();
  const result = await db.execute({
    sql: `INSERT INTO app_locks (key, busy_until_ms, last_warm_ms) VALUES (?, ?, 0)
          ON CONFLICT(key) DO UPDATE SET busy_until_ms = excluded.busy_until_ms
          WHERE app_locks.busy_until_ms < ?`,
    args: [LOCK_KEY, now + WARMUP_MAX_MS, now],
  });
  return result.rowsAffected > 0;
}

/** Records that the avatar path is warm (after a warm-up or a successful real start). */
export async function markAvatarWarm(): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.execute({
    sql: `INSERT INTO app_locks (key, busy_until_ms, last_warm_ms) VALUES (?, 0, ?)
          ON CONFLICT(key) DO UPDATE SET busy_until_ms = 0, last_warm_ms = excluded.last_warm_ms`,
    args: [LOCK_KEY, now],
  });
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

/**
 * Starts a warm-up unless the path is already warm or another instance is warming it.
 * Returns the in-flight promise when this instance started one (keep the function alive for it).
 */
export async function startAvatarWarmup(): Promise<{
  status: 'skipped' | 'warm' | 'warming';
  pending: Promise<void> | null;
}> {
  if (!isAvatarEnabled()) return { status: 'skipped', pending: null };
  const now = Date.now();
  const lock = await readLock();
  if (lock.busy_until_ms > now) return { status: 'warming', pending: null };
  if (now - lock.last_warm_ms < WARM_FOR_MS) return { status: 'warm', pending: null };
  if (!(await claimLock(now))) return { status: 'warming', pending: null };

  const pending = runWarmup()
    .catch((error) => {
      // A failed cold start still warms the path.
      console.warn('Avatar warm-up failed (the next start will likely succeed):', error);
    })
    .finally(() => markAvatarWarm().catch(() => {}));
  return { status: 'warming', pending };
}

/**
 * Resolves once no warm-up holds Anam's session (checked across instances), or after
 * `maxWaitMs` so a stuck warm-up can never block a call for long.
 */
export async function waitForAvatarWarmup(maxWaitMs = 40_000): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const lock = await readLock().catch(() => ({ busy_until_ms: 0, last_warm_ms: 0 }));
    if (lock.busy_until_ms <= Date.now()) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
