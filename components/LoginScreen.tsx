'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { ArrowRight, Camera, Languages, ShieldCheck, Sprout } from 'lucide-react';
import type { FarmerProfile, LanguageCode } from '@/types/conversation';
import { getTranslator } from '@/lib/i18n';
import { DialMindLogo, FieldScape, KOLAM_BG, LANGUAGE_OPTIONS, Toran } from './brand';

const MOBILE_RE = /^[6-9]\d{9}$/;

export function LoginScreen({
  initialProfile,
  onSubmit,
}: {
  initialProfile: FarmerProfile | null;
  onSubmit: (profile: FarmerProfile) => void;
}) {
  const [name, setName] = useState(initialProfile?.name ?? '');
  const [mobile, setMobile] = useState(initialProfile?.mobile ?? '');
  const [language, setLanguage] = useState<LanguageCode>(initialProfile?.language ?? 'en');
  // The whole page switches to the language picked for the call.
  const t = getTranslator(language);
  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);
  const [touched, setTouched] = useState(false);

  const nameOk = name.trim().length >= 2;
  const mobileOk = MOBILE_RE.test(mobile);
  const canSubmit = nameOk && mobileOk;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    if (!canSubmit) return;
    onSubmit({ name: name.trim(), mobile, language });
  };

  return (
    <main className="min-h-dvh bg-[#fbf5e9] text-[#0f2e20] lg:grid lg:grid-cols-[1.1fr_1fr]">
      {/* Hero: full panel on desktop, compact banner on phones */}
      <section className="relative overflow-hidden bg-gradient-to-b from-[#0f3d27] via-[#16553a] to-[#1f6b45] text-white lg:flex lg:flex-col">
        <Toran />
        <div className="pointer-events-none absolute inset-0" style={KOLAM_BG} aria-hidden="true" />
        <div className="relative px-5 pb-6 pt-4 lg:flex lg:flex-1 lg:flex-col lg:px-12 lg:pb-0 lg:pt-8">
          <DialMindLogo tone="light" />

          <div className="mt-6 flex items-center gap-4 lg:mt-10 lg:items-start lg:gap-8">
            <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-full ring-4 ring-[#f4a51c] lg:h-40 lg:w-40">
              <Image
                src="/vanya.webp"
                alt="Vanya, the DialMind claims assistant"
                fill
                priority
                sizes="(min-width: 1024px) 10rem, 5rem"
                className="object-cover object-[50%_25%]"
              />
            </div>
            <div>
              <p className="text-sm font-semibold uppercase tracking-wider text-[#f4c451]">{t('heroEyebrow')}</p>
              <h1 className="mt-1 text-2xl font-bold leading-tight sm:text-3xl lg:text-5xl">
                {t('heroTitle1')} <span className="text-[#f4c451]">{t('heroTitle2')}</span>
              </h1>
            </div>
          </div>

          <p className="mt-4 max-w-lg text-sm text-white/80 sm:text-base lg:mt-6 lg:text-lg">
            {t('heroBody')}
          </p>

          <ul className="mt-6 hidden gap-3 text-sm text-white/90 lg:grid">
            {[
              { icon: Languages, text: t('feature1') },
              { icon: Camera, text: t('feature2') },
              { icon: Sprout, text: t('feature3') },
            ].map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f4a51c] text-[#0f3d27]">
                  <Icon className="h-4 w-4" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
        <FieldScape className="relative mt-auto hidden h-40 w-full lg:block" />
      </section>

      {/* Sign-in form */}
      <section className="flex items-start justify-center px-5 py-8 sm:py-12 lg:items-center lg:px-12">
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-md animate-fade-up rounded-3xl bg-white p-6 shadow-[0_20px_60px_-20px_rgba(15,46,32,.25)] sm:p-8"
          noValidate
        >
          <h2 className="text-2xl font-bold tracking-tight">{t('signIn')}</h2>
          <p className="mt-1 text-sm text-[#4b5d53]">{t('signInSub')}</p>

          <label className="mt-6 block text-sm font-semibold" htmlFor="name">
            {t('yourName')}
          </label>
          <input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoComplete="name"
            placeholder={t('namePlaceholder')}
            className="mt-2 h-12 w-full rounded-xl border border-[#e4d6b8] bg-[#fffdf7] px-4 text-base outline-none transition focus:border-[#1f6b45] focus:ring-4 focus:ring-[#1f6b45]/15"
          />
          {touched && !nameOk && (
            <p className="mt-1 text-sm text-[#b42318]">{t('nameError')}</p>
          )}

          <label className="mt-5 block text-sm font-semibold" htmlFor="mobile">
            {t('mobile')}
          </label>
          <div className="mt-2 flex h-12 overflow-hidden rounded-xl border border-[#e4d6b8] bg-[#fffdf7] transition focus-within:border-[#1f6b45] focus-within:ring-4 focus-within:ring-[#1f6b45]/15">
            <span className="flex items-center border-r border-[#e4d6b8] px-3 text-base text-[#4b5d53]">
              +91
            </span>
            <input
              id="mobile"
              value={mobile}
              onChange={(e) => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
              inputMode="numeric"
              autoComplete="tel-national"
              placeholder={t('mobilePlaceholder')}
              className="w-full bg-transparent px-3 text-base tracking-wider outline-none"
            />
          </div>
          {touched && !mobileOk && (
            <p className="mt-1 text-sm text-[#b42318]">{t('mobileError')}</p>
          )}

          <fieldset className="mt-5">
            <legend className="text-sm font-semibold">{t('callLanguage')}</legend>
            <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
              {LANGUAGE_OPTIONS.map((opt) => {
                const active = language === opt.code;
                return (
                  <button
                    type="button"
                    key={opt.code}
                    onClick={() => setLanguage(opt.code)}
                    aria-pressed={active}
                    className={`flex flex-col items-center justify-center rounded-xl border px-2 py-3 transition ${
                      active
                        ? 'border-[#1f6b45] bg-[#fdf0d5] ring-2 ring-[#1f6b45]/30'
                        : 'border-[#e4d6b8] bg-[#fffdf7] hover:border-[#1f6b45]/50'
                    }`}
                  >
                    <span className="text-lg font-semibold">{opt.native}</span>
                    <span className="text-xs text-[#4b5d53]">{opt.english}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <button
            type="submit"
            className="mt-7 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#1f6b45] text-base font-semibold text-white shadow-lg shadow-[#1f6b45]/25 transition hover:bg-[#17573a] active:scale-[0.99]"
          >
            {t('continue')}
            <ArrowRight className="h-5 w-5" />
          </button>

          <p className="mt-5 flex items-start gap-2 text-xs leading-5 text-[#4b5d53]">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#1f6b45]" />
            {t('privacy')}
          </p>
        </form>
      </section>
    </main>
  );
}
