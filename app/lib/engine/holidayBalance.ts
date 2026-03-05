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

function parseYMDToUTCDate(ymd: string) {
  // YYYY-MM-DD -> UTC midnight
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((ymd || "").trim());
  if (!m) return new Date(Date.UTC(1970, 0, 1));
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  return new Date(Date.UTC(y, mo, d));
}

function ymd(d: Date) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function getTaxYearStartUTC(todayUTC: Date, month: number, day: number) {
  const y = todayUTC.getUTCFullYear();
  const thisYear = new Date(Date.UTC(y, month - 1, day));
  const lastYear = new Date(Date.UTC(y - 1, month - 1, day));
  return todayUTC >= thisYear ? thisYear : lastYear;
}

export function computeHolidayBalance(
  rows: ShiftRow[],
  settings: Settings
): HolidayBalanceResult {
  const startBal = clampNonNeg(settings.holidayStartBalanceHours);

  const startYMD = settings.holidayBalanceStartDateYMD;
  if (!isValidYMD(startYMD)) {
    return {
      periodStart: "",
      holidayTakenHours: 0,
      startingBalance: startBal,
      remainingBalance: startBal,
    };
  }

  // Use "today" in UTC to avoid timezone edge cases
  const now = new Date();
  const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const taxStart = getTaxYearStartUTC(
    todayUTC,
    settings.holidayTaxYearStart.month,
    settings.holidayTaxYearStart.day
  );

  const balanceStart = parseYMDToUTCDate(startYMD);

  const periodStartDate = balanceStart > taxStart ? balanceStart : taxStart;
  const periodStart = ymd(periodStartDate);

  let taken = 0;

  for (const r of rows) {
    if (!isValidYMD(r.date)) continue;
    if (r.date < periodStart) continue;

    const hrs = clampNonNeg(Number(r.scheduledHours) || 0);

    if (r.holidayFlag === "Y") taken += hrs;
    else if (r.holidayFlag === "P") taken += hrs / 2;
  }

  // IMPORTANT: don’t let it go negative (this is what often “looks like a reset” elsewhere)
  const remaining = clampNonNeg(startBal - taken);

  return {
    periodStart,
    holidayTakenHours: round2(taken),
    startingBalance: round2(startBal),
    remainingBalance: round2(remaining),
  };
}