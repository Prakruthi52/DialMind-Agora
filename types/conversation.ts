import type { RTMClient } from 'agora-rtm';

export interface AgoraTokenData {
  token: string;
  uid: string;
  channel: string;
  agentId?: string;
  avatarUid?: string;
  sessionId?: string;
}

export type { LanguageCode } from '@/lib/vanya';
import type { LanguageCode } from '@/lib/vanya';

export interface ClientStartRequest {
  requester_id: string;
  channel_name: string;
  language?: LanguageCode;
  farmer_name?: string;
  farmer_mobile?: string;
}

/** Farmer profile captured on the sign-in screen (kept in the browser only). */
export interface FarmerProfile {
  name: string;
  mobile: string;
  language: LanguageCode;
}

export interface StopConversationRequest {
  agent_id: string;
}

export interface AgentResponse {
  agent_id: string;
  create_ts: number;
  state: string;
  /** RTC UID the avatar video is published under; absent when the avatar is disabled. */
  avatar_uid?: string;
  /** Interview session id (claim state, tools, trace). */
  session_id?: string;
  tools_enabled?: boolean;
}

export interface AgoraRenewalTokens {
  rtcToken: string;
  rtmToken: string;
}

export interface ConversationComponentProps {
  agoraData: AgoraTokenData;
  rtmClient: RTMClient;
  profile: FarmerProfile;
  initialCameraOn: boolean;
  initialMicOn: boolean;
  /** True when /api/invite-agent failed; the call UI shows a warning. */
  agentJoinError: boolean;
  onTokenWillExpire: (uid: string) => Promise<AgoraRenewalTokens>;
  onEndConversation: () => void;
}
