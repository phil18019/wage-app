import type { Settings } from "../settings";

export type Flag = "" | "Y" | "P";

export type ShiftRow = {
  id: string;
  date: string;
  scheduledHours?: number;
  startTime?: string; // "HH:MM"
  endTime?: string;   // "HH:MM"
  holidayFlag?: Flag;
  unpaidFlag?: Flag;
  lieuFlag?: Flag;
  bankHolFlag?: Flag;
  doubleFlag?: Flag;
  sickHours?: number;
};

export type MonthTotals = {
  worked: number;       // physical worked hours (from times, except full HOL/Unpaid/Lieu/BH)
  qualifying: number;   // counts for OT trigger
  std: number;          // standard paid hours (worked only, excluding double + OT)
  ot: number;           // OT paid hours (worked only, excluding double)
  late: number;
  night: number;
  hol: number;
  lieu: number;
  bankHol: number;
  dbl: number;          // hours paid at double rate (subset of worked)
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
  if (!Number.isFinite(s0) || !Number.isFinite(e0)) return { lateHours: 0, nightHours: 0 };

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
 * Rules used (matches what you described):
 * - FULL Holiday/Unpaid: NO premiums. Worked becomes 0. HOL/Unpaid = scheduled shift.
 * - FULL Lieu/BH: Worked becomes 0, but premiums ARE protected (calculated across scheduled shift).
 * - FULL Double: shift is physically worked. Double hours = scheduled shift (or worked if no scheduled). Premiums protected.
 * - PART Holiday/Unpaid/Lieu/BH: you still work the entered time window; remainder = scheduled - worked goes to that flag.
 * - Premium protection applies for Lieu/BH/Double (Y or P). Holiday/Unpaid never protected when FULL.
 * - Qualifying for OT = worked + hol + lieu + bankHol (double is NOT added; it’s a subset of worked).
 * - OT paid hours can only come from worked hours that are NOT already paid as Double.
 */
function computeRowBreakdown(r: ShiftRow) {
  const sh = clampNonNeg(Number(r.scheduledHours) || 0);
  const whRaw = clampNonNeg(computeWorkedHours(r.startTime, r.endTime));
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

  // Worked physical:
  // - Full HOL/Unpaid/Lieu/BH = not worked
  // - Full Double = still worked (paid double)
  const workedPhysical =
    (fullUnpaid || fullHol || fullLieu || fullBH) ? 0 : Math.min(whRaw, baseShift);

  // Remainder for PART flags = scheduled - worked
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

  // Double allocation (subset of worked, not remainder)
  // If FULL double: double the scheduled shift (or the baseShift)
  // If PART double: half of the scheduled/baseShift, but cannot exceed workedPhysical
  if (fullDouble) {
    out.dbl = round2(Math.min(baseShift, Math.max(0, whRaw || baseShift)));
  } else if (partDouble) {
    out.dbl = round2(Math.min(workedPhysical, baseShift / 2));
  }

  // PART allocations (consume remainder once, priority order)
  if (remainder > 0) {
    if (partUnpaid) { out.unpaidPart += remainder; remainder = 0; }
    else if (partHol) { out.hol += remainder; remainder = 0; }
    else if (partLieu) { out.lieu += remainder; remainder = 0; }
    else if (partBH) { out.bankHol += remainder; remainder = 0; }
  }

  // Premiums
const premiumsBlocked = fullHol || fullUnpaid; // ONLY full hol/unpaid

if (!premiumsBlocked && baseShift > 0 && r.startTime) {
  const premiumsProtected =
    (r.lieuFlag ?? "") !== "" ||
    (r.bankHolFlag ?? "") !== "" ||
    (r.doubleFlag ?? "") !== "";

    const premEnd =
      premiumsProtected && sh > 0
        ? addHoursToTime(r.startTime, sh)
        : (r.endTime || "");

    const p = computeLateNightHours(r.startTime, premEnd);

    // If protected: premiums always apply (even if workedPhysical = 0 like full Lieu)
    // If NOT protected: only apply when physically worked
    if (premiumsProtected || workedPhysical > 0) {
      out.late += clampNonNeg(p.lateHours);
      out.night += clampNonNeg(p.nightHours);
    }
  }

  return out;
}

export function computeMonthTotals(rows: ShiftRow[], settings: Settings): MonthTotals {
  const tot = emptyMonthTotals();

  const base = clampNonNeg(settings.baseRate);
  const otAdd = clampNonNeg(settings.otAddOn);
  const lateAdd = clampNonNeg(settings.latePremium);
  const nightAdd = clampNonNeg(settings.nightPremium);
  const holRate = clampNonNeg(settings.holidayRate);
  const otThreshold = clampNonNeg(settings.otThreshold);
  const doubleRate = clampNonNeg(settings.doubleRate);

  for (const r of rows) {
    const b = computeRowBreakdown(r);

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
  }

  // Round hour buckets
  tot.worked = round2(tot.worked);
  tot.hol = round2(tot.hol);
  tot.lieu = round2(tot.lieu);
  tot.bankHol = round2(tot.bankHol);
  tot.dbl = round2(tot.dbl);
  tot.late = round2(tot.late);
  tot.night = round2(tot.night);
  tot.unpaidFull = round2(tot.unpaidFull);
  tot.unpaidPart = round2(tot.unpaidPart);
  tot.sick = round2(tot.sick);

  // Qualifying for OT trigger (double is NOT added; it’s a subset of worked)
  tot.qualifying = round2(tot.worked + tot.hol + tot.lieu + tot.bankHol);

  // OT paid hours can only come from worked hours that are NOT already paid double
  const otRaw = Math.max(0, tot.qualifying - otThreshold);
  const workedAvailableForStdOt = Math.max(0, tot.worked - tot.dbl);

  tot.ot = round2(Math.min(workedAvailableForStdOt, otRaw));
  tot.std = round2(Math.max(0, workedAvailableForStdOt - tot.ot));

  // PAY
  tot.stdPay = round2(tot.std * base);
  tot.otPay = round2(tot.ot * (base + otAdd));
  tot.sickPay = round2(tot.sick * base);

  tot.lateAddPay = round2(tot.late * lateAdd);
  tot.nightAddPay = round2(tot.night * nightAdd);

  tot.lieuPay = round2(tot.lieu * base);
  tot.bankHolPay = round2(tot.bankHol * base);
  tot.doublePay = round2(tot.dbl * base * doubleRate);
  tot.holPay = round2(tot.hol * holRate);

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