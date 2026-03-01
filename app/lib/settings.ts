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

export type PremiumMode = "preset" | "custom";

export type PremiumWindows = {
  late: { start: string; end: string };
  night: { start: string; end: string };
};

export type Settings = {
  // manual (NOT stored in history)
  holidayRate: number;

  // other settings
  weekStartsOn: number; // 0=Sun … 6=Sat

  // rate history
  rates: RateSnapshot[];

  // Premium windows (Late/Night)
  premiumMode: PremiumMode;
  premiumPresetId: string;
  premiumCustomWindows?: PremiumWindows;

  // ✅ Option A: protect premiums for LIEU/BH shifts?
  // Default true (keeps current behaviour)
  protectPremiumsForLieuBH: boolean;

  // Holiday balance
  holidayStartBalanceHours: number; // user entered starting balance
  holidayBalanceStartDateYMD: string; // YYYY-MM-DD (when balance was true)
  holidayTaxYearStart: { month: number; day: number }; // default UK: 4/6
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

const DEFAULT_CUSTOM_WINDOWS: PremiumWindows = {
  late: { start: "14:00", end: "22:00" },
  night: { start: "22:00", end: "06:00" },
};

export const DEFAULT_SETTINGS: Settings = {
  holidayRate: 0,
  weekStartsOn: 0,
  rates: [BASE_DEFAULT_RATE],

  premiumMode: "preset",
  premiumPresetId: "p1",
  premiumCustomWindows: DEFAULT_CUSTOM_WINDOWS,

  // ✅ default ON (protect LIEU/BH premiums)
  protectPremiumsForLieuBH: true,

  // Holiday balance defaults
  holidayStartBalanceHours: 0,
  holidayBalanceStartDateYMD: "", // empty = not configured yet
  holidayTaxYearStart: { month: 4, day: 6 }, // UK tax year start
};

/* ------------------------- small helpers ------------------------- */

function safeNum(x: unknown, fallback: number) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function clampNonNeg(x: unknown, fallback: number) {
  const n = safeNum(x, fallback);
  return Math.max(0, n);
}

function clampInt(x: unknown, fallback: number, min: number, max: number) {
  const n = safeNum(x, fallback);
  const i = Math.floor(n);
  return Math.min(max, Math.max(min, i));
}

function clampWeekStartsOn(x: unknown, fallback: number) {
  return clampInt(x, fallback, 0, 6);
}

function safeBool(x: unknown, fallback: boolean) {
  if (typeof x === "boolean") return x;
  if (x === "true") return true;
  if (x === "false") return false;
  return fallback;
}

function isValidYMD(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function isValidHHMM(s: unknown): s is string {
  return typeof s === "string" && /^\d{2}:\d{2}$/.test(s);
}

/* ------------------------- premium settings normalize ------------------------- */

function normalizePremiumMode(x: unknown): PremiumMode {
  return x === "custom" ? "custom" : "preset";
}

function normalizePremiumPresetId(x: unknown): string {
  return typeof x === "string" && x.trim()
    ? x.trim()
    : DEFAULT_SETTINGS.premiumPresetId;
}

function normalizePremiumCustomWindows(x: unknown): PremiumWindows {
  const obj = x as any;

  const lateStart = isValidHHMM(obj?.late?.start)
    ? obj.late.start
    : DEFAULT_CUSTOM_WINDOWS.late.start;
  const lateEnd = isValidHHMM(obj?.late?.end)
    ? obj.late.end
    : DEFAULT_CUSTOM_WINDOWS.late.end;

  const nightStart = isValidHHMM(obj?.night?.start)
    ? obj.night.start
    : DEFAULT_CUSTOM_WINDOWS.night.start;
  const nightEnd = isValidHHMM(obj?.night?.end)
    ? obj.night.end
    : DEFAULT_CUSTOM_WINDOWS.night.end;

  return {
    late: { start: lateStart, end: lateEnd },
    night: { start: nightStart, end: nightEnd },
  };
}

function normalizeProtectPremiumsForLieuBH(x: unknown): boolean {
  return safeBool(x, DEFAULT_SETTINGS.protectPremiumsForLieuBH);
}

/* ------------------------- holiday balance normalize ------------------------- */

function normalizeTaxYearStart(x: unknown): { month: number; day: number } {
  const obj = x as any;
  const month = clampInt(
    obj?.month,
    DEFAULT_SETTINGS.holidayTaxYearStart.month,
    1,
    12
  );
  const day = clampInt(
    obj?.day,
    DEFAULT_SETTINGS.holidayTaxYearStart.day,
    1,
    31
  );
  return { month, day };
}

function normalizeHolidayStartDate(x: unknown): string {
  // allow empty (not configured yet)
  if (x === "" || x === null || x === undefined) return "";
  return isValidYMD(x) ? x : "";
}

/* ------------------------- rate history normalize ------------------------- */

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

  if (cleaned.length === 0) return [BASE_DEFAULT_RATE];

  cleaned.sort((a, b) =>
    a.effectiveDate < b.effectiveDate
      ? -1
      : a.effectiveDate > b.effectiveDate
        ? 1
        : 0
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
    holidayRate: clampNonNeg(parsed?.holidayRate, DEFAULT_SETTINGS.holidayRate),
    weekStartsOn: clampWeekStartsOn(
      parsed?.weekStartsOn,
      DEFAULT_SETTINGS.weekStartsOn
    ),
    rates: normalizeRates([legacyRate]),

    premiumMode: normalizePremiumMode(parsed?.premiumMode),
    premiumPresetId: normalizePremiumPresetId(parsed?.premiumPresetId),
    premiumCustomWindows: normalizePremiumCustomWindows(
      parsed?.premiumCustomWindows
    ),

    // ✅ new setting (default true if missing)
    protectPremiumsForLieuBH: normalizeProtectPremiumsForLieuBH(
      parsed?.protectPremiumsForLieuBH
    ),

    holidayStartBalanceHours: clampNonNeg(
      parsed?.holidayStartBalanceHours,
      DEFAULT_SETTINGS.holidayStartBalanceHours
    ),
    holidayBalanceStartDateYMD: normalizeHolidayStartDate(
      parsed?.holidayBalanceStartDateYMD
    ),
    holidayTaxYearStart: normalizeTaxYearStart(parsed?.holidayTaxYearStart),
  };
}

function normalizeSettingsShape(parsed: any): Settings {
  return {
    holidayRate: clampNonNeg(parsed?.holidayRate, DEFAULT_SETTINGS.holidayRate),
    weekStartsOn: clampWeekStartsOn(
      parsed?.weekStartsOn,
      DEFAULT_SETTINGS.weekStartsOn
    ),
    rates: normalizeRates(Array.isArray(parsed?.rates) ? parsed.rates : []),

    premiumMode: normalizePremiumMode(parsed?.premiumMode),
    premiumPresetId: normalizePremiumPresetId(parsed?.premiumPresetId),
    premiumCustomWindows: normalizePremiumCustomWindows(
      parsed?.premiumCustomWindows
    ),

    // ✅ new setting (default true if missing)
    protectPremiumsForLieuBH: normalizeProtectPremiumsForLieuBH(
      parsed?.protectPremiumsForLieuBH
    ),

    holidayStartBalanceHours: clampNonNeg(
      parsed?.holidayStartBalanceHours,
      DEFAULT_SETTINGS.holidayStartBalanceHours
    ),
    holidayBalanceStartDateYMD: normalizeHolidayStartDate(
      parsed?.holidayBalanceStartDateYMD
    ),
    holidayTaxYearStart: normalizeTaxYearStart(parsed?.holidayTaxYearStart),
  };
}

export function getSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;

    const parsed0 = JSON.parse(raw);
    const parsed = migrateIfLegacy(parsed0);

    return normalizeSettingsShape(parsed);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: Settings) {
  try {
    const normalized = normalizeSettingsShape(s);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalized));
  } catch {
    // ignore
  }
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
  if (next.length === 0) return;

  saveSettings({ ...s, rates: next });
}

export function getQualifyingHours(): number {
  return getCurrentRate().otThreshold;
}