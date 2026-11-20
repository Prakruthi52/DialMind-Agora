'use client';

import Image from 'next/image';
import { CheckCircle2, LogOut, PhoneCall } from 'lucide-react';
import type { FarmerProfile } from '@/types/conversation';
import { getTranslator } from '@/lib/i18n';
import { DialMindLogo, Toran } from './brand';

function formatDuration(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function CallEndedScreen({
  profile,
  durationSeconds,
  onNewCall,
  onSignOut,
}: {
  profile: FarmerProfile;
  durationSeconds: number;
  onNewCall: () => void;
  onSignOut: () => void;
}) {
  const t = getTranslator(profile.language);
  return (
    <main className="flex min-h-dvh flex-col bg-[#fbf5e9] text-[#0f2e20]">
      <Toran />
      <header className="mx-auto flex w-full max-w-6xl items-center px-5 py-4 sm:px-8">
        <DialMindLogo />
      </header>
      <div className="flex flex-1 items-center justify-center px-5 pb-12">
        <div className="w-full max-w-md animate-fade-up rounded-3xl bg-white p-8 text-center shadow-[0_20px_60px_-20px_rgba(15,46,32,.25)]">
          <div className="relative mx-auto h-20 w-20 overflow-hidden rounded-full ring-4 ring-[#f4a51c]">
            <Image src="/vanya.jpg" alt="Vanya" fill sizes="5rem" className="object-cover object-[50%_30%]" />
          </div>
          <h1 className="mt-5 flex items-center justify-center gap-2 text-2xl font-bold">
            <CheckCircle2 className="h-6 w-6 text-[#1f6b45]" /> {t('callEnded')}
          </h1>
          <p className="mt-2 text-[#4b5d53]">
            {t('endedBody', { name: profile.name.split(' ')[0], duration: formatDuration(durationSeconds) })}
          </p>
          <button
            onClick={onNewCall}
            className="mt-7 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#1f6b45] font-semibold text-white transition hover:bg-[#17573a]"
          >
            <PhoneCall className="h-5 w-5" /> {t('startAnother')}
          </button>
          <button
            onClick={onSignOut}
            className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl text-[#4b5d53] transition hover:bg-black/5"
          >
            <LogOut className="h-4 w-4" /> {t('signOut')}
          </button>
        </div>
      </div>
    </main>
  );
}
