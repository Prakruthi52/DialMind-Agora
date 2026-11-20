import type { LanguageCode } from '@/types/conversation';

/** DialMind wordmark: a sprout inside a speech bubble. */
export function DialMindLogo({
  className = '',
  tone = 'dark',
}: {
  className?: string;
  tone?: 'dark' | 'light';
}) {
  const text = tone === 'light' ? 'text-white' : 'text-[#0f2e20]';
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <svg viewBox="0 0 32 32" className="h-8 w-8 shrink-0" aria-hidden="true">
        <path
          d="M16 3C8.8 3 3 8.4 3 15c0 3.3 1.4 6.2 3.7 8.4L5.5 29l6-2.6c1.4.4 2.9.6 4.5.6 7.2 0 13-5.4 13-12S23.2 3 16 3z"
          fill="#1f7a4d"
        />
        <path
          d="M16 22v-6.5M16 15.5c0-3 2.2-5 5.2-5.2-.1 3-2.2 5.2-5.2 5.2zM16 17.5c0-2.6-1.9-4.4-4.5-4.5.1 2.6 1.9 4.5 4.5 4.5z"
          stroke="#f5c451"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </svg>
      <span className={`text-lg font-bold tracking-tight ${text}`}>
        Dial<span className="text-[#1f7a4d]">Mind</span>
      </span>
    </div>
  );
}

/** Palette: paddy green, marigold, saffron, terracotta on a warm cream base. */
export const THEME = {
  green: '#1f6b45',
  greenDark: '#0f3d27',
  marigold: '#f4a51c',
  saffron: '#e8772e',
  terracotta: '#a84a24',
  cream: '#fbf5e9',
};

/** Marigold-and-mango-leaf toran (door garland) strip. */
export function Toran({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 400 34"
      preserveAspectRatio="xMidYMin slice"
      className={`block h-[34px] w-full ${className}`}
      aria-hidden="true"
    >
      <defs>
        <pattern id="toran" width="40" height="34" patternUnits="userSpaceOnUse">
          <path d="M0 4 Q20 12 40 4" stroke="#0f3d27" strokeWidth="1.5" fill="none" />
          <path d="M20 9 q-6 10 0 22 q6 -12 0 -22z" fill="#2f8a52" />
          <circle cx="6" cy="10" r="4.2" fill="#f4a51c" />
          <circle cx="6" cy="10" r="2" fill="#e8772e" />
          <circle cx="34" cy="10" r="4.2" fill="#f4a51c" />
          <circle cx="34" cy="10" r="2" fill="#e8772e" />
        </pattern>
      </defs>
      <rect width="400" height="34" fill="url(#toran)" />
    </svg>
  );
}

/** Kolam-style dot grid used as a subtle background texture. */
export const KOLAM_BG: React.CSSProperties = {
  backgroundImage:
    'radial-gradient(circle at 12px 12px, rgba(255,255,255,.22) 1.4px, transparent 1.6px), radial-gradient(circle at 12px 12px, transparent 7px, rgba(244,165,28,.10) 7.5px, transparent 8.5px)',
  backgroundSize: '24px 24px',
};

/** Paddy field with rows of crops, a sun and distant hills. */
export function FieldScape({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 600 160" preserveAspectRatio="xMidYMax slice" className={className} aria-hidden="true">
      <circle cx="470" cy="70" r="34" fill="#f4a51c" opacity=".9" />
      <path d="M0 110 Q120 70 240 100 T480 92 T600 100 V160 H0z" fill="#2f8a52" opacity=".55" />
      <path d="M0 125 Q150 100 300 120 T600 115 V160 H0z" fill="#1f6b45" />
      {Array.from({ length: 26 }).map((_, i) => (
        <g key={i} transform={`translate(${i * 24 + 6} 128)`} stroke="#9fd17a" strokeWidth="2" strokeLinecap="round">
          <path d="M6 30 V8" />
          <path d="M6 18 Q0 10 -2 4" fill="none" />
          <path d="M6 14 Q12 6 14 0" fill="none" />
          <circle cx="13" cy="1" r="2" fill="#f4c451" stroke="none" />
        </g>
      ))}
    </svg>
  );
}

type LanguageOption = {
  code: LanguageCode;
  native: string;
  english: string;
  /** Needs Sarvam speech recognition (only shown when NEXT_PUBLIC_SARVAM_ENABLED=true). */
  sarvam?: boolean;
};

const ALL_LANGUAGE_OPTIONS: LanguageOption[] = [
  { code: 'en', native: 'English', english: 'English' },
  { code: 'hi', native: 'हिन्दी', english: 'Hindi' },
  { code: 'kn', native: 'ಕನ್ನಡ', english: 'Kannada' },
  { code: 'ta', native: 'தமிழ்', english: 'Tamil' },
  { code: 'te', native: 'తెలుగు', english: 'Telugu' },
  { code: 'bn', native: 'বাংলা', english: 'Bengali' },
  { code: 'gu', native: 'ગુજરાતી', english: 'Gujarati' },
  { code: 'mr', native: 'मराठी', english: 'Marathi', sarvam: true },
  { code: 'ml', native: 'മലയാളം', english: 'Malayalam', sarvam: true },
  { code: 'pa', native: 'ਪੰਜਾਬੀ', english: 'Punjabi', sarvam: true },
  { code: 'or', native: 'ଓଡ଼ିଆ', english: 'Odia', sarvam: true },
];

export const LANGUAGE_OPTIONS = ALL_LANGUAGE_OPTIONS.filter(
  (l) => !l.sarvam || process.env.NEXT_PUBLIC_SARVAM_ENABLED === 'true',
);

export function languageLabel(code: LanguageCode): string {
  return ALL_LANGUAGE_OPTIONS.find((l) => l.code === code)?.native ?? code;
}
