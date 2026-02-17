// app/lib/settings.ts
export const SETTINGS_KEYS = {
  qualifyingHours: "wagecheck.qualifyingHours",
} as const;

const DEFAULT_QUALIFYING_HOURS = 160;

export function getQualifyingHours(): number {
  if (typeof window === "undefined") return DEFAULT_QUALIFYING_HOURS;

  const raw = window.localStorage.getItem(SETTINGS_KEYS.qualifyingHours);
  const n = Number(raw);

  // if empty / NaN / silly values, fall back
  if (!Number.isFinite(n) || n <= 0 || n > 400) return DEFAULT_QUALIFYING_HOURS;

  return Math.round(n);
}

export function setQualifyingHours(value: number) {
  if (typeof window === "undefined") return;

  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n <= 0 || n > 400) return;

  window.localStorage.setItem(SETTINGS_KEYS.qualifyingHours, String(n));
}