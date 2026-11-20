'use client';

import { useState, useRef, Suspense, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import type { RTMClient } from 'agora-rtm';
import type {
  AgoraTokenData,
  ClientStartRequest,
  AgentResponse,
  AgoraRenewalTokens,
  FarmerProfile,
} from '../types/conversation';
import { ErrorBoundary } from './ErrorBoundary';
import { LoadingSkeleton } from './LoadingSkeleton';
import { LoginScreen } from './LoginScreen';
import { LobbyScreen } from './LobbyScreen';
import { CallEndedScreen } from './CallEndedScreen';

// Dynamically import the ConversationComponent with ssr disabled
const ConversationComponent = dynamic(() => import('./ConversationComponent'), {
  ssr: false,
});

// Dynamically import AgoraRTCProvider (browser-only).
// The AgoraVoiceAI toolkit is initialized inside ConversationComponent after
// the RTC join succeeds, so this wrapper only needs to provide the RTC client.
const AgoraProvider = dynamic(
  async () => {
    const { AgoraRTCProvider, default: AgoraRTC } =
      await import('agora-rtc-react');
    return {
      default: function AgoraProviders({
        children,
      }: {
        children: React.ReactNode;
      }) {
        // useRef persists across StrictMode's simulated unmount/remount, so only
        // one RTC client is ever created per session (useMemo creates two in StrictMode).
        const clientRef = useRef<ReturnType<
          typeof AgoraRTC.createClient
        > | null>(null);
        if (!clientRef.current) {
          clientRef.current = AgoraRTC.createClient({
            mode: 'rtc',
            codec: 'vp8',
          });
        }
        return (
          <AgoraRTCProvider client={clientRef.current}>
            {children}
          </AgoraRTCProvider>
        );
      },
    };
  },
  { ssr: false },
);

type Stage = 'login' | 'lobby' | 'call' | 'ended';

const PROFILE_KEY = 'dialmind.profile';

function loadProfile(): FarmerProfile | null {
  try {
    const raw = window.localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FarmerProfile;
    return parsed?.name && parsed?.mobile && parsed?.language ? parsed : null;
  } catch {
    return null;
  }
}

function saveProfile(profile: FarmerProfile | null) {
  try {
    if (profile) window.localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    else window.localStorage.removeItem(PROFILE_KEY);
  } catch {}
}

export default function LandingPage() {
  const [stage, setStage] = useState<Stage>('login');
  const [profile, setProfile] = useState<FarmerProfile | null>(null);
  const [mediaPrefs, setMediaPrefs] = useState({ camera: true, mic: true });
  const [callSeconds, setCallSeconds] = useState(0);

  // Restore a remembered sign-in and preload heavy modules so "Start call" is fast.
  useEffect(() => {
    const saved = loadProfile();
    if (saved) {
      setProfile(saved);
      setStage('lobby');
    }
    import('agora-rtc-react').catch(() => {});
    import('agora-rtm').catch(() => {});
  }, []);

  // Keep <html lang> in sync with the chosen language (fonts, screen readers).
  useEffect(() => {
    if (profile) document.documentElement.lang = profile.language;
  }, [profile]);

  // Warm the avatar path whenever the lobby opens, so "Start video call" connects quickly.
  useEffect(() => {
    if (stage === 'lobby') fetch('/api/warmup', { method: 'POST' }).catch(() => {});
  }, [stage]);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [agoraData, setAgoraData] = useState<AgoraTokenData | null>(null);
  const [rtmClient, setRtmClient] = useState<RTMClient | null>(null);
  const [agentJoinError, setAgentJoinError] = useState(false);
  const callStartRef = useRef<number>(0);
  // Pending agent start, so ending the call early can still stop the agent once it is up.
  const invitePromiseRef = useRef<Promise<AgentResponse | null> | null>(null);

  const handleLogin = (next: FarmerProfile) => {
    setProfile(next);
    saveProfile(next);
    setStage('lobby');
  };

  const handleSignOut = () => {
    saveProfile(null);
    setProfile(null);
    setStage('login');
  };

  const handleLanguageChange = (language: FarmerProfile['language']) => {
    if (!profile) return;
    const next = { ...profile, language };
    setProfile(next);
    saveProfile(next);
  };

  const handleStartConversation = async (prefs: { camera: boolean; mic: boolean }) => {
    if (!profile) return;
    setMediaPrefs(prefs);
    setIsLoading(true);
    setError(null);
    setAgentJoinError(false);

    try {
      // 1. Fetch RTC token + channel
      const agoraResponse = await fetch('/api/generate-agora-token');
      const responseData = await agoraResponse.json();

      if (!agoraResponse.ok) {
        throw new Error(
          `Failed to generate Agora token: ${JSON.stringify(responseData)}`,
        );
      }

      // 2. Start the agent in the background. Agent start can take a few seconds (longer if the
      //    avatar provider is slow), so the call screen opens as soon as RTM is ready and the
      //    agent joins when it is up. Agent invite failure is non-fatal.
      const invitePromise = fetch('/api/invite-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requester_id: responseData.uid,
          channel_name: responseData.channel,
          language: profile.language,
          farmer_name: profile.name,
          farmer_mobile: profile.mobile,
        } as ClientStartRequest),
      })
        .then(async (res) => {
          if (!res.ok) {
            console.warn('Agent start failed:', await res.text());
            return null;
          }
          return res.json() as Promise<AgentResponse>;
        })
        .catch((err) => {
          console.warn('Failed to start conversation with agent:', err);
          return null;
        });
      invitePromiseRef.current = invitePromise;

      // 3. RTM must be ready before ConversationComponent mounts so AgoraVoiceAI can subscribe.
      const { default: AgoraRTM } = await import('agora-rtm');
      const rtm: RTMClient = new AgoraRTM.RTM(
        process.env.NEXT_PUBLIC_AGORA_APP_ID!,
        responseData.uid,
      );
      await rtm.login({ token: responseData.token });
      await rtm.subscribe(responseData.channel);

      // 4. Show the call now; fill in the agent / avatar IDs when the invite returns.
      setRtmClient(rtm);
      setAgoraData({ ...responseData });
      callStartRef.current = Date.now();
      setStage('call');

      invitePromise.then((agentData) => {
        if (invitePromiseRef.current !== invitePromise) return; // call already ended
        if (!agentData) {
          setAgentJoinError(true);
          return;
        }
        setAgoraData((prev) =>
          prev
            ? {
                ...prev,
                agentId: agentData.agent_id,
                avatarUid: agentData.avatar_uid,
                sessionId: agentData.session_id,
              }
            : prev,
        );
      });
    } catch (err) {
      setError('Could not start the call. Please check your internet and try again.');
      console.error('Error starting conversation:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTokenWillExpire = useCallback(
    async (uid: string): Promise<AgoraRenewalTokens> => {
      const channel = agoraData?.channel;
      if (!channel) {
        throw new Error('Missing channel for token renewal');
      }

      // RTC and RTM tokens are renewed independently:
      //   - RTC uses the browser client's assigned UID (passed in from ConversationComponent).
      //   - RTM uses the same UID that was used during RTM login (agoraData.uid).
      const [rtcResponse, rtmResponse] = await Promise.all([
        fetch(`/api/generate-agora-token?channel=${channel}&uid=${uid}`),
        fetch(`/api/generate-agora-token?channel=${channel}&uid=${agoraData.uid}`),
      ]);
      const [rtcData, rtmData] = await Promise.all([
        rtcResponse.json(),
        rtmResponse.json(),
      ]);

      if (!rtcResponse.ok || !rtmResponse.ok) {
        throw new Error('Failed to generate renewal tokens');
      }

      return {
        rtcToken: rtcData.token,
        rtmToken: rtmData.token,
      };
    },
    [agoraData],
  );

  const handleEndConversation = async () => {
    const stopAgent = (agentId: string) =>
      fetch('/api/stop-conversation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: agentId }),
      })
        .then(async (response) => {
          if (!response.ok) console.error('Failed to stop agent:', await response.text());
        })
        .catch((error) => console.error('Error stopping agent:', error));

    // Stop the agent in the background; if it is still starting, stop it once it is up.
    const pending = invitePromiseRef.current;
    invitePromiseRef.current = null;
    if (agoraData?.agentId) {
      stopAgent(agoraData.agentId);
    } else {
      pending?.then((agentData) => {
        if (agentData?.agent_id) stopAgent(agentData.agent_id);
      });
    }

    // Tear down RTM — owned here since we created it here
    rtmClient?.logout().catch((err) => console.error('RTM logout error:', err));
    setRtmClient(null);
    setCallSeconds(Math.round((Date.now() - callStartRef.current) / 1000));
    setStage('ended');
  };

  if (stage === 'login' || !profile) {
    return <LoginScreen initialProfile={profile} onSubmit={handleLogin} />;
  }

  if (stage === 'lobby') {
    return (
      <LobbyScreen
        profile={profile}
        isLoading={isLoading}
        error={error}
        onStart={handleStartConversation}
        onLanguageChange={handleLanguageChange}
        onSignOut={handleSignOut}
      />
    );
  }

  if (stage === 'ended') {
    return (
      <CallEndedScreen
        profile={profile}
        durationSeconds={callSeconds}
        onNewCall={() => setStage('lobby')}
        onSignOut={handleSignOut}
      />
    );
  }

  return agoraData && rtmClient ? (
    <Suspense fallback={<LoadingSkeleton />}>
      <ErrorBoundary>
        <AgoraProvider>
          <ConversationComponent
            agoraData={agoraData}
            rtmClient={rtmClient}
            profile={profile}
            initialCameraOn={mediaPrefs.camera}
            initialMicOn={mediaPrefs.mic}
            agentJoinError={agentJoinError}
            onTokenWillExpire={handleTokenWillExpire}
            onEndConversation={handleEndConversation}
          />
        </AgoraProvider>
      </ErrorBoundary>
    </Suspense>
  ) : (
    <LoadingSkeleton />
  );
}
