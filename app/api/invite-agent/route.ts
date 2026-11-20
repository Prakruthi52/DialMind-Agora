import { NextRequest, NextResponse } from 'next/server';
import {
  AgoraClient,
  Agent,
  AnamAvatar,
  Area,
  AresSTT,
  ExpiresIn,
  generateConvoAIToken,
  MurfTTS,
  OpenAI,
} from 'agora-agents';
import { ClientStartRequest, AgentResponse } from '@/types/conversation';
import { DEFAULT_AGENT_UID, DEFAULT_AVATAR_UID } from '@/lib/agora';
import { LANGUAGES, buildVanyaPrompt, isLanguageCode } from '@/lib/vanya';
import { isAvatarEnabled, waitForAvatarWarmup } from '@/lib/avatar-warmup';
import { attachAgent, createSession, getCurrentQuestion } from '@/lib/engine/flow';
import { buildTools } from '@/lib/tools';

// agentUid identifies the AI in the RTC channel and shares its default with the client.
const agentUid = String(DEFAULT_AGENT_UID);
const avatarUid = String(DEFAULT_AVATAR_UID);

// Murf Falcon output rate. Anam accepts 16/24/48 kHz; both sides must match.
const TTS_SAMPLE_RATE = 24000;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export async function POST(request: NextRequest) {
  try {
    // --- 1. Parse request ---

    const body: ClientStartRequest = await request.json();
    const { requester_id, channel_name } = body;
    const language = LANGUAGES[isLanguageCode(body.language) ? body.language : 'hi'];
    const farmerName =
      typeof body.farmer_name === 'string' ? body.farmer_name.trim().slice(0, 60) : undefined;

    // Validate required env vars on first request so misconfiguration surfaces
    // with a clear error message rather than a silent failure.
    const appId = requireEnv('NEXT_PUBLIC_AGORA_APP_ID');
    const appCertificate = requireEnv('NEXT_AGORA_APP_CERTIFICATE');

    if (!channel_name || !requester_id) {
      return NextResponse.json(
        { error: 'channel_name and requester_id are required' },
        { status: 400 },
      );
    }

    // --- 2. Build and start the agent ---

    // AgoraClient authenticates API calls to the Agora Conversational AI service.
    // area: change to Area.EU or Area.AP for European or Asia-Pacific deployments.
    const client = new AgoraClient({
      area: Area.US,
      appId,
      appCertificate,
    });

    // One interview session per call. Its id reaches the tools as a template variable.
    const sessionId = await createSession({
      channel: channel_name,
      language: language.code,
      callerName: farmerName,
      callerMobile: typeof body.farmer_mobile === 'string' ? body.farmer_mobile.slice(0, 15) : undefined,
    });

    // Tools need a public HTTPS URL (Agora's cloud calls them): Vercel in production, a
    // tunnel (PUBLIC_BASE_URL) in local development.
    const publicBaseUrl = process.env.PUBLIC_BASE_URL?.replace(/\/$/, '');
    const toolSecret = process.env.TOOL_SECRET;
    const toolsEnabled = !!publicBaseUrl?.startsWith('https://') && !!toolSecret;
    if (!toolsEnabled) {
      console.warn('Tools disabled: set PUBLIC_BASE_URL (https) and TOOL_SECRET to enable the interview engine.');
    }

    // The greeting ends with the first question from the database, so the farmer can answer
    // straight away (Vanya then continues through the tools).
    const firstQuestion = toolsEnabled ? (await getCurrentQuestion(sessionId)).ask : undefined;
    const greeting = firstQuestion ? `${language.greeting} ${firstQuestion}` : language.greeting;
    const failureMessage =
      language.code === 'hi'
        ? 'एक पल रुकिए।'
        : language.code === 'kn'
          ? 'ಒಂದು ಕ್ಷಣ ಕಾಯಿರಿ.'
          : 'Please wait a moment.';

    // Pipeline: Agora ARES (managed) STT → OpenAI gpt-4o-mini (Agora-managed) LLM
    // → Murf Falcon (BYOK) TTS → optional Anam avatar (BYOK) video.
    const agent = new Agent({
      client,
      instructions: buildVanyaPrompt(language, farmerName),
      greeting,
      failureMessage,
      maxHistory: 50,
      // VAD controls how the agent detects the start and end of a user's turn.
      turnDetection: {
        // Interaction language: drives ARES speech recognition (hi-IN / kn-IN / en-IN).
        language: language.asrLanguage,
        config: {
          speech_threshold: 0.5,
          start_of_speech: {
            mode: 'vad',
            vad_config: {
              interrupt_duration_ms: 160, // ms of speech before interruption triggers
              prefix_padding_ms: 300, // audio captured before speech is detected
            },
          },
          end_of_speech: {
            mode: 'vad',
            vad_config: {
              // Farmers often pause mid-answer; a slightly longer silence avoids cutting them off.
              silence_duration_ms: 640,
            },
          },
        },
      },
      // RTM is required for transcript events in the browser client.
      // enable_tools is required for tool / MCP invocation.
      advancedFeatures: { enable_rtm: true, enable_tools: true },
      // Required for browser RTM events:
      // - data_channel: 'rtm' enables RTM delivery path for state/metrics/errors
      // - enable_error_message emits AGENT_ERROR payloads
      // - enable_metrics emits AGENT_METRICS latency payloads
      parameters: {
        // web client → ultra-low-latency chorus profile
        audio_scenario: 'chorus',
        data_channel: 'rtm',
        enable_error_message: true,
        enable_metrics: true,
      },
    })
      // Agora ARES speech recognition (Agora-managed, runs inside Agora; no external ASR hop).
      // Code-mixed speech (Hinglish) is recognised under the hi-IN model.
      .withStt(
        new AresSTT({
          keywords: ['Fasal Bima', 'PMFBY', 'DialMind', 'Vanya', 'acre', 'gunta', 'claim', 'policy'],
        }),
      )
      .withLlm(
        new OpenAI({
          model: 'gpt-4o-mini',
          greetingMessage: greeting,
          ...(toolsEnabled && {
            tools: buildTools(publicBaseUrl!),
            templateVariables: { session_id: sessionId, tool_secret: toolSecret! },
          }),
          failureMessage,
          maxHistory: 15,
          params: {
            max_tokens: 512,
            temperature: 0.5,
            top_p: 0.95,
          },
        }),
      )
      .withTts(
        // Murf AI Falcon TTS (BYOK). 'FALCON' routes to Murf's latest Falcon 2.1 streaming model.
        new MurfTTS({
          key: requireEnv('NEXT_MURF_API_KEY'),
          voiceId: process.env.NEXT_MURF_VOICE_ID ?? 'hi-IN-poonam',
          locale: language.murfLocale,
          model: 'FALCON',
          sampleRate: TTS_SAMPLE_RATE,
        }),
      );

    // Anam video avatar (BYOK). The SDK auto-generates avatar tokens only for some vendors
    // (not Anam), so we mint the avatar's RTC token ourselves. Without it Anam cannot join.
    const withAvatar = () =>
      agent.withAvatar(
        new AnamAvatar({
          apiKey: requireEnv('NEXT_ANAM_API_KEY'),
          avatarId: process.env.NEXT_ANAM_AVATAR_ID,
          additionalParams: {
            agora_uid: avatarUid,
            agora_token: generateConvoAIToken({
              appId,
              appCertificate,
              channelName: channel_name,
              uid: DEFAULT_AVATAR_UID,
              tokenExpire: 60 * 60,
            }),
            sample_rate: TTS_SAMPLE_RATE,
            quality: 'high',
            video_encoding: 'H264',
          },
        }),
      );

    const startSession = (pipeline: typeof agent) =>
      pipeline
        .createSession({
          channel: channel_name,
          agentUid,
          // remoteUids restricts the agent to only process audio from this user
          remoteUids: [requester_id],
          idleTimeout: 30,
          expiresIn: ExpiresIn.hours(1),
          // NEXT_AGENT_DEBUG=true logs the exact start-agent request (keys redacted by the SDK).
          debug: process.env.NEXT_AGENT_DEBUG === 'true',
        })
        .start();

    // The Agora → Anam handoff occasionally times out (~30 s, 400 ErrInternal). Rather than
    // failing the call, fall back to a voice-only Vanya so the farmer can still file the claim.
    let avatarEnabled = isAvatarEnabled();
    // Anam's free plan allows one session at a time: never overlap a lobby warm-up.
    if (avatarEnabled) await waitForAvatarWarmup();
    let agentId: string;
    if (avatarEnabled) {
      try {
        agentId = await startSession(withAvatar());
      } catch (avatarError) {
        console.warn('Avatar start failed, falling back to voice-only:', avatarError);
        avatarEnabled = false;
        agentId = await startSession(agent);
      }
    } else {
      agentId = await startSession(agent);
    }

    await attachAgent(sessionId, agentId, avatarEnabled);

    return NextResponse.json({
      session_id: sessionId,
      tools_enabled: toolsEnabled,
      agent_id: agentId,
      create_ts: Math.floor(Date.now() / 1000),
      state: 'RUNNING',
      ...(avatarEnabled && { avatar_uid: avatarUid }),
    } as AgentResponse);
  } catch (error) {
    console.error('Error starting conversation:', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to start conversation',
      },
      { status: 500 },
    );
  }
}
