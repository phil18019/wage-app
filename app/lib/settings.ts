export type Settings = {
  baseRate: number;          // e.g. 17.3
  otThreshold: number;       // e.g. 160
  otPremiumAdd: number;      // e.g. 6.7 (paid on top of base)
  latePremiumAdd: number;    // e.g. 2.26
  nightPremiumAdd: number;   // e.g. 3.45
  doubleRate: number;        // e.g. 34.6
  holidayRate: number;       // user-editable monthly
};

export const SETTINGS_KEY = "wagecheck.settings.v1";

export const DEFAULT_SETTINGS: Settings = {
  baseRate: 17.3,
  otThreshold: 160,
  otPremiumAdd: 6.7,
  latePremiumAdd: 2.26,
  nightPremiumAdd: 3.45,
  doubleRate: 34.6,
  holidayRate: 0,
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
      otPremiumAdd: safeNum(parsed?.otPremiumAdd, DEFAULT_SETTINGS.otPremiumAdd),
      latePremiumAdd: safeNum(parsed?.latePremiumAdd, DEFAULT_SETTINGS.latePremiumAdd),
      nightPremiumAdd: safeNum(parsed?.nightPremiumAdd, DEFAULT_SETTINGS.nightPremiumAdd),
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