// app/lib/engine/month.ts
import type { Settings } from "../settings";
import { getRateForDate } from "../settings";

export type Flag = "" | "Y" | "P";

export type ShiftRow = {
  id: string;
  date: string;
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

export type MonthTotals = {
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

function computeLateNightHours(startTime?: string, endTime?: string) {
  const s0 = toMinutes(startTime || "");
  const e0 = toMinutes(endTime || "");
  if (!Number.isFinite(s0) || !Number.isFinite(e0))
    return { lateHours: 0, nightHours: 0 };

  let s = s0;
  let e = e0;
  if (e <= s) e += 24 * 60;

  const overlap = (sA: number, eA: number, sB: number, eB: number) =>
    Math.max(0, Math.min(eA, eB) - Math.max(sA, sB));

  let lateMin = 0;
  let nightMin = 0;

  for (const dayOffset of [-1, 0, 1]) {
    const base = dayOffset * 24 * 60;

    // Late: 14:00–22:00
    lateMin += overlap(s, e, base + 14 * 60, base + 22 * 60);

    // Night: 22:00–06:00 (two segments)
    nightMin += overlap(s, e, base + 22 * 60, base + 24 * 60);
    nightMin += overlap(s, e, base + 24 * 60, base + 30 * 60);
  }

  return {
    lateHours: round2(lateMin / 60),
    nightHours: round2(nightMin / 60),
  };
}

export function emptyMonthTotals(): MonthTotals {
  return {
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
 * Row breakdown rules (UNCHANGED)
 */
function computeRowBreakdown(r: ShiftRow) {
  const sh = clampNonNeg(Number(r.scheduledHours) || 0);
  const whRaw = clampNonNeg(
    computeWorkedHours(r.startTime ?? "", r.endTime ?? "")
  );
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

  // FULL allocations
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

  // Premiums
  const premiumsBlocked = fullHol || fullUnpaid; // ONLY full hol/unpaid

  if (!premiumsBlocked && baseShift > 0 && r.startTime) {
    const hasEnd = (r.endTime ?? "").trim() !== "";

    const hasLieuOrBH =
      (r.lieuFlag ?? "").trim() !== "" || (r.bankHolFlag ?? "").trim() !== "";

    const hasDouble = (r.doubleFlag ?? "").trim() !== "";

    let premEnd = "";

    if (hasDouble) {
      premEnd = hasEnd
        ? (r.endTime as string)
        : sh > 0
          ? addHoursToTime(r.startTime, sh)
          : "";
    } else if (hasLieuOrBH) {
      premEnd = sh > 0
        ? addHoursToTime(r.startTime, sh)
        : hasEnd
          ? (r.endTime as string)
          : "";
    } else {
      premEnd = hasEnd
        ? (r.endTime as string)
        : sh > 0
          ? addHoursToTime(r.startTime, sh)
          : "";
    }

    const p = computeLateNightHours(r.startTime, premEnd);
    const premiumsProtected = hasLieuOrBH || hasDouble;

    if (premiumsProtected || workedPhysical > 0) {
      out.late += clampNonNeg(p.lateHours);
      out.night += clampNonNeg(p.nightHours);
    }
  }

  return out;
}

/**
 * ✅ Date-aware rates (pay rise safe)
 * - Uses per-day rates for pay
 * - Locks OT threshold for the period using the FIRST shift date’s threshold
 * - holidayRate stays manual (not in history)
 */
export function computeMonthTotals(rows: ShiftRow[], settings: Settings): MonthTotals {
  const tot = emptyMonthTotals();
  const holRate = clampNonNeg(settings.holidayRate);

  const ordered = [...(rows || [])].sort((a, b) => {
    const da = (a.date || "").trim();
    const db = (b.date || "").trim();
    if (da !== db) return da < db ? -1 : 1;

    const sa = toMinutes(a.startTime || "");
    const sb = toMinutes(b.startTime || "");
    if (Number.isFinite(sa) && Number.isFinite(sb) && sa !== sb) return sa - sb;

    return (a.id || "") < (b.id || "") ? -1 : 1;
  });

  // ✅ lock OT threshold for the whole period
  const periodStartDate = ordered.length ? (ordered[0].date || "1900-01-01") : "1900-01-01";
  const periodOtThreshold = clampNonNeg(getRateForDate(periodStartDate).otThreshold);

  let qualifyingSoFar = 0;
  let otSoFar = 0;

  for (const r of ordered) {
    const b = computeRowBreakdown(r);

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

    // date-aware rate for THIS row
    const rate = getRateForDate(r.date || "1900-01-01");
    const base = clampNonNeg(rate.baseRate);
    const otAdd = clampNonNeg(rate.otAddOn);
    const lateAdd = clampNonNeg(rate.latePremium);
    const nightAdd = clampNonNeg(rate.nightPremium);
    const doubleRate = clampNonNeg(rate.doubleRate);

    const qualifyingThisRow = clampNonNeg(b.worked + b.hol + b.lieu + b.bankHol);
    qualifyingSoFar = round2(qualifyingSoFar + qualifyingThisRow);

    const totalOTShouldBeSoFar = round2(Math.max(0, qualifyingSoFar - periodOtThreshold));
    let otDelta = round2(Math.max(0, totalOTShouldBeSoFar - otSoFar));

    const workedAvailableForStdOtRow = round2(Math.max(0, b.worked - b.dbl));
    if (otDelta > workedAvailableForStdOtRow) otDelta = workedAvailableForStdOtRow;

    const stdRow = round2(Math.max(0, workedAvailableForStdOtRow - otDelta));
    otSoFar = round2(otSoFar + otDelta);

    // pay
    tot.stdPay += round2(stdRow * base);
    tot.otPay += round2(otDelta * (base + otAdd));
    tot.sickPay += round2(b.sick * base);

    tot.lateAddPay += round2(b.late * lateAdd);
    tot.nightAddPay += round2(b.night * nightAdd);

    tot.lieuPay += round2(b.lieu * base);
    tot.bankHolPay += round2(b.bankHol * base);
    tot.doublePay += round2(b.dbl * base * doubleRate);

    tot.holPay += round2(b.hol * holRate);

    tot.std += stdRow;
    tot.ot += otDelta;
  }

  // final rounding
  tot.worked = round2(tot.worked);
  tot.qualifying = round2(tot.worked + tot.hol + tot.lieu + tot.bankHol);
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

  return tot;
}