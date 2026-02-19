export type Settings = {
  baseRate: number;
  otAddOn: number;
  latePremium: number;
  nightPremium: number;
  holidayRate: number;
  otThreshold: number;
  doubleRate: number;
};

export const SETTINGS_KEY = "wagecheck.settings.v1";

export const DEFAULT_SETTINGS: Settings = {
  baseRate: 17.3,
  otAddOn: 6.7,
  latePremium: 2.26,
  nightPremium: 3.45,
  holidayRate: 0,
  otThreshold: 160,
  doubleRate: 2,
};

function safeNum(x: unknown, fallback: number) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

export function getSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);

    return {
      baseRate: safeNum(parsed?.baseRate, DEFAULT_SETTINGS.baseRate),
      otThreshold: safeNum(parsed?.otThreshold, DEFAULT_SETTINGS.otThreshold),
      otAddOn: safeNum(parsed?.otPremiumAdd, DEFAULT_SETTINGS.otAddOn),
      latePremium: safeNum(parsed?.latePremiumAdd, DEFAULT_SETTINGS.latePremium),
      nightPremium: safeNum(parsed?.nightPremiumAdd, DEFAULT_SETTINGS.nightPremium),
      doubleRate: safeNum(parsed?.doubleRate, DEFAULT_SETTINGS.doubleRate),
      holidayRate: safeNum(parsed?.holidayRate, DEFAULT_SETTINGS.holidayRate),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {}
}

export function restoreDefaultSettings() {
  saveSettings(DEFAULT_SETTINGS);
}

export function getQualifyingHours(): number {
  return getSettings().otThreshold;
}