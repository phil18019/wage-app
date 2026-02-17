"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getQualifyingHours } from "./lib/settings";

type Flag = "" | "Y" | "P";

type Shift = {
  id: string;
  date: string;
  scheduledHours: number;
  startTime: string;
  finishTime: string;

  holidayFlag: Flag;
  unpaidFlag: Flag;
  lieuFlag: Flag;
  bankHolFlag: Flag;
  doubleFlag: Flag;

  sickHours: number;
};

type Rates = {
  baseRate: number;
  lateAddRate: number;
  nightAddRate: number;
  otAddRate: number;
  doubleMult: number;
  holidayRate: number;
};

const STORAGE_KEY = "wage_app_v1";

function timeToMinutes(t: string): number | null {
  if (!t) return null;
  const [hh, mm] = t.split(":").map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return null;
  return hh * 60 + mm;
}

function overlapMinutes(aStart: number, aEnd: number, bStart: number, bEnd: number): number {
  return Math.max(0, Math.min(aEnd, bEnd) - Math.max(aStart, bStart));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function buildInterval(startMin: number, endMin: number): { startMin: number; endMin: number } | null {
  if (endMin <= startMin) return null;
  return { startMin, endMin };
}

function calcActualInterval(startTime: string, finishTime: string): { startMin: number; endMin: number } | null {
  const s = timeToMinutes(startTime);
  const f0 = timeToMinutes(finishTime);
  if (s === null || f0 === null) return null;

  let f = f0;
  if (f < s) f += 1440;
  return buildInterval(s, f);
}

function overlapWindowAcrossDays(startMin: number, endMin: number, winStart: number, winEnd: number): number {
  let mins = 0;
  mins += overlapMinutes(startMin, endMin, winStart, winEnd);
  if (endMin > 1440) {
    mins += overlapMinutes(startMin, endMin, winStart + 1440, winEnd + 1440);
  }
  return mins;
}

function calcLateNightForInterval(interval: { startMin: number; endMin: number }): { late: number; night: number } {
  const { startMin, endMin } = interval;

  const lateMins = overlapWindowAcrossDays(startMin, endMin, 14 * 60, 22 * 60);

  const nightA = overlapWindowAcrossDays(startMin, endMin, 22 * 60, 24 * 60);
  const nightB = overlapWindowAcrossDays(startMin, endMin, 0, 6 * 60);
  const nightMins = nightA + nightB;

  return { late: round2(lateMins / 60), night: round2(nightMins / 60) };
}

function calcTotals(args: {
  startTime: string;
  finishTime: string;
  scheduledHours: number;
  addBackPremiums: boolean;
}): { worked: number; late: number; night: number } {
  const { startTime, finishTime, scheduledHours, addBackPremiums } = args;

  const actual = calcActualInterval(startTime, finishTime);
  if (!actual) return { worked: 0, late: 0, night: 0 };

  const worked = round2((actual.endMin - actual.startMin) / 60);
  const workedPrem = calcLateNightForInterval(actual);

  let lateAddBack = 0;
  let nightAddBack = 0;

  if (addBackPremiums) {
    const schedEndMin = actual.startMin + scheduledHours * 60;
    if (schedEndMin > actual.endMin) {
      const missing = buildInterval(actual.endMin, schedEndMin);
      if (missing) {
        const missPrem = calcLateNightForInterval(missing);
        lateAddBack = missPrem.late;
        nightAddBack = missPrem.night;
      }
    }
  }

  return {
    worked,
    late: round2(workedPrem.late + lateAddBack),
    night: round2(workedPrem.night + nightAddBack),
  };
}

function clamp0(n: number): number {
  return n < 0 ? 0 : n;
}

function safeMoney(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

function formatGBP(n: number): string {
  const v = safeMoney(Math.round(n * 100) / 100);
  return `£${v.toFixed(2)}`;
}

function calcShiftComputed(shift: Shift) {
  const ignoreTime = shift.holidayFlag === "Y" || shift.unpaidFlag === "Y";
  const addBackPremiums = shift.lieuFlag === "P" || shift.bankHolFlag === "P" || shift.doubleFlag === "P";

  const timeRes = ignoreTime
    ? { worked: 0, late: 0, night: 0 }
    : calcTotals({
        startTime: shift.startTime,
        finishTime: shift.finishTime,
        scheduledHours: shift.scheduledHours,
        addBackPremiums,
      });

  const worked = timeRes.worked;
  const missing = clamp0(round2(shift.scheduledHours - worked));

  const holHours = shift.holidayFlag === "Y" ? shift.scheduledHours : shift.holidayFlag === "P" ? missing : 0;
  const holFullHours = shift.holidayFlag === "Y" ? shift.scheduledHours : 0;

  const lieuHours = shift.lieuFlag === "Y" ? shift.scheduledHours : shift.lieuFlag === "P" ? missing : 0;
  const bankHolHours = shift.bankHolFlag === "Y" ? shift.scheduledHours : shift.bankHolFlag === "P" ? missing : 0;

  const unpaidFullHours = shift.unpaidFlag === "Y" ? shift.scheduledHours : 0;
  const unpaidPartHours = shift.unpaidFlag === "P" ? missing : 0;

  const doubleHours = shift.doubleFlag === "Y" ? shift.scheduledHours : shift.doubleFlag === "P" ? worked : 0;
  const doubleStdAddBack = shift.doubleFlag === "P" ? missing : 0;

  return {
    worked,
    late: timeRes.late,
    night: timeRes.night,
    holHours,
    holFullHours,
    lieuHours,
    bankHolHours,
    doubleHours,
    unpaidFullHours,
    unpaidPartHours,
    sickHours: shift.sickHours,
    partHol: shift.holidayFlag === "P" ? missing : 0,
    partLieu: shift.lieuFlag === "P" ? missing : 0,
    partBankHol: shift.bankHolFlag === "P" ? missing : 0,
    doubleStdAddBack,
  };
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function Home() {
  const [rates, setRates] = useState<Rates>({
    baseRate: 17.3,
    lateAddRate: 2.26,
    nightAddRate: 3.45,
    otAddRate: 6.7,
    doubleMult: 2.0,
    holidayRate: 0,
  });

  const qualifyingHours = getQualifyingHours();
  const [date, setDate] = useState("");
  const [scheduledHours, setScheduledHours] = useState(10);
  const [startTime, setStartTime] = useState("");
  const [finishTime, setFinishTime] = useState("");

  const [holidayFlag, setHolidayFlag] = useState<Flag>("");
  const [unpaidFlag, setUnpaidFlag] = useState<Flag>("");
  const [lieuFlag, setLieuFlag] = useState<Flag>("");
  const [bankHolFlag, setBankHolFlag] = useState<Flag>("");
  const [doubleFlag, setDoubleFlag] = useState<Flag>("");

  const [sickHours, setSickHours] = useState(0);
  const [shifts, setShifts] = useState<Shift[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.rates) setRates(parsed.rates);
      if (Array.isArray(parsed?.shifts)) setShifts(parsed.shifts);
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ rates, shifts }));
    } catch {}
  }, [rates, shifts]);

  const timesDisabled = holidayFlag === "Y" || unpaidFlag === "Y";

  const clearTimes = () => {
    setStartTime("");
    setFinishTime("");
  };

  const timesDisabledMessage =
    holidayFlag === "Y"
      ? "Start/Finish times cleared (Holiday = Full)."
      : unpaidFlag === "Y"
      ? "Start/Finish times cleared (Unpaid = Full)."
      : "";

  const live = useMemo(() => {
    if (timesDisabled) return { worked: 0, late: 0, night: 0 };
    const addBackPremiums = lieuFlag === "P" || bankHolFlag === "P" || doubleFlag === "P";
    return calcTotals({ startTime, finishTime, scheduledHours, addBackPremiums });
  }, [timesDisabled, startTime, finishTime, scheduledHours, lieuFlag, bankHolFlag, doubleFlag]);

  const saveShift = () => {
    if (!date) return alert("Please select a date.");
    if (!timesDisabled && (!startTime || !finishTime)) {
      return alert("Please enter start and finish times (or set Holiday/Unpaid to Full).");
    }

    const newShift: Shift = {
      id: (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`) as string,
      date,
      scheduledHours,
      startTime: timesDisabled ? "" : startTime,
      finishTime: timesDisabled ? "" : finishTime,
      holidayFlag,
      unpaidFlag,
      lieuFlag,
      bankHolFlag,
      doubleFlag,
      sickHours: sickHours || 0,
    };

    setShifts((prev) => [newShift, ...prev]);

    setStartTime("");
    setFinishTime("");
    setHolidayFlag("");
    setUnpaidFlag("");
    setLieuFlag("");
    setBankHolFlag("");
    setDoubleFlag("");
    setSickHours(0);
  };

  const deleteShift = (id: string) => setShifts((prev) => prev.filter((s) => s.id !== id));

  const clearMonth = () => {
    if (!confirm("Clear all saved shifts for this month?")) return;
    setShifts([]);
  };

  const month = useMemo(() => {
    let worked = 0,
      late = 0,
      night = 0;

    let hol = 0,
      holFull = 0,
      lieu = 0,
      bankHol = 0,
      dbl = 0;

    let unpaidFull = 0,
      unpaidPart = 0,
      sick = 0;

    let partHol = 0,
      partLieu = 0,
      partBankHol = 0,
      dblStdAddBack = 0;

    for (const s of shifts) {
      const c = calcShiftComputed(s);

      worked += c.worked;
      late += c.late;
      night += c.night;

      hol += c.holHours;
      holFull += c.holFullHours;
      lieu += c.lieuHours;
      bankHol += c.bankHolHours;
      dbl += c.doubleHours;

      unpaidFull += c.unpaidFullHours;
      unpaidPart += c.unpaidPartHours;
      sick += c.sickHours;

      partHol += c.partHol;
      partLieu += c.partLieu;
      partBankHol += c.partBankHol;
      dblStdAddBack += c.doubleStdAddBack;
    }

    worked = round2(worked);
    late = round2(late);
    night = round2(night);

    hol = round2(hol);
    holFull = round2(holFull);
    lieu = round2(lieu);
    bankHol = round2(bankHol);
    dbl = round2(dbl);

    unpaidFull = round2(unpaidFull);
    unpaidPart = round2(unpaidPart);
    sick = round2(sick);

    partHol = round2(partHol);
    partLieu = round2(partLieu);
    partBankHol = round2(partBankHol);
    dblStdAddBack = round2(dblStdAddBack);

    const qualifyingRaw = round2(worked + holFull + partHol + partLieu + partBankHol + dblStdAddBack - sick - unpaidFull);
    const qualifying = round2(Math.max(0, qualifyingRaw));

    const ot = round2(Math.max(0, qualifying - 160));
    const bucket = Math.min(160, qualifying);
    const std = round2(Math.max(0, bucket - (hol + lieu + bankHol + dbl)));

    const sickPay = safeMoney(sick * rates.baseRate);
    const stdPay = safeMoney(std * rates.baseRate);
    const otPay = safeMoney(ot * (rates.baseRate + rates.otAddRate));

    const lateAddPay = safeMoney(late * rates.lateAddRate);
    const nightAddPay = safeMoney(night * rates.nightAddRate);

    const lieuPay = safeMoney(lieu * rates.baseRate);
    const bankHolPay = safeMoney(bankHol * rates.baseRate);
    const doublePay = safeMoney(dbl * (rates.baseRate * rates.doubleMult));
    const holPay = safeMoney(hol * (rates.holidayRate || 0));

    const totalPay = safeMoney(stdPay + otPay + sickPay + lateAddPay + nightAddPay + lieuPay + bankHolPay + doublePay + holPay);

    return {
      worked,
      late,
      night,
      hol,
      lieu,
      bankHol,
      dbl,
      unpaidFull,
      unpaidPart,
      sick,
      qualifying,
      std,
      ot,
      pay: {
        stdPay: round2(stdPay),
        otPay: round2(otPay),
        sickPay: round2(sickPay),
        lateAddPay: round2(lateAddPay),
        nightAddPay: round2(nightAddPay),
        lieuPay: round2(lieuPay),
        bankHolPay: round2(bankHolPay),
        doublePay: round2(doublePay),
        holPay: round2(holPay),
        totalPay: round2(totalPay),
      },
    };
  }, [shifts, rates]);

  const holRateWarning = month.hol > 0 && (!rates.holidayRate || rates.holidayRate <= 0);

  const exportCSV = () => {
    const header = [
      "date",
      "scheduledHours",
      "startTime",
      "finishTime",
      "HOL",
      "UNPAID",
      "LIEU",
      "BH",
      "DOUBLE",
      "sickHours",
      "worked",
      "late",
      "night",
      "holHours",
      "lieuHours",
      "bhHours",
      "doubleHours",
      "unpaidFull",
      "unpaidPart",
    ].join(",");

    const rows = shifts
      .slice()
      .reverse()
      .map((s) => {
        const c = calcShiftComputed(s);
        const vals = [
          s.date,
          s.scheduledHours,
          s.startTime || "",
          s.finishTime || "",
          s.holidayFlag || "",
          s.unpaidFlag || "",
          s.lieuFlag || "",
          s.bankHolFlag || "",
          s.doubleFlag || "",
          s.sickHours || 0,
          c.worked,
          c.late,
          c.night,
          c.holHours,
          c.lieuHours,
          c.bankHolHours,
          c.doubleHours,
          c.unpaidFullHours,
          c.unpaidPartHours,
        ];
        return vals.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(",");
      });

    const summary = [
      "",
      "MONTH_SUMMARY",
      `Qualifying=${month.qualifying}`,
      `STD=${month.std}`,
      `OT=${month.ot}`,
      `Late=${month.late}`,
      `Night=${month.night}`,
      `HOL=${month.hol}`,
      `LIEU=${month.lieu}`,
      `BH=${month.bankHol}`,
      `Double=${month.dbl}`,
      `Sick=${month.sick}`,
      `TotalPay=${month.pay.totalPay}`,
    ].join(",");

    const csv = [header, ...rows, "", summary].join("\n");
    downloadText("wage-app-export.csv", csv);
  };

  return (
    <main className="min-h-screen p-6 max-w-4xl mx-auto">
      <div className="mb-6 flex justify-between items-start">
  <div className="text-center w-full">
    <h1 className="text-2xl font-bold mb-2">Wage Check</h1>
    <p className="text-xs text-gray-500 mb-1">
      Created by Phil Crompton
    </p>
    <p className="text-[10px] text-gray-400">
      v1.0.0
    </p>
  </div>

  <div className="flex gap-2 h-fit">
  <Link
    href="/settings"
    className="text-xs bg-gray-200 px-3 py-1 rounded-lg"
  >
    Settings
  </Link>

  <Link
    href="/help"
    className="text-xs bg-gray-200 px-3 py-1 rounded-lg"
  >
    Help
  </Link>
</div>
</div>

      {/* Rates */}
      <div className="mb-6 border rounded p-4">
        <div className="font-semibold mb-3">Rates (editable)</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-sm font-medium">Base (£/hr)</label>
            <input className="border p-2 w-full rounded" type="number" step="0.01" value={rates.baseRate}
              onChange={(e) => setRates((r) => ({ ...r, baseRate: Number(e.target.value) }))} />
          </div>
          <div>
            <label className="block text-sm font-medium">Late add (£/hr)</label>
            <input className="border p-2 w-full rounded" type="number" step="0.01" value={rates.lateAddRate}
              onChange={(e) => setRates((r) => ({ ...r, lateAddRate: Number(e.target.value) }))} />
          </div>
          <div>
            <label className="block text-sm font-medium">Night add (£/hr)</label>
            <input className="border p-2 w-full rounded" type="number" step="0.01" value={rates.nightAddRate}
              onChange={(e) => setRates((r) => ({ ...r, nightAddRate: Number(e.target.value) }))} />
          </div>
          <div>
            <label className="block text-sm font-medium">OT add (£/hr)</label>
            <input className="border p-2 w-full rounded" type="number" step="0.01" value={rates.otAddRate}
              onChange={(e) => setRates((r) => ({ ...r, otAddRate: Number(e.target.value) }))} />
          </div>
          <div>
            <label className="block text-sm font-medium">Double multiplier</label>
            <input className="border p-2 w-full rounded" type="number" step="0.01" value={rates.doubleMult}
              onChange={(e) => setRates((r) => ({ ...r, doubleMult: Number(e.target.value) }))} />
          </div>
          <div>
            <label className="block text-sm font-medium">HOL rate (£/hr, monthly)</label>
            <input className="border p-2 w-full rounded" type="number" step="0.01" value={rates.holidayRate}
              onChange={(e) => setRates((r) => ({ ...r, holidayRate: Number(e.target.value) }))} />
          </div>
        </div>
        {holRateWarning && (
          <div className="mt-3 text-sm text-red-700">
            HOL hours exist this month but HOL rate is £0.00 — enter a HOL rate to calculate holiday pay.
          </div>
        )}
      </div>

      {/* Live shift */}
      <div className="mb-4 p-4 rounded bg-gray-900 text-white space-y-2 shadow">
        <div className="text-lg font-semibold">This Shift</div>
        <div>Worked Hours: {live.worked}</div>
        <div>Late Premium Hours: {live.late}</div>
        <div>Night Premium Hours: {live.night}</div>
      </div>

      {/* Month summary */}
      <div className="mb-6 p-4 rounded bg-blue-900 text-white space-y-3 shadow">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="text-lg font-semibold">This Month</div>
          <div className="flex gap-2">
            <button className="px-4 py-2 rounded bg-green-600 hover:bg-green-700 font-semibold" onClick={exportCSV}>
              Export CSV
            </button>
            <button className="px-4 py-2 rounded bg-red-600 hover:bg-red-700 font-semibold" onClick={clearMonth}>
              Clear Month
            </button>
          </div>
        </div>

        <div className="text-lg font-semibold">Hours</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
          <div>Total Worked: {month.worked}</div>
         <div>Qualifying (for {qualifyingHours}): {month.qualifying}</div>
          <div>STD Hours: {month.std}</div>
          <div>OT Hours: {month.ot}</div>
          <div>Late Prem: {month.late}</div>
          <div>Night Prem: {month.night}</div>
          <div>HOL Hours: {month.hol}</div>
          <div>LIEU Hours: {month.lieu}</div>
          <div>BH Hours: {month.bankHol}</div>
          <div>Double Hours: {month.dbl}</div>
          <div>Unpaid (Full): {month.unpaidFull}</div>
          <div>Unpaid (Part): {month.unpaidPart}</div>
          <div>Sick Hours: {month.sick}</div>
        </div>

        <div className="pt-3 border-t border-white/20">
          <div className="text-lg font-semibold mb-2">Pay (£)</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
            <div>STD pay: {formatGBP(month.pay.stdPay)}</div>
            <div>OT pay: {formatGBP(month.pay.otPay)}</div>
            <div>Sick pay: {formatGBP(month.pay.sickPay)}</div>
            <div>Late add-on: {formatGBP(month.pay.lateAddPay)}</div>
            <div>Night add-on: {formatGBP(month.pay.nightAddPay)}</div>
            <div>LIEU pay: {formatGBP(month.pay.lieuPay)}</div>
            <div>BH pay: {formatGBP(month.pay.bankHolPay)}</div>
            <div>Double pay: {formatGBP(month.pay.doublePay)}</div>
            <div>HOL pay: {formatGBP(month.pay.holPay)}</div>
          </div>
          <div className="mt-2 text-xl font-bold">Total: {formatGBP(month.pay.totalPay)}</div>
        </div>
      </div>

      {/* Form */}
      <div className="space-y-4">
        <div>
          <label className="block font-medium">Date</label>
          <input type="date" className="border p-2 w-full rounded" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        <div>
          <label className="block font-medium">Scheduled Hours</label>
          <input type="number" className="border p-2 w-full rounded" value={scheduledHours} onChange={(e) => setScheduledHours(Number(e.target.value))} />
        </div>

        <div>
          <label className="block font-medium">Sick Hours (this day)</label>
          <input type="number" className="border p-2 w-full rounded" value={sickHours} min={0} onChange={(e) => setSickHours(Number(e.target.value))} />
        </div>

        {holidayFlag === "Y" || unpaidFlag === "Y" ? (
          <div className="p-3 rounded border bg-gray-50 text-gray-700">
            {timesDisabledMessage}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-medium">Start Time</label>
              <input type="time" className="border p-2 w-full rounded" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </div>
            <div>
              <label className="block font-medium">Finish Time</label>
              <input type="time" className="border p-2 w-full rounded" value={finishTime} onChange={(e) => setFinishTime(e.target.value)} />
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block font-medium">Holiday</label>
            <select className="border p-2 w-full rounded" value={holidayFlag}
              onChange={(e) => { const v = e.target.value as Flag; setHolidayFlag(v); if (v === "Y") clearTimes(); }}>
              <option value="">None</option>
              <option value="Y">Full (Y)</option>
              <option value="P">Part (P)</option>
            </select>
          </div>

          <div>
            <label className="block font-medium">Unpaid</label>
            <select className="border p-2 w-full rounded" value={unpaidFlag}
              onChange={(e) => { const v = e.target.value as Flag; setUnpaidFlag(v); if (v === "Y") clearTimes(); }}>
              <option value="">None</option>
              <option value="Y">Full (Y)</option>
              <option value="P">Part (P)</option>
            </select>
          </div>

          <div>
            <label className="block font-medium">LIEU</label>
            <select className="border p-2 w-full rounded" value={lieuFlag} onChange={(e) => setLieuFlag(e.target.value as Flag)}>
              <option value="">None</option>
              <option value="Y">Full (Y)</option>
              <option value="P">Part (P)</option>
            </select>
          </div>

          <div>
            <label className="block font-medium">Bank Holiday</label>
            <select className="border p-2 w-full rounded" value={bankHolFlag} onChange={(e) => setBankHolFlag(e.target.value as Flag)}>
              <option value="">None</option>
              <option value="Y">Full (Y)</option>
              <option value="P">Part (P)</option>
            </select>
          </div>

          <div className="sm:col-span-2">
            <label className="block font-medium">Double</label>
            <select className="border p-2 w-full rounded" value={doubleFlag} onChange={(e) => setDoubleFlag(e.target.value as Flag)}>
              <option value="">None</option>
              <option value="Y">Full (Y)</option>
              <option value="P">Part (P)</option>
            </select>
          </div>
        </div>

        <button className="w-full p-3 rounded bg-green-600 text-white font-semibold hover:bg-green-700" onClick={saveShift}>
          Save Shift
        </button>
      </div>

      <hr className="my-8" />

      <h2 className="text-xl font-bold mb-3">Saved Shifts</h2>

      {shifts.length === 0 ? (
        <p className="text-gray-600">No shifts saved yet.</p>
      ) : (
        <div className="space-y-3">
          {shifts.map((s) => {
            const c = calcShiftComputed(s);
            return (
              <div key={s.id} className="border rounded p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold">{s.date}</div>
                    <div className="text-sm text-gray-700">
                      Scheduled: {s.scheduledHours} | Start: {s.startTime || "-"} | Finish: {s.finishTime || "-"} | Sick: {s.sickHours}
                    </div>
                    <div className="text-sm text-gray-700">
                      Worked: {c.worked} | Late: {c.late} | Night: {c.night}
                    </div>
                    <div className="text-sm text-gray-700">
                      Buckets — HOL: {c.holHours} | LIEU: {c.lieuHours} | BH: {c.bankHolHours} | Double: {c.doubleHours} | Unpaid(full): {c.unpaidFullHours} | Unpaid(part): {c.unpaidPartHours}
                    </div>
                    <div className="text-xs text-gray-500">
                      Flags — HOL:{s.holidayFlag || "-"} UNP:{s.unpaidFlag || "-"} LIEU:{s.lieuFlag || "-"} BH:{s.bankHolFlag || "-"} DBL:{s.doubleFlag || "-"}
                    </div>
                  </div>

                  <button className="px-3 py-1 rounded bg-red-600 text-white text-sm hover:bg-red-700" onClick={() => deleteShift(s.id)}>
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
