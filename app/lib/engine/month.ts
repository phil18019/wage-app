// app/lib/engine/month.ts
import type { Settings } from "../settings";
import type { ShiftRow } from "./week";
import { computeWeeklyTotals } from "./week";

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
 * ✅ Month totals now come from summing weekly totals
 * so OT is truly weekly and resets each week.
 */
export function computeMonthTotals(rows: ShiftRow[], settings: Settings): MonthTotals {
  const tot = emptyMonthTotals();

  const weekStartsOn = Number.isFinite(settings.weekStartsOn)
    ? Math.min(6, Math.max(0, Math.floor(settings.weekStartsOn)))
    : 0;

  const weeks = computeWeeklyTotals(rows || [], settings, weekStartsOn);

  for (const w of weeks) {
    tot.worked += w.worked;
    tot.qualifying += w.qualifying;
    tot.std += w.std;
    tot.ot += w.ot;

    tot.late += w.late;
    tot.night += w.night;

    tot.hol += w.hol;
    tot.lieu += w.lieu;
    tot.bankHol += w.bankHol;
    tot.dbl += w.dbl;

    tot.unpaidFull += w.unpaidFull;
    tot.unpaidPart += w.unpaidPart;
    tot.sick += w.sick;

    tot.stdPay += w.stdPay;
    tot.otPay += w.otPay;
    tot.sickPay += w.sickPay;
    tot.lateAddPay += w.lateAddPay;
    tot.nightAddPay += w.nightAddPay;
    tot.lieuPay += w.lieuPay;
    tot.bankHolPay += w.bankHolPay;
    tot.doublePay += w.doublePay;
    tot.holPay += w.holPay;
    tot.totalPay += w.totalPay;
  }

  // final rounding
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

  tot.stdPay = round2(tot.stdPay);
  tot.otPay = round2(tot.otPay);
  tot.sickPay = round2(tot.sickPay);
  tot.lateAddPay = round2(tot.lateAddPay);
  tot.nightAddPay = round2(tot.nightAddPay);
  tot.lieuPay = round2(tot.lieuPay);
  tot.bankHolPay = round2(tot.bankHolPay);
  tot.doublePay = round2(tot.doublePay);
  tot.holPay = round2(tot.holPay);
  tot.totalPay = round2(tot.totalPay);

  return tot;
}