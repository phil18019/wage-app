// app/lib/engine/week.ts
import type { Settings } from "../settings";
import { getRateForDate } from "../settings";
import { computePremiumHours, getPremiumWindows } from "./premiums";

export type Flag = "" | "Y" | "P";

export type ShiftRow = {
  id: string;
  date: string; // YYYY-MM-DD
  scheduledHours?: number;
  startTime?: string; // "HH:MM"
  endTime?: string; // "HH:MM"
  holidayFlag?: Flag;
  unpaidFlag?: Flag;
  lieuFlag?: Flag;
  bankHolFlag?: Flag;
  doubleFlag?: Flag;
  sickHours?: number;
};

export type WeekTotals = {
  weekId: string; // week start YYYY-MM-DD
  label: string;

  worked: number;
  qualifying: number;
  std: number;
  ot: number;
  late: number;
  night: number;
  hol: number;
  lieu: number;
  bankHol: number;
  dbl: number;
  unpaidFull: number;
  unpaidPart: number;
  sick: number;

  stdPay: number;
  otPay: number;
  sickPay: number;
  lateAddPay: number;
  nightAddPay: number;
  lieuPay: number;
  bankHolPay: number;
  doublePay: number;
  holPay: number;
  totalPay: number;
};

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function clampNonNeg(n: number) {
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function isValidYMD(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test((s || "").trim());
}

function parseYMDToUTCDate(ymd: string) {
  // treat YYYY-MM-DD as UTC midnight to avoid timezone drift
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
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = (dow - ws + 7) % 7; // days since week start
  d.setUTCDate(d.getUTCDate() - diff);
  return formatUTCDateToYMD(d);
}

function toMinutes(t: string) {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec((t || "").trim());
  if (!m) return NaN;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return NaN;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return NaN;
  return hh * 60 + mm;
}

function addHoursToTime(startTime: string, hours: number) {
  const s = toMinutes(startTime);
  if (!Number.isFinite(s)) return "";
  const mins = Math.round(clampNonNeg(hours) * 60);
  const total = (s + mins) % (24 * 60);
  const hh = String(Math.floor(total / 60)).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

function computeWorkedHours(startTime?: string, endTime?: string) {
  const s = toMinutes(startTime || "");
  const e0 = toMinutes(endTime || "");
  if (!Number.isFinite(s) || !Number.isFinite(e0)) return 0;

  let e = e0;
  if (e <= s) e += 24 * 60; // overnight

  const minutes = Math.max(0, e - s);
  return round2(minutes / 60);
}

/**
 * Same breakdown rules you use in month.ts
 */
function computeRowBreakdown(r: ShiftRow, settings: Settings) {
  const sh = clampNonNeg(Number(r.scheduledHours) || 0);
  const whRaw = clampNonNeg(computeWorkedHours(r.startTime ?? "", r.endTime ?? ""));
  const baseShift = sh > 0 ? sh : whRaw;

  // FULL flags
  const fullUnpaid = r.unpaidFlag === "Y";
  const fullHol = r.holidayFlag === "Y";
  const fullLieu = r.lieuFlag === "Y";
  const fullBH = r.bankHolFlag === "Y";
  const fullDouble = r.doubleFlag === "Y";

  // PART flags
  const partUnpaid = r.unpaidFlag === "P";
  const partHol = r.holidayFlag === "P";
  const partLieu = r.lieuFlag === "P";
  const partBH = r.bankHolFlag === "P";
  const partDouble = r.doubleFlag === "P";

  const workedPhysical = fullUnpaid || fullHol || fullLieu || fullBH ? 0 : whRaw;

  let remainder = round2(Math.max(0, baseShift - workedPhysical));

  const out = {
    worked: workedPhysical,
    hol: 0,
    lieu: 0,
    bankHol: 0,
    dbl: 0,
    unpaidFull: 0,
    unpaidPart: 0,
    sick: clampNonNeg(Number(r.sickHours) || 0),
    late: 0,
    night: 0,
  };

  // FULL allocations (only one should be used)
  if (fullUnpaid) {
    out.unpaidFull = baseShift;
    remainder = 0;
  } else if (fullHol) {
    out.hol = baseShift;
    remainder = 0;
  } else if (fullLieu) {
    out.lieu = baseShift;
    remainder = 0;
  } else if (fullBH) {
    out.bankHol = baseShift;
    remainder = 0;
  }

  // Double allocation (subset of worked)
  if (fullDouble) {
    out.dbl = round2(Math.min(baseShift, Math.max(0, whRaw || baseShift)));
  } else if (partDouble) {
    out.dbl = round2(Math.min(workedPhysical, baseShift / 2));
  }

  // PART allocations (consume remainder once, priority order)
  if (remainder > 0) {
    if (partUnpaid) {
      out.unpaidPart += remainder;
      remainder = 0;
    } else if (partHol) {
      out.hol += remainder;
      remainder = 0;
    } else if (partLieu) {
      out.lieu += remainder;
      remainder = 0;
    } else if (partBH) {
      out.bankHol += remainder;
      remainder = 0;
    }
  }

  // ✅ Premiums (Option A: protect LIEU/BH controlled by a single setting flag)
  const premiumsBlocked = fullHol || fullUnpaid; // ONLY full hol/unpaid

  // Default to TRUE if the field doesn't exist yet (keeps old behaviour)
  const protectLieuBH =
    (settings as any)?.protectPremiumsForLieuBH === undefined
      ? true
      : Boolean((settings as any)?.protectPremiumsForLieuBH);

  if (!premiumsBlocked && baseShift > 0 && r.startTime) {
    const hasEnd = (r.endTime ?? "").trim() !== "";

    const hasLieuOrBH =
      (r.lieuFlag ?? "").trim() !== "" || (r.bankHolFlag ?? "").trim() !== "";

    const hasDouble = (r.doubleFlag ?? "").trim() !== "";

    const normalPremEnd = hasEnd
      ? (r.endTime as string)
      : sh > 0
        ? addHoursToTime(r.startTime, sh)
        : "";

    const scheduledPremEnd =
      sh > 0 ? addHoursToTime(r.startTime, sh) : normalPremEnd;

    let premEnd = "";

    // Double: prefer actual endTime (includes extra premiums if worked > scheduled)
    if (hasDouble) {
      premEnd = hasEnd
        ? (r.endTime as string)
        : sh > 0
          ? addHoursToTime(r.startTime, sh)
          : "";
    }
    // LIEU/BH: only protect to scheduled window if the setting is ON
    else if (hasLieuOrBH && protectLieuBH) {
      premEnd = scheduledPremEnd;
    }
    // Normal (or LIEU/BH with protection OFF)
    else {
      premEnd = normalPremEnd;
    }

    const windows = getPremiumWindows(settings);
    const p = computePremiumHours(r.startTime, premEnd, windows);

    // Premiums count if:
    // - It's a protected scenario (Double always protected; LIEU/BH depends on toggle), OR
    // - There was worked time (normal shifts)
    const premiumsProtected = hasDouble || (hasLieuOrBH && protectLieuBH);

    if (premiumsProtected || workedPhysical > 0) {
      out.late += clampNonNeg(p.lateHours);
      out.night += clampNonNeg(p.nightHours);
    }
  }

  return out;
}

function emptyWeek(weekId: string): WeekTotals {
  return {
    weekId,
    label: `Week starting ${weekId}`,

    worked: 0,
    qualifying: 0,
    std: 0,
    ot: 0,
    late: 0,
    night: 0,
    hol: 0,
    lieu: 0,
    bankHol: 0,
    dbl: 0,
    unpaidFull: 0,
    unpaidPart: 0,
    sick: 0,

    stdPay: 0,
    otPay: 0,
    sickPay: 0,
    lateAddPay: 0,
    nightAddPay: 0,
    lieuPay: 0,
    bankHolPay: 0,
    doublePay: 0,
    holPay: 0,
    totalPay: 0,
  };
}

/**
 * ✅ WEEKLY OT ENGINE
 * - Groups by week start (settings.weekStartsOn)
 * - OT threshold applies per week and resets each new week
 * - Qualifying includes worked + hol + lieu + bankHol
 * - OT can only be paid from worked hours excluding Double subset
 * - holidayRate stays from Settings (not history)
 */

export function computeWeeklyTotals(
  rows: ShiftRow[],
  settings: Settings,
  weekStartsOn: number
): WeekTotals[] {
  const holRate = clampNonNeg(settings.holidayRate);

  // Group rows into week buckets
  const byWeek = new Map<string, ShiftRow[]>();
  for (const r of rows || []) {
    const wk = getWeekStartYMD(r.date || "1900-01-01", weekStartsOn);
    const arr = byWeek.get(wk) ?? [];
    arr.push(r);
    byWeek.set(wk, arr);
  }

  // Week keys sorted descending (newest first) for UI
  const weekIds = [...byWeek.keys()].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));

  const out: WeekTotals[] = [];

  type RowCalc = {
    r: ShiftRow;
    b: ReturnType<typeof computeRowBreakdown>;
    // pay inputs for that shift date
    base: number;
    otAdd: number;
    lateAdd: number;
    nightAdd: number;
    doubleRate: number;
    // worked that can be std/ot (excludes double)
    workedAvail: number;
  };

  for (const weekId of weekIds) {
    const weekRows = (byWeek.get(weekId) ?? []).slice();

    // sort chronological inside the week
    weekRows.sort((a, b) => {
      const da = (a.date || "").trim();
      const db = (b.date || "").trim();
      if (da !== db) return da < db ? -1 : 1;
      const sa = toMinutes(a.startTime || "");
      const sb = toMinutes(b.startTime || "");
      if (Number.isFinite(sa) && Number.isFinite(sb) && sa !== sb) return sa - sb;
      return (a.id || "") < (b.id || "") ? -1 : 1;
    });

    const tot = emptyWeek(weekId);

    // threshold for the whole week = rate effective at week start
    const weekRate = getRateForDate(weekId);
    const otThreshold = clampNonNeg(weekRate.otThreshold);

    const calcs: RowCalc[] = [];

    // ---- PASS 1: compute breakdowns, premiums, and non-OT pay parts ----
    for (const r of weekRows) {
      const b = computeRowBreakdown(r, settings);

      // hour buckets
      tot.worked += b.worked;
      tot.hol += b.hol;
      tot.lieu += b.lieu;
      tot.bankHol += b.bankHol;
      tot.dbl += b.dbl;

      tot.unpaidFull += b.unpaidFull;
      tot.unpaidPart += b.unpaidPart;
      tot.sick += b.sick;

      tot.late += b.late;
      tot.night += b.night;

      // rate for this shift date (pay rise safe)
      const rate = getRateForDate(r.date || "1900-01-01");
      const base = clampNonNeg(rate.baseRate);
      const otAdd = clampNonNeg(rate.otAddOn);
      const lateAdd = clampNonNeg(rate.latePremium);
      const nightAdd = clampNonNeg(rate.nightPremium);
      const doubleRate = clampNonNeg(rate.doubleRate);

      // Non-OT dependent pay parts
      tot.sickPay += round2(b.sick * base);
      tot.lateAddPay += round2(b.late * lateAdd);
      tot.nightAddPay += round2(b.night * nightAdd);

      tot.lieuPay += round2(b.lieu * base);
      tot.bankHolPay += round2(b.bankHol * base);
      tot.doublePay += round2(b.dbl * base * doubleRate);

      // holidayRate is NOT in history (intentionally)
      tot.holPay += round2(b.hol * holRate);

      const workedAvail = round2(Math.max(0, b.worked - b.dbl));

      calcs.push({ r, b, base, otAdd, lateAdd, nightAdd, doubleRate, workedAvail });
    }

    // ---- WEEK-LEVEL qualifying / OT / STD ----
    // Your intended rule: OT triggers from qualifying
    const qualifyingWeek = round2(Math.max(0, tot.worked + tot.hol + tot.lieu + tot.bankHol));
    const otHoursShouldBe = round2(Math.max(0, qualifyingWeek - otThreshold));

    // OT can only be PAID from worked hours (excluding double)
    const workedAvailWeek = round2(
      calcs.reduce((sum, x) => sum + x.workedAvail, 0)
    );

    const otPaidWeek = round2(Math.min(otHoursShouldBe, workedAvailWeek));
    const stdPaidWeek = round2(Math.max(0, workedAvailWeek - otPaidWeek));

    tot.qualifying = qualifyingWeek;
    tot.ot = otPaidWeek;
    tot.std = stdPaidWeek;

    // ---- PASS 2: allocate OT pay to the LAST worked hours of the week ----
    // This prevents LIEU/BH mid-week from "stealing" OT allocation timing.
    let remainingOT = otPaidWeek;

    for (let i = calcs.length - 1; i >= 0; i--) {
      const c = calcs[i];
      if (remainingOT <= 0) break;

      const takeOT = round2(Math.min(c.workedAvail, remainingOT));
      remainingOT = round2(remainingOT - takeOT);

      // OT pay for these hours
      tot.otPay += round2(takeOT * (c.base + c.otAdd));
      // remaining hours in this row are std
      const stdHere = round2(c.workedAvail - takeOT);
      tot.stdPay += round2(stdHere * c.base);
    }

    // Any rows not touched by OT allocation were fully std
    // (only needed if remainingOT exhausted early; loop above already std-paid the rest per row)
    // BUT we already std-paid inside the loop for every row that got considered.
    // We still need to std-pay rows BEFORE the OT allocation starts.
    // So do a simple check: if otPaidWeek < workedAvailWeek, some hours were std-paid already in OT loop,
    // but rows earlier than the last OT allocation haven't been std-paid yet.
    // Easiest: recompute stdPay from scratch based on allocation.

    // Rebuild std/ot pay cleanly (to avoid double counting)
    tot.stdPay = 0;
    tot.otPay = 0;

    remainingOT = otPaidWeek;

    for (let i = calcs.length - 1; i >= 0; i--) {
      const c = calcs[i];
      const takeOT = remainingOT > 0 ? round2(Math.min(c.workedAvail, remainingOT)) : 0;
      remainingOT = round2(remainingOT - takeOT);

      const stdHere = round2(c.workedAvail - takeOT);

      tot.otPay += round2(takeOT * (c.base + c.otAdd));
      tot.stdPay += round2(stdHere * c.base);
    }

    // ---- round hour buckets ----
    tot.worked = round2(tot.worked);
    tot.qualifying = round2(tot.qualifying);
    tot.std = round2(tot.std);
    tot.ot = round2(tot.ot);
    tot.late = round2(tot.late);
    tot.night = round2(tot.night);
    tot.hol = round2(tot.hol);
    tot.lieu = round2(tot.lieu);
    tot.bankHol = round2(tot.bankHol);
    tot.dbl = round2(tot.dbl);
    tot.unpaidFull = round2(tot.unpaidFull);
    tot.unpaidPart = round2(tot.unpaidPart);
    tot.sick = round2(tot.sick);

    // ---- round pay ----
    tot.stdPay = round2(tot.stdPay);
    tot.otPay = round2(tot.otPay);
    tot.sickPay = round2(tot.sickPay);
    tot.lateAddPay = round2(tot.lateAddPay);
    tot.nightAddPay = round2(tot.nightAddPay);
    tot.lieuPay = round2(tot.lieuPay);
    tot.bankHolPay = round2(tot.bankHolPay);
    tot.doublePay = round2(tot.doublePay);
    tot.holPay = round2(tot.holPay);

    tot.totalPay = round2(
      tot.stdPay +
        tot.otPay +
        tot.sickPay +
        tot.lateAddPay +
        tot.nightAddPay +
        tot.lieuPay +
        tot.bankHolPay +
        tot.doublePay +
        tot.holPay
    );

    out.push(tot);
  }

  return out;
}