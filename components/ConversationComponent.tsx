'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Image from 'next/image';
import AgoraRTC, {
  useRTCClient,
  useLocalMicrophoneTrack,
  useLocalCameraTrack,
  useRemoteUsers,
  useClientEvent,
  useJoin,
  usePublish,
  LocalVideoTrack,
  RemoteUser,
  UID,
} from 'agora-rtc-react';
import {
  AgoraVoiceAI,
  AgoraVoiceAIEvents,
  AgentState,
  ChatMessagePriority,
  ChatMessageType,
  MessageSalStatus,
  TranscriptHelperMode,
  type TranscriptHelperItem,
  type UserTranscription,
  type AgentTranscription,
} from 'agora-agent-client-toolkit';
import {
  AlertTriangle,
  Camera,
  CameraOff,
  MessageSquareText,
  Mic,
  MicOff,
  PhoneOff,
  SwitchCamera,
  X,
} from 'lucide-react';
import { DEFAULT_AGENT_UID } from '@/lib/agora';
import {
  getCurrentInProgressMessage,
  getMessageList,
  normalizeTimestampMs,
  normalizeTranscript,
} from '@/lib/conversation';
import type { ConnectionIssue } from './ConversationErrorCard';
import { getTranslator, type Translate } from '@/lib/i18n';
import { DialMindLogo, languageLabel, Toran } from './brand';
import { ClaimPanel, type SessionState } from './ClaimPanel';
import type { ConversationComponentProps } from '@/types/conversation';

// Cap the displayed issues list to avoid overwhelming the UI during a cascade of errors.
const MAX_CONNECTION_ISSUES = 6;

type AgoraRtcWithParameters = typeof AgoraRTC & {
  setParameter?: (key: string, value: unknown) => void;
};

// Payload shape for signaling-level errors forwarded by the agent over RTM.
type RtmMessageErrorPayload = {
  object: 'message.error';
  module?: string;
  code?: number;
  message?: string;
  send_ts?: number;
};

// Payload shape for SAL (Session Abstraction Layer) registration status messages.
type RtmSalStatusPayload = {
  object: 'message.sal_status';
  status?: string;
  timestamp?: number;
};

function isRtmMessageErrorPayload(value: unknown): value is RtmMessageErrorPayload {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { object?: unknown }).object === 'message.error'
  );
}

function isRtmSalStatusPayload(value: unknown): value is RtmSalStatusPayload {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as { object?: unknown }).object === 'message.sal_status'
  );
}

type TranscriptMessage = {
  turn_id?: string | number;
  uid: number;
  text?: string;
  createdAt?: number;
};

function formatClock(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Animated bars shown while Vanya is speaking. */
function SpeakingBars({ active }: { active: boolean }) {
  return (
    <span className="flex h-4 items-end gap-[3px]" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className={`w-[3px] rounded-full bg-[#f4a51c] ${active ? 'animate-speak' : 'h-1 opacity-60'}`}
          style={active ? { animationDelay: `${i * 120}ms` } : undefined}
        />
      ))}
    </span>
  );
}

function TranscriptList({
  messages,
  agentUID,
  firstName,
  emptyText,
}: {
  messages: TranscriptMessage[];
  agentUID: string;
  firstName: string;
  emptyText: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [messages]);

  return (
    <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4">
      {messages.length === 0 ? (
        <p className="m-auto max-w-[16rem] text-center text-sm text-white/50">
          {emptyText}
        </p>
      ) : (
        messages.map((message, index) => {
          const isAgent = String(message.uid) === agentUID;
          return (
            <article
              key={`${message.turn_id ?? message.uid}-${index}`}
              className={`flex flex-col ${isAgent ? 'items-start' : 'items-end'}`}
            >
              <span className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-white/40">
                {isAgent ? 'Vanya' : firstName}
              </span>
              <div
                className={`max-w-[92%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-[15px] leading-6 ${
                  isAgent
                    ? 'rounded-tl-sm bg-white/10 text-white'
                    : 'rounded-tr-sm bg-[#1f6b45] text-white'
                }`}
              >
                {message.text?.trim() || '…'}
              </div>
            </article>
          );
        })
      )}
    </div>
  );
}

