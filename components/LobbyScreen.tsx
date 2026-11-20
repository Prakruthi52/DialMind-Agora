'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import {
  Camera,
  CameraOff,
  Loader2,
  LogOut,
  Mic,
  MicOff,
  PhoneCall,
  ScrollText,
  Wheat,
} from 'lucide-react';
import type { FarmerProfile, LanguageCode } from '@/types/conversation';
import { getTranslator } from '@/lib/i18n';
import { DialMindLogo, LANGUAGE_OPTIONS, Toran } from './brand';

type PreviewState = 'idle' | 'loading' | 'ready' | 'denied' | 'unavailable';

export function LobbyScreen({
  profile,
  isLoading,
  error,
  onStart,
  onLanguageChange,
  onSignOut,
}: {
  profile: FarmerProfile;
  isLoading: boolean;
  error: string | null;
  onStart: (prefs: { camera: boolean; mic: boolean }) => void;
  onLanguageChange: (language: LanguageCode) => void;
  onSignOut: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraOn, setCameraOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [preview, setPreview] = useState<PreviewState>('idle');

  const stopPreview = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  };

  // Camera preview with plain getUserMedia. It is stopped before the call starts so the
  // Agora SDK can open the camera itself (phones often allow only one open camera).
  useEffect(() => {
    if (!cameraOn) {
      stopPreview();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setPreview('unavailable');
      return;
    }
    let cancelled = false;
    setPreview('loading');
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: 'user' }, audio: false })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setPreview('ready');
      })
      .catch((err: DOMException) => {
        if (cancelled) return;
        setPreview(err?.name === 'NotAllowedError' ? 'denied' : 'unavailable');
      });
    return () => {
      cancelled = true;
      stopPreview();
    };
  }, [cameraOn]);

  const handleStart = () => {
    stopPreview();
    onStart({ camera: cameraOn && preview !== 'denied' && preview !== 'unavailable', mic: micOn });
  };

  const firstName = profile.name.split(' ')[0];
  const t = getTranslator(profile.language);

  return (
    <main className="min-h-dvh bg-[#fbf5e9] text-[#0f2e20]">
      <Toran />
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4 sm:px-8">
        <DialMindLogo />
        <button
          onClick={onSignOut}
          className="flex items-center gap-2 rounded-full px-3 py-2 text-sm text-[#4b5d53] transition hover:bg-black/5"
        >
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">{t('signOut')}</span>
        </button>
      </header>

      <div className="mx-auto grid max-w-6xl gap-6 px-5 pb-10 sm:px-8 lg:grid-cols-[1.4fr_1fr] lg:gap-10 lg:pt-6">
        {/* Self preview */}
        <section className="animate-fade-up">
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-3xl bg-[#1c160f] shadow-xl sm:aspect-video">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className={`h-full w-full scale-x-[-1] object-cover transition-opacity duration-500 ${
                cameraOn && preview === 'ready' ? 'opacity-100' : 'opacity-0'
              }`}
            />
            {!(cameraOn && preview === 'ready') && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white/80">
                {cameraOn && preview === 'loading' ? (
                  <Loader2 className="h-8 w-8 animate-spin" />
                ) : (
                  <>
                    <div className="flex h-20 w-20 items-center justify-center rounded-full bg-[#1f6b45] text-3xl font-bold text-white">
                      {firstName.charAt(0).toUpperCase()}
                    </div>
                    <p className="px-6 text-center text-sm">
                      {preview === 'denied'
                        ? t('cameraBlocked')
                        : preview === 'unavailable'
                          ? t('cameraNone')
                          : t('cameraOffNote')}
                    </p>
                  </>
                )}
              </div>
            )}
            <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-3">
              <button
                onClick={() => setMicOn((v) => !v)}
                aria-label={micOn ? t('micOff') : t('micOn')}
                className={`flex h-12 w-12 items-center justify-center rounded-full backdrop-blur-md transition ${
                  micOn ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-[#d92d20] text-white'
                }`}
              >
                {micOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
              </button>
              <button
                onClick={() => setCameraOn((v) => !v)}
                aria-label={cameraOn ? t('camOff') : t('camOn')}
                className={`flex h-12 w-12 items-center justify-center rounded-full backdrop-blur-md transition ${
                  cameraOn ? 'bg-white/20 text-white hover:bg-white/30' : 'bg-[#d92d20] text-white'
                }`}
              >
                {cameraOn ? <Camera className="h-5 w-5" /> : <CameraOff className="h-5 w-5" />}
              </button>
            </div>
            <span className="absolute left-4 top-4 rounded-full bg-black/40 px-3 py-1 text-xs text-white backdrop-blur-md">
              {profile.name} · +91 {profile.mobile.slice(0, 2)}••••••{profile.mobile.slice(-2)}
            </span>
          </div>
        </section>

        {/* Join card */}
        <section className="animate-fade-up animate-fade-up-d1 flex flex-col">
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
            {t('greeting', { name: firstName })}
          </h1>
          <p className="mt-1 text-[#4b5d53]">{t('readyLine')}</p>

          <div className="mt-5 flex items-center gap-4 rounded-2xl bg-white p-4 shadow-sm">
            <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl">
              <Image
                src="/vanya.jpg"
                alt="Vanya"
                fill
                sizes="4rem"
                className="object-cover object-[50%_30%]"
              />
            </div>
            <div className="min-w-0">
              <p className="flex items-center gap-2 font-semibold">
                Vanya
                <span className="flex items-center gap-1 rounded-full bg-[#fdf0d5] px-2 py-0.5 text-xs font-medium text-[#1f6b45]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[#1f6b45]" /> {t('online')}
                </span>
              </p>
              <p className="text-sm text-[#4b5d53]">{t('assistantRole')}</p>
            </div>
          </div>

          <p className="mt-5 text-sm font-semibold">{t('callLanguage')}</p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {LANGUAGE_OPTIONS.map((opt) => {
              const active = profile.language === opt.code;
              return (
                <button
                  key={opt.code}
                  onClick={() => onLanguageChange(opt.code)}
                  aria-pressed={active}
                  className={`rounded-xl border px-2 py-2.5 text-center transition ${
                    active
                      ? 'border-[#1f6b45] bg-[#fdf0d5] font-semibold ring-2 ring-[#1f6b45]/30'
                      : 'border-[#e4d6b8] bg-white hover:border-[#1f6b45]/50'
                  }`}
                >
                  {opt.native}
                </button>
              );
            })}
          </div>

          <ul className="mt-5 space-y-2 text-sm text-[#4b5d53]">
            <li className="flex items-center gap-2">
              <ScrollText className="h-4 w-4 shrink-0 text-[#1f6b45]" /> {t('tipPolicy')}
            </li>
            <li className="flex items-center gap-2">
              <Wheat className="h-4 w-4 shrink-0 text-[#1f6b45]" /> {t('tipField')}
            </li>
          </ul>

          {error && (
            <p className="mt-4 rounded-xl bg-[#fee4e2] px-4 py-3 text-sm text-[#b42318]">{t('startError')}</p>
          )}

          <button
            onClick={handleStart}
            disabled={isLoading}
            className="mt-6 flex h-14 w-full items-center justify-center gap-3 rounded-2xl bg-[#1f6b45] text-lg font-semibold text-white shadow-lg shadow-[#1f6b45]/25 transition hover:bg-[#17573a] active:scale-[0.99] disabled:cursor-wait disabled:opacity-80"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" /> {t('connecting')}
              </>
            ) : (
              <>
                <PhoneCall className="h-5 w-5" /> {t('startCall')}
              </>
            )}
          </button>
        </section>
      </div>
    </main>
  );
}
