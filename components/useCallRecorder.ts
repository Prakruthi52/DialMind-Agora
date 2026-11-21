'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { IAgoraRTCRemoteUser, ICameraVideoTrack, IMicrophoneAudioTrack } from 'agora-rtc-react';

// Records the call in the browser: a canvas composites Vanya's avatar video (or her photo)
// with the farmer's camera picture-in-picture, and the farmer's mic + Vanya's voice are mixed
// into one audio track. On stop the WebM is uploaded to Vercel Blob and linked to the session.
// Enabled with NEXT_PUBLIC_RECORDING_ENABLED=true (requires BLOB_READ_WRITE_TOKEN on the server).

export interface RecorderSources {
  avatarUser?: IAgoraRTCRemoteUser;
  remoteUsers: IAgoraRTCRemoteUser[];
  camera: ICameraVideoTrack | null;
  cameraOn: boolean;
  mic: IMicrophoneAudioTrack | null;
}

const WIDTH = 960;
const HEIGHT = 540;
const FPS = 15;

/** Records a recording problem in the session trace (shows under Errors in the console). */
function reportProblem(sessionId: string, message: string) {
  const body = JSON.stringify({ events: [{ kind: 'error', payload: { source: 'recording', message, at: Date.now() } }] });
  try {
    if (!navigator.sendBeacon?.(`/api/sessions/${sessionId}/events`, new Blob([body], { type: 'application/json' }))) {
      fetch(`/api/sessions/${sessionId}/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
    }
  } catch {}
}

function videoFor(track: MediaStreamTrack | undefined, el: HTMLVideoElement | null): HTMLVideoElement | null {
  if (!track) return null;
  const video = el ?? Object.assign(document.createElement('video'), { muted: true, playsInline: true });
  const current = (video.srcObject as MediaStream | null)?.getVideoTracks()[0];
  if (current !== track) {
    video.srcObject = new MediaStream([track]);
    video.play().catch(() => {});
  }
  return video;
}

export function useCallRecorder(sessionId: string | undefined, active: boolean, sources: RecorderSources) {
  const enabled = process.env.NEXT_PUBLIC_RECORDING_ENABLED === 'true';
  const sourcesRef = useRef(sources);
  sourcesRef.current = sources;
  const stateRef = useRef<{
    recorder: MediaRecorder;
    chunks: Blob[];
    timer: ReturnType<typeof setInterval>;
    audio: AudioContext;
    dest: MediaStreamAudioDestinationNode;
    connected: Set<MediaStreamTrack>;
    startedAt: number;
    sessionId: string;
  } | null>(null);

  // Start once the call is live and the session id is known.
  useEffect(() => {
    if (!enabled || !active || !sessionId || stateRef.current) return;
    if (typeof MediaRecorder === 'undefined') {
      reportProblem(sessionId, 'This browser cannot record calls (no MediaRecorder).');
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext('2d')!;
    const poster = new Image();
    poster.src = '/vanya.webp';
    let avatarVideo: HTMLVideoElement | null = null;
    let selfVideo: HTMLVideoElement | null = null;

    const audio = new AudioContext();
    const dest = audio.createMediaStreamDestination();
    const connected = new Set<MediaStreamTrack>();
    const connectAudio = (track: MediaStreamTrack | undefined) => {
      if (!track || connected.has(track)) return;
      connected.add(track);
      audio.createMediaStreamSource(new MediaStream([track])).connect(dest);
    };

    const draw = () => {
      const s = sourcesRef.current;
      // Audio: farmer mic + every remote voice (avatar or agent).
      connectAudio(s.mic?.getMediaStreamTrack());
      for (const u of s.remoteUsers) connectAudio(u.audioTrack?.getMediaStreamTrack());

      ctx.fillStyle = '#120e0a';
      ctx.fillRect(0, 0, WIDTH, HEIGHT);
      avatarVideo = videoFor(s.avatarUser?.videoTrack?.getMediaStreamTrack(), avatarVideo);
      const main: CanvasImageSource | null =
        avatarVideo && avatarVideo.readyState >= 2 ? avatarVideo : poster.complete ? poster : null;
      if (main) {
        const w = main instanceof HTMLVideoElement ? main.videoWidth : poster.naturalWidth;
        const h = main instanceof HTMLVideoElement ? main.videoHeight : poster.naturalHeight;
        const scale = Math.max(WIDTH / w, HEIGHT / h);
        ctx.drawImage(main, (WIDTH - w * scale) / 2, (HEIGHT - h * scale) / 2, w * scale, h * scale);
      }
      selfVideo = s.cameraOn ? videoFor(s.camera?.getMediaStreamTrack(), selfVideo) : null;
      if (selfVideo && selfVideo.readyState >= 2) {
        const pw = 240;
        const ph = Math.round((pw * selfVideo.videoHeight) / Math.max(1, selfVideo.videoWidth));
        const x = WIDTH - pw - 16;
        const y = HEIGHT - ph - 16;
        ctx.save();
        ctx.translate(x + pw, y);
        ctx.scale(-1, 1); // mirror like the on-screen preview
        ctx.drawImage(selfVideo, 0, 0, pw, ph);
        ctx.restore();
        ctx.strokeStyle = '#f4a51c';
        ctx.lineWidth = 3;
        ctx.strokeRect(x, y, pw, ph);
      }
      ctx.fillStyle = 'rgba(0,0,0,.5)';
      ctx.fillRect(16, 16, 230, 34);
      ctx.fillStyle = '#f4c451';
      ctx.font = '600 18px sans-serif';
      ctx.fillText('Vanya · DialMind', 28, 39);
    };

    const stream = new MediaStream([...canvas.captureStream(FPS).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const mimeType = ['video/webm;codecs=vp8,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
    const recorder = new MediaRecorder(stream, { ...(mimeType && { mimeType }), videoBitsPerSecond: 450_000, audioBitsPerSecond: 48_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.start(5000);
    const timer = setInterval(draw, 1000 / FPS);
    stateRef.current = { recorder, chunks, timer, audio, dest, connected, startedAt: Date.now(), sessionId };
  }, [enabled, active, sessionId]);

  /** Stops recording and uploads in the background (safe to call more than once). */
  const stopAndUpload = useCallback(() => {
    const st = stateRef.current;
    if (!st) return;
    stateRef.current = null;
    clearInterval(st.timer);
    const durationS = Math.round((Date.now() - st.startedAt) / 1000);
    st.recorder.onstop = async () => {
      st.audio.close().catch(() => {});
      const blob = new Blob(st.chunks, { type: 'video/webm' });
      if (blob.size < 10_000) {
        reportProblem(st.sessionId, `Recording was empty (${blob.size} bytes).`);
        return;
      }
      try {
        const { upload } = await import('@vercel/blob/client');
        const result = await upload(`recordings/${st.sessionId}.webm`, blob, {
          access: 'public',
          handleUploadUrl: '/api/recording/upload',
          contentType: 'video/webm',
        });
        await fetch(`/api/sessions/${st.sessionId}/recording`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: result.url, contentType: 'video/webm', sizeBytes: blob.size, durationS }),
        });
      } catch (error) {
        console.warn('Recording upload failed:', error);
        reportProblem(st.sessionId, `Upload failed (${Math.round(blob.size / 1e6)} MB): ${error instanceof Error ? error.message : String(error)}`.slice(0, 400));
      }
    };
    if (st.recorder.state !== 'inactive') st.recorder.stop();
  }, []);

  // Make sure an unmount (call ended) still finishes and uploads the recording.
  useEffect(() => () => stopAndUpload(), [stopAndUpload]);

  return { stopAndUpload, enabled };
}