export default function ConversationComponent({
  agoraData,
  rtmClient,
  profile,
  initialCameraOn,
  initialMicOn,
  agentJoinError,
  onTokenWillExpire,
  onEndConversation,
}: ConversationComponentProps) {
  const client = useRTCClient();
  const remoteUsers = useRemoteUsers();
  const [isMicOn, setIsMicOn] = useState(initialMicOn);
  const [isCameraOn, setIsCameraOn] = useState(initialCameraOn);
  const [facing, setFacing] = useState<'user' | 'environment'>('user');
  const [isTranscriptOpen, setIsTranscriptOpen] = useState(false);
  const [isAgentConnected, setIsAgentConnected] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  // Agora states: DISCONNECTED | CONNECTING | CONNECTED | DISCONNECTING | RECONNECTING
  const [connectionState, setConnectionState] = useState<string>('CONNECTING');
  const agentUID = String(DEFAULT_AGENT_UID);
  const avatarUID = agoraData.avatarUid;
  const [joinedUID, setJoinedUID] = useState<UID>(0);
  const firstName = profile.name.split(' ')[0];
  const t: Translate = getTranslator(profile.language);

  const [rawTranscript, setRawTranscript] = useState<
    TranscriptHelperItem<Partial<UserTranscription | AgentTranscription>>[]
  >([]);
  const [agentState, setAgentState] = useState<AgentState | null>(null);
  const [connectionIssues, setConnectionIssues] = useState<ConnectionIssue[]>([]);
  // Avatar (video) problems are not fatal: Vanya keeps talking, so show a soft note instead
  // of a technical banner.
  const [avatarFailed, setAvatarFailed] = useState(false);
  const addConnectionIssue = useCallback((issue: ConnectionIssue) => {
    console.warn('[call issue]', issue);
    traceRef.current.push({ kind: 'error', payload: { ...issue, at: Date.now() } });
    if (/^avatar\b/i.test(issue.message)) {
      setAvatarFailed(true);
      return;
    }
    setConnectionIssues((prev) => {
      const isDuplicate = prev.some(
        (x) =>
          x.agentUserId === issue.agentUserId &&
          x.code === issue.code &&
          x.message === issue.message &&
          Math.abs(x.timestamp - issue.timestamp) < 1500,
      );
      if (isDuplicate) return prev;
      return [issue, ...prev].slice(0, MAX_CONNECTION_ISSUES);
    });
  }, []);

  // ── Live claim state (filled by the interview engine as Vanya calls tools) ──
  const sessionId = agoraData.sessionId;
  const [claimState, setClaimState] = useState<SessionState | null>(null);
  const [panelTab, setPanelTab] = useState<'claim' | 'conversation'>('claim');
  useEffect(() => {
    if (!sessionId) return;
    let stopped = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/sessions/${sessionId}`, { cache: 'no-store' });
        if (res.ok && !stopped) setClaimState(await res.json());
      } catch {}
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [sessionId]);

  // ── Call trace for the claims console: buffered and sent every few seconds ──
  const traceRef = useRef<{ kind: string; payload: unknown }[]>([]);
  const trace = useCallback((kind: string, payload: unknown) => {
    traceRef.current.push({ kind, payload: { ...(payload as object), at: Date.now() } });
  }, []);
  useEffect(() => {
    if (!sessionId) return;
    const flush = (ended = false) => {
      const events = traceRef.current.splice(0);
      if (!events.length && !ended) return;
      const body = JSON.stringify({ events, ended });
      if (ended && navigator.sendBeacon) {
        navigator.sendBeacon(`/api/sessions/${sessionId}/events`, new Blob([body], { type: 'application/json' }));
      } else {
        fetch(`/api/sessions/${sessionId}/events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
        }).catch(() => {});
      }
    };
    trace('call', { event: 'started', avatar: !!agoraData.avatarUid });
    const id = setInterval(() => flush(), 4000);
    return () => {
      clearInterval(id);
      trace('call', { event: 'ended' });
      flush(true);
    };
  }, [sessionId, trace, agoraData.avatarUid]);

  // Call timer
  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  // StrictMode guard: delay `useJoin`'s ready flag until after the fake-unmount
  // cycle completes. Only the real second mount's timeout fires, so useJoin joins exactly once.
  const [isReady, setIsReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const id = setTimeout(() => {
      if (!cancelled) setIsReady(true);
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(id);
      setIsReady(false);
    };
  }, []);

  const { isConnected: joinSuccess } = useJoin(
    {
      appid: process.env.NEXT_PUBLIC_AGORA_APP_ID!,
      channel: agoraData.channel,
      token: agoraData.token,
      uid: parseInt(agoraData.uid, 10),
    },
    isReady,
  );

  // Mic track is created once (after the StrictMode cycle) and muted with setEnabled() only.
  const { localMicrophoneTrack } = useLocalMicrophoneTrack(isReady);

  // Camera track: created the first time the camera is wanted, then toggled with setEnabled().
  // It is a local preview (and the source for crop snapshots); it is not published, which
  // keeps bandwidth low on rural connections.
  const [cameraRequested, setCameraRequested] = useState(initialCameraOn);
  const { localCameraTrack, error: cameraError } = useLocalCameraTrack(
    isReady && cameraRequested,
    { facingMode: 'user', encoderConfig: '720p_1' },
  );

  // ENABLE_AUDIO_PTS is a module-level SDK parameter; set before publishing audio.
  useEffect(() => {
    if (!client) return;
    try {
      (AgoraRTC as AgoraRtcWithParameters).setParameter?.('ENABLE_AUDIO_PTS', true);
    } catch (error) {
      console.warn('Could not set ENABLE_AUDIO_PTS:', error);
    }
  }, [client]);

  // Apply the lobby's mic choice once the track exists.
  useEffect(() => {
    if (localMicrophoneTrack && !initialMicOn) {
      localMicrophoneTrack.setEnabled(false).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localMicrophoneTrack]);

  useEffect(() => {
    if (joinSuccess && client) {
      const uid = client.uid;
      if (uid !== null && uid !== undefined) setJoinedUID(uid);
    }
  }, [joinSuccess, client]);

  // Initialize AgoraVoiceAI once the channel is joined (exactly once, StrictMode-safe).
  useEffect(() => {
    if (!isReady || !joinSuccess) return;

    let cancelled = false;

    (async () => {
      try {
        const ai = await AgoraVoiceAI.init({
          rtcEngine: client,
          rtmEngine: rtmClient,
          renderMode: TranscriptHelperMode.TEXT,
          enableLog: true,
        });

        if (cancelled) {
          try {
            if (AgoraVoiceAI.getInstance() === ai) {
              ai.unsubscribe();
              ai.destroy();
            }
          } catch {}
          return;
        }

        ai.on(AgoraVoiceAIEvents.TRANSCRIPT_UPDATED, (t) => {
          setRawTranscript([...t]);
        });
        ai.on(AgoraVoiceAIEvents.AGENT_STATE_CHANGED, (_, event) => {
          setAgentState(event.state);
          trace('state', { state: event.state });
        });
        // Per-stage latency (ASR / LLM / TTS) for the claims console.
        ai.on(AgoraVoiceAIEvents.AGENT_METRICS, (_, metrics) => trace('metric', metrics));
        ai.on(AgoraVoiceAIEvents.MESSAGE_ERROR, (agentUserId, error) => {
          addConnectionIssue({
            id: `${Date.now()}-${agentUserId}-message-error-${error.code}`,
            source: 'rtm',
            agentUserId,
            code: error.code,
            message: error.message,
            timestamp: normalizeTimestampMs(error.timestamp),
          });
        });
        ai.on(AgoraVoiceAIEvents.MESSAGE_SAL_STATUS, (agentUserId, salStatus) => {
          if (
            salStatus.status === MessageSalStatus.VP_REGISTER_FAIL ||
            salStatus.status === MessageSalStatus.VP_REGISTER_DUPLICATE
          ) {
            addConnectionIssue({
              id: `${Date.now()}-${agentUserId}-sal-${salStatus.status}`,
              source: 'rtm',
              agentUserId,
              code: salStatus.status,
              message: `SAL status: ${salStatus.status}`,
              timestamp: normalizeTimestampMs(salStatus.timestamp),
            });
          }
        });
        ai.on(AgoraVoiceAIEvents.AGENT_ERROR, (agentUserId, error) => {
          addConnectionIssue({
            id: `${Date.now()}-${agentUserId}-agent-error-${error.code}`,
            source: 'agent',
            agentUserId,
            code: error.code,
            message: `${error.type}: ${error.message}`,
            timestamp: normalizeTimestampMs(error.timestamp),
          });
        });
        ai.subscribeMessage(agoraData.channel);
      } catch (error) {
        if (!cancelled) console.error('[AgoraVoiceAI] init failed:', error);
      }
    })();

    return () => {
      cancelled = true;
      try {
        const ai = AgoraVoiceAI.getInstance();
        if (ai) {
          ai.unsubscribe();
          ai.destroy();
        }
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, joinSuccess]);

  // Raw RTM parsing as a fallback for signaling-level errors and SAL status.
  useEffect(() => {
    const handleRtmMessage = (event: { message: string | Uint8Array; publisher: string }) => {
      const payloadText =
        typeof event.message === 'string' ? event.message : new TextDecoder().decode(event.message);
      let parsed: unknown;
      try {
        parsed = JSON.parse(payloadText);
      } catch {
        return;
      }
      if (isRtmMessageErrorPayload(parsed)) {
        addConnectionIssue({
          id: `${Date.now()}-${event.publisher}-rtm-msg-error-${parsed.code ?? 'unknown'}`,
          source: 'rtm-signaling',
          agentUserId: event.publisher,
          code: parsed.code ?? 'unknown',
          message: `${parsed.module ?? 'unknown'}: ${parsed.message ?? 'Unknown signaling error'}`,
          timestamp: normalizeTimestampMs(parsed.send_ts ?? Date.now()),
        });
        return;
      }
      if (
        isRtmSalStatusPayload(parsed) &&
        (parsed.status === 'VP_REGISTER_FAIL' || parsed.status === 'VP_REGISTER_DUPLICATE')
      ) {
        addConnectionIssue({
          id: `${Date.now()}-${event.publisher}-rtm-sal-${parsed.status}`,
          source: 'rtm-signaling',
          agentUserId: event.publisher,
          code: parsed.status,
          message: `SAL status: ${parsed.status}`,
          timestamp: normalizeTimestampMs(parsed.timestamp ?? Date.now()),
        });
      }
    };
    rtmClient.addEventListener('message', handleRtmMessage);
    return () => rtmClient.removeEventListener('message', handleRtmMessage);
  }, [rtmClient, addConnectionIssue]);

  // The toolkit uses uid="0" for local user speech — remap to the actual RTC UID.
  const transcript = useMemo(
    () => normalizeTranscript(rawTranscript, String(client.uid)),
    [rawTranscript, client.uid],
  );
  // Completed (END + INTERRUPTED) messages; INTERRUPTED must stay or the first cut-off turn vanishes.
  const messageList = useMemo(() => getMessageList(transcript), [transcript]);
  const currentInProgressMessage = useMemo(
    () => getCurrentInProgressMessage(transcript),
    [transcript],
  );
  const allMessages = useMemo<TranscriptMessage[]>(
    () =>
      currentInProgressMessage ? [...messageList, currentInProgressMessage] : messageList,
    [messageList, currentInProgressMessage],
  );

  // Trace each completed turn once.
  const tracedTurnsRef = useRef(0);
  useEffect(() => {
    for (const m of messageList.slice(tracedTurnsRef.current)) {
      trace('transcript', {
        speaker: String(m.uid) === agentUID ? 'agent' : 'farmer',
        text: m.text,
        turn_id: m.turn_id,
      });
    }
    tracedTurnsRef.current = messageList.length;
  }, [messageList, agentUID, trace]);

  // Live captions: Vanya's latest line, plus the farmer's words while they speak.
  const captions = useMemo(() => {
    const lastAgent = [...allMessages].reverse().find((m) => String(m.uid) === agentUID);
    const userLive =
      currentInProgressMessage && String(currentInProgressMessage.uid) !== agentUID
        ? currentInProgressMessage.text?.trim()
        : undefined;
    return { agent: lastAgent?.text?.trim(), user: userLive };
  }, [allMessages, currentInProgressMessage, agentUID]);

  // Publish the mic only; usePublish waits for the RTC connection.
  usePublish([localMicrophoneTrack]);

  const avatarUser = useMemo(
    () => (avatarUID ? remoteUsers.find((u) => String(u.uid) === avatarUID) : undefined),
    [remoteUsers, avatarUID],
  );
  const hasAvatarVideo = !!avatarUser?.hasVideo;
  // With an avatar, Vanya's lip-synced audio comes from the avatar UID; avoid double audio.
  const avatarCarriesAudio = !!avatarUser?.hasAudio;

  useClientEvent(client, 'user-joined', (user) => {
    if (user.uid.toString() === agentUID) setIsAgentConnected(true);
  });
  useClientEvent(client, 'user-left', (user) => {
    if (user.uid.toString() === agentUID) setIsAgentConnected(false);
  });
  useEffect(() => {
    setIsAgentConnected(remoteUsers.some((user) => user.uid.toString() === agentUID));
  }, [remoteUsers, agentUID]);

  useClientEvent(client, 'connection-state-change', (curState) => {
    setConnectionState(curState);
  });

  const handleMicToggle = useCallback(async () => {
    const next = !isMicOn;
    try {
      await localMicrophoneTrack?.setEnabled(next);
      setIsMicOn(next);
    } catch (error) {
      console.error('Failed to toggle microphone:', error);
    }
  }, [isMicOn, localMicrophoneTrack]);

  const handleCameraToggle = useCallback(async () => {
    const next = !isCameraOn;
    if (next && !cameraRequested) {
      setCameraRequested(true);
      setIsCameraOn(true);
      return;
    }
    try {
      await localCameraTrack?.setEnabled(next);
      setIsCameraOn(next);
    } catch (error) {
      console.error('Failed to toggle camera:', error);
    }
  }, [isCameraOn, cameraRequested, localCameraTrack]);

  // Phones: switch to the back camera to show the damaged crop.
  const handleFlipCamera = useCallback(async () => {
    if (!localCameraTrack) return;
    const next = facing === 'user' ? 'environment' : 'user';
    try {
      await localCameraTrack.setDevice({ facingMode: next } as never);
      setFacing(next);
    } catch (error) {
      console.error('Failed to switch camera:', error);
    }
  }, [facing, localCameraTrack]);

  // Development-only test hook: lets automated tests "speak" by sending text to Vanya.
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development' || !joinSuccess) return;
    (window as unknown as { __dialmind?: unknown }).__dialmind = {
      sendText: (text: string) =>
        AgoraVoiceAI.getInstance().sendText(agentUID, {
          messageType: ChatMessageType.TEXT,
          priority: ChatMessagePriority.INTERRUPTED,
          responseInterruptable: true,
          text,
        }),
    };
  }, [joinSuccess, agentUID]);

  const handleTokenWillExpire = useCallback(async () => {
    if (!onTokenWillExpire || !joinedUID) return;
    try {
      const { rtcToken, rtmToken } = await onTokenWillExpire(joinedUID.toString());
      await client?.renewToken(rtcToken);
      await rtmClient.renewToken(rtmToken);
    } catch (error) {
      console.error('Failed to renew Agora token:', error);
    }
  }, [client, onTokenWillExpire, joinedUID, rtmClient]);

  useClientEvent(client, 'token-privilege-will-expire', handleTokenWillExpire);

  const isSpeaking = agentState === 'speaking';
  const statusText =
    connectionState === 'RECONNECTING'
      ? t('statusReconnecting')
      : !isAgentConnected
        ? t('statusJoining')
        : agentState === 'thinking'
          ? t('statusThinking')
          : agentState === 'listening'
            ? t('statusListening')
            : isSpeaking
              ? t('statusSpeaking')
              : t('statusConnected');
  const showCameraPreview = isCameraOn && !!localCameraTrack && !cameraError;
  const latestIssue = connectionIssues[0];

  return (
    <div className="fixed inset-0 flex flex-col bg-[#120e0a] text-white">
      <Toran className="h-[22px] opacity-90" />
      {/* Top bar */}
      <header className="z-20 flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <DialMindLogo tone="light" className="[&_span]:hidden sm:[&_span]:inline" />
        <div className="flex items-center gap-2 rounded-full bg-white/10 px-3 py-1.5 text-sm backdrop-blur-md">
          <span
            className={`h-2 w-2 rounded-full ${
              connectionState === 'CONNECTED' ? 'bg-[#5ee39a]' : 'animate-pulse bg-amber-400'
            }`}
          />
          <span className="font-medium tabular-nums">{formatClock(elapsed)}</span>
          <span className="hidden text-white/60 sm:inline">· {t('cropClaim')}</span>
        </div>
        <span className="rounded-full bg-white/10 px-3 py-1.5 text-sm backdrop-blur-md">
          {languageLabel(profile.language)}
        </span>
      </header>

      <div className="relative flex min-h-0 flex-1 gap-4 px-0 pb-0 sm:px-4 sm:pb-4 lg:px-6">
        {/* Stage */}
        <section className="relative min-h-0 flex-1 overflow-hidden bg-black sm:rounded-3xl">
          {/* Media layer. Agora's player sets its own z-index, so isolate it in a bottom layer
              that never takes clicks; all overlays and controls sit above it. */}
          <div className="pointer-events-none absolute inset-0 isolate z-0">
          {/* Poster shown until the avatar's video arrives */}
          <Image
            src="/vanya.jpg"
            alt=""
            fill
            priority
            sizes="100vw"
            className={`object-cover object-[50%_30%] transition-all duration-700 ${
              hasAvatarVideo ? 'opacity-0' : 'scale-105 opacity-60 blur-sm'
            }`}
          />
          {avatarUser && (
            <RemoteUser
              user={avatarUser}
              playVideo
              playAudio
              videoPlayerConfig={{ fit: 'cover' }}
              className={`!absolute inset-0 !h-full !w-full transition-opacity duration-700 ${
                hasAvatarVideo ? 'opacity-100' : 'opacity-0'
              }`}
            />
          )}
          </div>

          {/* Agent audio (used when the avatar is off or not publishing audio) */}
          {remoteUsers
            .filter((u) => String(u.uid) !== avatarUID)
            .map((user) => (
              <div key={user.uid} className="hidden">
                <RemoteUser
                  user={user}
                  playVideo={false}
                  playAudio={String(user.uid) === agentUID ? !avatarCarriesAudio : true}
                />
              </div>
            ))}

          {!hasAvatarVideo && (
            <div className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3">
              <div className="relative">
                <span className="absolute inset-0 animate-ping rounded-full bg-[#f4a51c]/35" />
                <div className="relative h-24 w-24 overflow-hidden rounded-full ring-4 ring-[#f4a51c]/70">
                  <Image src="/vanya.jpg" alt="Vanya" fill sizes="6rem" className="object-cover object-[50%_30%]" />
                </div>
              </div>
              <p className="rounded-full bg-black/40 px-4 py-1.5 text-sm backdrop-blur-md">
                {avatarFailed ? t('avatarUnavailable') : avatarUID ? t('connectingVideo') : statusText}
              </p>
            </div>
          )}

          {/* Gradient for legibility of captions and controls */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-56 bg-gradient-to-t from-black/80 to-transparent" />

          {/* Name tag */}
          <div className="absolute left-4 top-4 z-20 flex items-center gap-2 rounded-full bg-black/45 py-1.5 pl-3 pr-4 text-sm backdrop-blur-md sm:left-5 sm:top-5">
            <SpeakingBars active={isSpeaking} />
            <span className="font-semibold text-[#f4c451]">Vanya</span>
            <span className="hidden text-white/60 sm:inline">· DialMind</span>
            <span className="text-white/60">· {statusText}</span>
          </div>

          {/* Self view (picture-in-picture) */}
          <div className="absolute right-3 top-3 isolate z-20 h-36 w-24 overflow-hidden rounded-2xl bg-[#1c160f] shadow-2xl ring-1 ring-white/20 sm:right-5 sm:top-auto sm:bottom-28 sm:h-40 sm:w-64 lg:bottom-32 lg:h-44 lg:w-72">
            {showCameraPreview ? (
              <LocalVideoTrack
                track={localCameraTrack}
                play
                videoPlayerConfig={{ mirror: facing === 'user', fit: 'cover' }}
                className="h-full w-full"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-1">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#1f6b45] text-xl font-bold">
                  {firstName.charAt(0).toUpperCase()}
                </div>
                {cameraError && <p className="px-2 text-center text-[10px] text-white/60">{t('cameraUnavailable')}</p>}
              </div>
            )}
            <span className="absolute bottom-1.5 left-2 flex items-center gap-1 rounded-full bg-black/50 px-2 py-0.5 text-[11px]">
              {!isMicOn && <MicOff className="h-3 w-3 text-[#ff8a80]" />}
              {firstName}
            </span>
          </div>

          {/* Captions */}
          <div className="pointer-events-none absolute inset-x-3 bottom-28 z-20 flex flex-col items-center gap-2 sm:bottom-28 sm:left-6 sm:right-[18rem] lg:right-[20rem]">
            {captions.agent && (
              <p className="line-clamp-3 max-w-2xl rounded-2xl bg-black/55 px-4 py-2.5 text-center text-base leading-snug backdrop-blur-md sm:text-lg">
                {captions.agent}
              </p>
            )}
            {captions.user && (
              <p className="line-clamp-2 max-w-xl rounded-2xl bg-[#1f6b45]/80 px-3 py-1.5 text-center text-sm backdrop-blur-md">
                {captions.user}
              </p>
            )}
          </div>

          {/* Warnings */}
          {(agentJoinError || latestIssue) && (
            <div className="absolute left-1/2 top-16 z-30 flex max-w-[90%] -translate-x-1/2 items-center gap-2 rounded-xl bg-amber-500/90 px-3 py-2 text-sm text-black sm:top-5">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span className="line-clamp-2">
                {agentJoinError
                  ? t('agentJoinError')
                  : t('connectionIssue', { message: latestIssue?.message ?? '' })}
              </span>
            </div>
          )}

          {/* Controls */}
          <nav
            className="absolute inset-x-0 bottom-0 z-40 flex items-center justify-center gap-3 px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:gap-4"
            aria-label="Call controls"
          >
            <button
              onClick={handleMicToggle}
              aria-label={isMicOn ? t('mute') : t('unmute')}
              className={`flex h-14 w-14 items-center justify-center rounded-full transition ${
                isMicOn ? 'bg-white/15 hover:bg-white/25' : 'bg-[#d92d20] hover:bg-[#b42318]'
              } backdrop-blur-md`}
            >
              {isMicOn ? <Mic className="h-6 w-6" /> : <MicOff className="h-6 w-6" />}
            </button>
            <button
              onClick={handleCameraToggle}
              aria-label={isCameraOn ? t('camOff') : t('camOn')}
              className={`flex h-14 w-14 items-center justify-center rounded-full transition ${
                isCameraOn ? 'bg-white/15 hover:bg-white/25' : 'bg-[#d92d20] hover:bg-[#b42318]'
              } backdrop-blur-md`}
            >
              {isCameraOn ? <Camera className="h-6 w-6" /> : <CameraOff className="h-6 w-6" />}
            </button>
            {showCameraPreview && (
              <button
                onClick={handleFlipCamera}
                aria-label={t('flipCamera')}
                className="flex h-14 w-14 items-center justify-center rounded-full bg-white/15 backdrop-blur-md transition hover:bg-white/25 lg:hidden"
              >
                <SwitchCamera className="h-6 w-6" />
              </button>
            )}
            <button
              onClick={() => setIsTranscriptOpen((v) => !v)}
              aria-label={t('showConversation')}
              aria-pressed={isTranscriptOpen}
              className="flex h-14 w-14 items-center justify-center rounded-full bg-white/15 backdrop-blur-md transition hover:bg-white/25 lg:hidden"
            >
              <MessageSquareText className="h-6 w-6" />
            </button>
            <button
              onClick={onEndConversation}
              aria-label={t('endCall')}
              className="flex h-14 items-center gap-2 rounded-full bg-[#d92d20] px-6 font-semibold transition hover:bg-[#b42318]"
            >
              <PhoneOff className="h-6 w-6" />
              <span className="hidden sm:inline">{t('endCall')}</span>
            </button>
          </nav>
        </section>

        {/* Conversation panel: side rail on desktop, bottom sheet on phones */}
        <aside
          className={`${
            isTranscriptOpen ? 'flex' : 'hidden'
          } absolute inset-x-0 bottom-0 z-30 h-[70%] flex-col rounded-t-3xl bg-[#1c1610]/95 backdrop-blur-xl lg:static lg:flex lg:h-auto lg:w-96 lg:rounded-3xl lg:bg-[#1c1610]`}
          aria-label={t('conversation')}
        >
          <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2.5">
            <div className="flex rounded-full bg-white/5 p-1" role="tablist">
              {(['claim', 'conversation'] as const).map((tab) => (
                <button
                  key={tab}
                  role="tab"
                  aria-selected={panelTab === tab}
                  onClick={() => setPanelTab(tab)}
                  className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition ${
                    panelTab === tab ? 'bg-[#f4a51c] text-[#2a1a05]' : 'text-white/70 hover:text-white'
                  }`}
                >
                  {tab === 'claim' ? t('claimTab') : t('conversation')}
                </button>
              ))}
            </div>
            <button
              onClick={() => setIsTranscriptOpen(false)}
              aria-label={t('closeConversation')}
              className="rounded-full p-2 hover:bg-white/10 lg:hidden"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {panelTab === 'claim' ? (
            <ClaimPanel state={claimState} t={t} lang={profile.language} />
          ) : (
            <TranscriptList
              messages={allMessages}
              agentUID={agentUID}
              firstName={firstName}
              emptyText={t('transcriptEmpty')}
            />
          )}
        </aside>
      </div>
    </div>
  );
}
