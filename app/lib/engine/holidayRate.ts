// app/lib/engine/holidayRate.ts
import type { Settings } from "../settings";
import type { ShiftRow, WeekTotals } from "./week";
import { computeWeeklyTotals } from "./week";
import { getRateForDate } from "../settings";

export type HolidayRateResult = {
  available: boolean;
  rate: number;
  lookbackStartWeekId: string;
  lookbackEndWeekId: string;
  weeksRequired: number;
  reason?: string;
};

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function isValidYMD(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test((s || "").trim());
}

function parseYMDToUTCDate(ymd: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((ymd || "").trim());
  if (!m) return new Date(Date.UTC(1970, 0, 1));
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  return new Date(Date.UTC(y, mo, d));
}

function formatUTCDateToYMD(d: Date) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getWeekStartYMD(dateYMD: string, weekStartsOn: number) {
  const ws = Number.isFinite(weekStartsOn)
    ? Math.min(6, Math.max(0, Math.floor(weekStartsOn)))
    : 0;

  const d = parseYMDToUTCDate(isValidYMD(dateYMD) ? dateYMD : "1900-01-01");
  const dow = d.getUTCDay();
  const diff = (dow - ws + 7) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  return formatUTCDateToYMD(d);
}

function addDays(dateYMD: string, days: number) {
  const d = parseYMDToUTCDate(dateYMD);
  d.setUTCDate(d.getUTCDate() + days);
  return formatUTCDateToYMD(d);
}

function getRequiredLookbackWeekIds(
  holidayWeekId: string,
  lookbackWeeks: number
): string[] {
  const ids: string[] = [];

  // previous full weeks only — do NOT include the holiday week itself
  for (let i = lookbackWeeks; i >= 1; i--) {
    ids.push(addDays(holidayWeekId, -(i * 7)));
  }

  return ids;
}

/**
 * Strict version:
 * - requires at least one stored row in every week of the lookback window
 * - numerator = worked pay only
 * - divisor = lookbackWeeks * contractHoursPerWeek
 */
export function computeHolidayRateForWeek(
  holidayWeekId: string,
  rows: ShiftRow[],
  settings: Settings
): HolidayRateResult {
  const lookbackWeeks = Math.max(1, Math.floor(settings.holidayLookbackWeeks || 12));
  const contractHoursPerWeek = Math.max(0, Number(settings.holidayContractHoursPerWeek || 40));
  const weekStartsOn = Number.isFinite(settings.weekStartsOn)
    ? Math.min(6, Math.max(0, Math.floor(settings.weekStartsOn)))
    : 0;

  const requiredWeekIds = getRequiredLookbackWeekIds(holidayWeekId, lookbackWeeks);
  const requiredSet = new Set(requiredWeekIds);

  const lookbackRows = (rows || []).filter((r) => {
    const wk = getWeekStartYMD(r.date || "1900-01-01", weekStartsOn);
    return requiredSet.has(wk);
  });

  // STRICT RULE:
  // every required lookback week must have at least one stored row
  const seenWeekIds = new Set(
    lookbackRows.map((r) => getWeekStartYMD(r.date || "1900-01-01", weekStartsOn))
  );

  for (const wk of requiredWeekIds) {
    if (!seenWeekIds.has(wk)) {
      return {
        available: false,
        rate: 0,
        lookbackStartWeekId: requiredWeekIds[0],
        lookbackEndWeekId: requiredWeekIds[requiredWeekIds.length - 1],
        weeksRequired: lookbackWeeks,
        reason: `Missing stored history for week starting ${wk}`,
      };
    }
  }

  const weeklyTotals: WeekTotals[] = computeWeeklyTotals(
    lookbackRows,
    settings,
    weekStartsOn
  );

  const weeklyMap = new Map(weeklyTotals.map((w) => [w.weekId, w]));

  let qualifyingPay = 0;

  for (const wk of requiredWeekIds) {
    const w = weeklyMap.get(wk);
    if (!w) {
      return {
        available: false,
        rate: 0,
        lookbackStartWeekId: requiredWeekIds[0],
        lookbackEndWeekId: requiredWeekIds[requiredWeekIds.length - 1],
        weeksRequired: lookbackWeeks,
        reason: `Unable to build weekly totals for week starting ${wk}`,
      };
    }

    // worked pay only
    qualifyingPay +=
      w.stdPay +
      w.otPay +
      w.lateAddPay +
      w.nightAddPay +
      w.doublePay;
  }

  const divisor = lookbackWeeks * contractHoursPerWeek;

  if (divisor <= 0) {
    return {
      available: false,
      rate: 0,
      lookbackStartWeekId: requiredWeekIds[0],
      lookbackEndWeekId: requiredWeekIds[requiredWeekIds.length - 1],
      weeksRequired: lookbackWeeks,
      reason: "Holiday contract hours divisor is zero",
    };
  }

  const calculatedRate = qualifyingPay / divisor;
const baseRateFloor = Math.max(0, Number(getRateForDate(holidayWeekId).baseRate || 0));
const finalRate = round2(Math.max(calculatedRate, baseRateFloor));

return {
  available: true,
  rate: finalRate,
  lookbackStartWeekId: requiredWeekIds[0],
  lookbackEndWeekId: requiredWeekIds[requiredWeekIds.length - 1],
  weeksRequired: lookbackWeeks,
};
}