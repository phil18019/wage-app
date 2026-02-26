"use client";

export type RateSnapshot = {
  effectiveDate: string; // YYYY-MM-DD
  baseRate: number;
  otAddOn: number;
  latePremium: number;
  nightPremium: number;
  otThreshold: number;
  doubleRate: number;
};

export type Settings = {
  // manual (NOT stored in history)
  holidayRate: number;

  // other settings
  weekStartsOn: number; // 0=Sun … 6=Sat

  // rate history (Option 2)
  rates: RateSnapshot[];
};

export const SETTINGS_KEY = "wagecheck.settings.v1";

const BASE_DEFAULT_RATE: RateSnapshot = {
  effectiveDate: "1900-01-01",
  baseRate: 17.3,
  otAddOn: 6.7,
  latePremium: 2.26,
  nightPremium: 3.45,
  otThreshold: 160,
  doubleRate: 2,
};

export const DEFAULT_SETTINGS: Settings = {
  holidayRate: 0,
  weekStartsOn: 0,
  rates: [BASE_DEFAULT_RATE],
};

function safeNum(x: unknown, fallback: number) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function clampWeekStartsOn(x: unknown, fallback: number) {
  const n = safeNum(x, fallback);
  const i = Math.floor(n);
  return Math.min(6, Math.max(0, i));
}

function isValidYMD(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function normalizeRates(rates: any[]): RateSnapshot[] {
  const cleaned: RateSnapshot[] = [];

  for (const r of rates || []) {
    const eff = isValidYMD(r?.effectiveDate) ? r.effectiveDate : null;
    if (!eff) continue;

    cleaned.push({
      effectiveDate: eff,
      baseRate: safeNum(r?.baseRate, BASE_DEFAULT_RATE.baseRate),
      otAddOn: safeNum(r?.otAddOn, BASE_DEFAULT_RATE.otAddOn),
      latePremium: safeNum(r?.latePremium, BASE_DEFAULT_RATE.latePremium),
      nightPremium: safeNum(r?.nightPremium, BASE_DEFAULT_RATE.nightPremium),
      otThreshold: safeNum(r?.otThreshold, BASE_DEFAULT_RATE.otThreshold),
      doubleRate: safeNum(r?.doubleRate, BASE_DEFAULT_RATE.doubleRate),
    });
  }

  // Ensure at least one record exists
  if (cleaned.length === 0) return [BASE_DEFAULT_RATE];

  // Sort ascending by date
  cleaned.sort((a, b) =>
    a.effectiveDate < b.effectiveDate ? -1 : a.effectiveDate > b.effectiveDate ? 1 : 0
  );

  // Deduplicate by effectiveDate (keep last)
  const dedup: RateSnapshot[] = [];
  for (const item of cleaned) {
    const idx = dedup.findIndex((x) => x.effectiveDate === item.effectiveDate);
    if (idx >= 0) dedup[idx] = item;
    else dedup.push(item);
  }

  return dedup;
}

/**
 * Migration:
 * If user has old single-values settings (baseRate, otAddOn, etc),
 * convert them into rates[] with effectiveDate "1900-01-01".
 */
function migrateIfLegacy(parsed: any): Settings {
  const isLegacy =
    parsed &&
    typeof parsed === "object" &&
    ("baseRate" in parsed ||
      "otAddOn" in parsed ||
      "latePremium" in parsed ||
      "nightPremium" in parsed ||
      "otThreshold" in parsed ||
      "doubleRate" in parsed);

  if (!isLegacy) return parsed as Settings;

  const legacyRate: RateSnapshot = {
    effectiveDate: "1900-01-01",
    baseRate: safeNum(parsed?.baseRate, BASE_DEFAULT_RATE.baseRate),
    otAddOn: safeNum(parsed?.otAddOn, BASE_DEFAULT_RATE.otAddOn),
    latePremium: safeNum(parsed?.latePremium, BASE_DEFAULT_RATE.latePremium),
    nightPremium: safeNum(parsed?.nightPremium, BASE_DEFAULT_RATE.nightPremium),
    otThreshold: safeNum(parsed?.otThreshold, BASE_DEFAULT_RATE.otThreshold),
    doubleRate: safeNum(parsed?.doubleRate, BASE_DEFAULT_RATE.doubleRate),
  };

  return {
    holidayRate: safeNum(parsed?.holidayRate, DEFAULT_SETTINGS.holidayRate),
    weekStartsOn: clampWeekStartsOn(parsed?.weekStartsOn, DEFAULT_SETTINGS.weekStartsOn),
    rates: normalizeRates([legacyRate]),
  };
}

export function getSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;

    const parsed0 = JSON.parse(raw);
    const parsed = migrateIfLegacy(parsed0);

    return {
      holidayRate: safeNum(parsed?.holidayRate, DEFAULT_SETTINGS.holidayRate),
      weekStartsOn: clampWeekStartsOn(parsed?.weekStartsOn, DEFAULT_SETTINGS.weekStartsOn),
      rates: normalizeRates(Array.isArray(parsed?.rates) ? parsed.rates : []),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: Settings) {
  try {
    const normalized: Settings = {
      holidayRate: safeNum(s?.holidayRate, DEFAULT_SETTINGS.holidayRate),
      weekStartsOn: clampWeekStartsOn(s?.weekStartsOn, DEFAULT_SETTINGS.weekStartsOn),
      rates: normalizeRates(Array.isArray(s?.rates) ? s.rates : []),
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalized));
  } catch {}
}

export function restoreDefaultSettings() {
  saveSettings(DEFAULT_SETTINGS);
}

/**
 * Core helper used by month.ts:
 * returns the latest rate whose effectiveDate <= date
 */
export function getRateForDate(date: string): RateSnapshot {
  const s = getSettings();
  const rates = normalizeRates(s.rates);

  const d = isValidYMD(date) ? date : "1900-01-01";

  // rates ascending; pick last <= d
  let best = rates[0];
  for (const r of rates) {
    if (r.effectiveDate <= d) best = r;
    else break;
  }
  return best;
}

export function getCurrentRate(): RateSnapshot {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  return getRateForDate(`${yyyy}-${mm}-${dd}`);
}

export function addOrUpdateRateChange(
  effectiveDate: string,
  rate: Omit<RateSnapshot, "effectiveDate">
) {
  const eff = isValidYMD(effectiveDate) ? effectiveDate : null;
  if (!eff) return;

  const s = getSettings();
  const rates = normalizeRates(s.rates);

  const next: RateSnapshot = { effectiveDate: eff, ...rate };

  const idx = rates.findIndex((r) => r.effectiveDate === eff);
  if (idx >= 0) rates[idx] = next;
  else rates.push(next);

  rates.sort((a, b) => (a.effectiveDate < b.effectiveDate ? -1 : 1));

  saveSettings({ ...s, rates });
}

export function deleteRateChange(effectiveDate: string) {
  const s = getSettings();
  const rates = normalizeRates(s.rates);

  const next = rates.filter((r) => r.effectiveDate !== effectiveDate);
  if (next.length === 0) return; // keep at least 1

  saveSettings({ ...s, rates: next });
}

export function getQualifyingHours(): number {
  // “current” threshold for UI convenience
  return getCurrentRate().otThreshold;
}