import type { Settings } from "../settings";

export type ShiftRow = {
  date: string;
  holidayFlag?: "" | "Y" | "P";
  scheduledHours?: number;
};

export type HolidayBalanceResult = {
  periodStart: string;
  holidayTakenHours: number;
  startingBalance: number;
  remainingBalance: number;
};

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function clampNonNeg(n: number) {
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function isValidYMD(s?: string) {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function getTaxYearStart(today: Date, month: number, day: number) {
  const y = today.getFullYear();

  const thisYear = new Date(Date.UTC(y, month - 1, day));
  const lastYear = new Date(Date.UTC(y - 1, month - 1, day));

  return today >= thisYear ? thisYear : lastYear;
}

function ymd(d: Date) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function computeHolidayBalance(
  rows: ShiftRow[],
  settings: Settings
): HolidayBalanceResult {
  const startBal = clampNonNeg(settings.holidayStartBalanceHours);

  if (!settings.holidayBalanceStartDateYMD) {
    return {
      periodStart: "",
      holidayTakenHours: 0,
      startingBalance: startBal,
      remainingBalance: startBal,
    };
  }

  const today = new Date();

  const taxStart = getTaxYearStart(
    today,
    settings.holidayTaxYearStart.month,
    settings.holidayTaxYearStart.day
  );

  const balanceStart = new Date(settings.holidayBalanceStartDateYMD + "T00:00:00Z");

  const periodStartDate = balanceStart > taxStart ? balanceStart : taxStart;
  const periodStart = ymd(periodStartDate);

  let taken = 0;

  for (const r of rows) {
    if (!isValidYMD(r.date)) continue;
    if (r.date < periodStart) continue;

    if (r.holidayFlag === "Y") {
      taken += clampNonNeg(Number(r.scheduledHours) || 0);
    }

    if (r.holidayFlag === "P") {
      taken += clampNonNeg(Number(r.scheduledHours) || 0) / 2;
    }
  }

  const remaining = startBal - taken;

  return {
    periodStart,
    holidayTakenHours: round2(taken),
    startingBalance: startBal,
    remainingBalance: round2(remaining),
  };
}