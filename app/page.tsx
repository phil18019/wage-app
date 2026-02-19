"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Flag = "" | "Y" | "P";

type Settings = {
  baseRate: number;        // £/hr
  otAddOn: number;         // £/hr added to base for OT
  nightPremium: number;    // £/hr (add-on)
  latePremium: number;     // £/hr (add-on)
  holidayRate: number;     // £/hr (full holiday rate, not add-on)
  otThreshold: number;     // qualifying hours before OT
  doubleRate: number;     // multiplier for double time (optional, default 2)
};

type ShiftRow = {
  id: string;
  date: string; // YYYY-MM-DD
  scheduledHours: number; // numeric value saved
  startTime: string; // "HH:MM"
  endTime: string;   // "HH:MM"

  holidayFlag: Flag; // "" | "Y" | "P"
  unpaidFlag: Flag;  // "" | "Y" | "P"
  lieuFlag: Flag;    // "" | "Y" | "P"
  bankHolFlag: Flag; // "" | "Y" | "P"
  doubleFlag: Flag;  // "" | "Y" | "P"

  sickHours: number;
};

const STORAGE_KEY_MONTH = "wagecheck.month.v1";
const STORAGE_KEY_SETTINGS = "wagecheck.settings.v1";

const DEFAULT_SETTINGS: Settings = {
  baseRate: 0,
  otAddOn: 0,
  nightPremium: 0,
  latePremium: 0,
  holidayRate: 0,
  otThreshold: 160,
  doubleRate: 2,
};

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function clampNonNeg(n: number) {
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function fmtGBP(n: number) {
  const v = Number.isFinite(n) ? n : 0;
  return `£${v.toFixed(2)}`;
}

function safeNum(x: unknown) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Compute hours worked between start/end times (supports overnight).
 * Returns 0 if times invalid/empty.
 */
function computeWorkedHours(startTime: string, endTime: string) {
  if (!startTime || !endTime) return 0;

  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  if (![sh, sm, eh, em].every((n) => Number.isFinite(n))) return 0;

  const start = sh * 60 + sm;
  let end = eh * 60 + em;

  // Overnight shift
  if (end <= start) end += 24 * 60;

  const minutes = end - start;
  return round2(minutes / 60);
}

/**
 * Late/night premium hours.
 * Adjust these rules to match your workplace if needed.
 *
 * Late: 18:00 -> 22:00
 * Night: 22:00 -> 06:00 (overnight)
 */
function computeLateNightHours(startTime: string, endTime: string) {
  // If no times, no premiums.
  if (!startTime || !endTime) return { lateHours: 0, nightHours: 0 };

  const toMinutes = (t: string) => {
    const [h, m] = t.split(":").map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
    return h * 60 + m;
  };

  let s = toMinutes(startTime);
  let e = toMinutes(endTime);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return { lateHours: 0, nightHours: 0 };

  // Overnight support
  if (e <= s) e += 24 * 60;

  // helper to overlap [s,e) with [a,b)
  const overlap = (a: number, b: number) => Math.max(0, Math.min(e, b) - Math.max(s, a));

  // Late window: 14:00-22:00 (same day)
  const lateMin = overlap(14 * 60, 22 * 60);

  // Night window: 22:00-06:00 (spans midnight)
  // Represent as two windows: 22:00-24:00 and 00:00-06:00 (+24h)
  const nightMin1 = overlap(22 * 60, 24 * 60);
  const nightMin2 = overlap(24 * 60 + 0, 24 * 60 + 6 * 60);

  const lateHours = round2(lateMin / 60);
  const nightHours = round2((nightMin1 + nightMin2) / 60);

  return { lateHours, nightHours };
}

function getSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SETTINGS);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);

    // Support either { baseRate, ... } stored directly OR { rates/settings... }
    const src = parsed?.rates ?? parsed?.settings ?? parsed;

    return {
      baseRate: safeNum(src?.baseRate),
      otAddOn: safeNum(src?.otAddOn),
      nightPremium: safeNum(src?.nightPremium),
      latePremium: safeNum(src?.latePremium),
      holidayRate: safeNum(src?.holidayRate),
      otThreshold: clampNonNeg(safeNum(src?.otThreshold)) || DEFAULT_SETTINGS.otThreshold,
      doubleRate: clampNonNeg(safeNum(src?.doubleRate)) || DEFAULT_SETTINGS.doubleRate,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export default function Home() {
  // Keep settings reactive (update when coming back from Settings page)
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  // Daily inputs (strings so they can be empty)
  const [date, setDate] = useState<string>(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
   return yyyy + "-" + mm + "-" + dd;
  });

  const [scheduledHours, setScheduledHours] = useState<string>(""); // allow empty
  const [startTime, setStartTime] = useState<string>("");
  const [endTime, setEndTime] = useState<string>("");

  const [holidayFlag, setHolidayFlag] = useState<Flag>("");
  const [unpaidFlag, setUnpaidFlag] = useState<Flag>("");
  const [lieuFlag, setLieuFlag] = useState<Flag>("");
  const [bankHolFlag, setBankHolFlag] = useState<Flag>("");
  const [doubleFlag, setDoubleFlag] = useState<Flag>("");

  const [sickHours, setSickHours] = useState<string>(""); // allow empty

  const [rows, setRows] = useState<ShiftRow[]>([]);

  // Load month + settings on mount
  useEffect(() => {
    setSettings(getSettings());

    try {
      const raw = localStorage.getItem(STORAGE_KEY_MONTH);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) setRows(parsed);
    } catch {}
  }, []);

  // Listen for localStorage changes (other tab) + refocus updates (coming back from settings)
  useEffect(() => {
    const refreshSettings = () => setSettings(getSettings());

    window.addEventListener("focus", refreshSettings);
    document.addEventListener("visibilitychange", refreshSettings);
    window.addEventListener("storage", refreshSettings);

    return () => {
      window.removeEventListener("focus", refreshSettings);
      document.removeEventListener("visibilitychange", refreshSettings);
      window.removeEventListener("storage", refreshSettings);
    };
  }, []);

  // Persist month rows
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_MONTH, JSON.stringify(rows));
    } catch {}
  }, [rows]);

  const clearDayInputs = () => {
    setScheduledHours("");
    setStartTime("");
    setEndTime("");
    setHolidayFlag("");
    setUnpaidFlag("");
    setLieuFlag("");
    setBankHolFlag("");
    setDoubleFlag("");
    setSickHours("");
  };

  // Clear inputs when selecting a new date (as you wanted)
  useEffect(() => {
    clearDayInputs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);

  const live = useMemo(() => {
    const sch = clampNonNeg(Number(scheduledHours));
    const sick = clampNonNeg(Number(sickHours));
    const worked = computeWorkedHours(startTime, endTime);

    // When holiday/unpaid is "Y", we treat times as not worked (like before)
    const timesDisabled = holidayFlag === "Y" || unpaidFlag === "Y";
    const workedForCalc = timesDisabled ? 0 : worked;

    const { lateHours, nightHours } = timesDisabled ? { lateHours: 0, nightHours: 0 } : computeLateNightHours(startTime, endTime);

    // Holiday / unpaid / lieu / BH / double – full or part.
    const baseWorked = workedForCalc;

    const hol = holidayFlag === "Y" ? worked : holidayFlag === "P" ? round2(worked * 0.5) : 0;
    const unpaidFull = unpaidFlag === "Y" ? worked : 0;
    const unpaidPart = unpaidFlag === "P" ? round2(worked * 0.5) : 0;

    const lieu = lieuFlag === "Y" ? worked : lieuFlag === "P" ? round2(worked * 0.5) : 0;
    const bankHol = bankHolFlag === "Y" ? worked : bankHolFlag === "P" ? round2(worked * 0.5) : 0;
    const dbl = doubleFlag === "Y" ? worked : doubleFlag === "P" ? round2(worked * 0.5) : 0;

    // “Qualifying” = worked + sick + holiday (matches your earlier approach)
    const qualifying = round2(baseWorked + sick + hol);

    return {
      sch,
      worked: round2(baseWorked),
      late: round2(lateHours),
      night: round2(nightHours),
      hol,
      lieu,
      bankHol,
      dbl,
      unpaidFull,
      unpaidPart,
      sick,
      qualifying,
    };
  }, [scheduledHours, sickHours, startTime, endTime, holidayFlag, unpaidFlag, lieuFlag, bankHolFlag, doubleFlag]);

  const month = useMemo(() => {
    const tot = {
      worked: 0,
      qualifying: 0,
      late: 0,
      night: 0,
      hol: 0,
      lieu: 0,
      bankHol: 0,
      dbl: 0,
      unpaidFull: 0,
      unpaidPart: 0,
      sick: 0,

      // Derived hours:
      std: 0,
      ot: 0,

      // Pay:
      stdPay: 0,
      otPay: 0,
      sickPay: 0,
      lateAddPay: 0,
      nightAddPay: 0,
      holPay: 0,
      lieuPay: 0,
      bankHolPay: 0,
      doublePay: 0,
      totalPay: 0,
    };

    const doubleMult = clampNonNeg(settings.doubleRate ?? 2) || 2;

    for (const r of rows) {
      const wh = clampNonNeg(r.scheduledHours); // stored
      const worked = clampNonNeg(computeWorkedHours(r.startTime, r.endTime));
      const timesDisabled = r.holidayFlag === "Y" || r.unpaidFlag === "Y";
      const workedForCalc = timesDisabled ? 0 : worked;

      const prem = timesDisabled ? { lateHours: 0, nightHours: 0 } : computeLateNightHours(r.startTime, r.endTime);

      const hol = r.holidayFlag === "Y" ? worked : r.holidayFlag === "P" ? round2(worked * 0.5) : 0;
      const unpaidFull = r.unpaidFlag === "Y" ? worked : 0;
      const unpaidPart = r.unpaidFlag === "P" ? round2(worked * 0.5) : 0;

      const lieu = r.lieuFlag === "Y" ? worked : r.lieuFlag === "P" ? round2(worked * 0.5) : 0;
      const bankHol = r.bankHolFlag === "Y" ? worked : r.bankHolFlag === "P" ? round2(worked * 0.5) : 0;
      const dbl = r.doubleFlag === "Y" ? worked : r.doubleFlag === "P" ? round2(worked * 0.5) : 0;

      const sick = clampNonNeg(r.sickHours);

      const qualifying = round2(workedForCalc + sick + hol);

      tot.worked += workedForCalc;
      tot.sick += sick;
      tot.hol += hol;
      tot.lieu += lieu;
      tot.bankHol += bankHol;
      tot.dbl += dbl;
      tot.unpaidFull += unpaidFull;
      tot.unpaidPart += unpaidPart;

      tot.qualifying += qualifying;
      tot.late += clampNonNeg(prem.lateHours);
      tot.night += clampNonNeg(prem.nightHours);
    }

    // Round totals
    tot.worked = round2(tot.worked);
    tot.sick = round2(tot.sick);
    tot.hol = round2(tot.hol);
    tot.lieu = round2(tot.lieu);
    tot.bankHol = round2(tot.bankHol);
    tot.dbl = round2(tot.dbl);
    tot.unpaidFull = round2(tot.unpaidFull);
    tot.unpaidPart = round2(tot.unpaidPart);
    tot.qualifying = round2(tot.qualifying);
    tot.late = round2(tot.late);
    tot.night = round2(tot.night);

    // OT + STD hours
    const threshold = clampNonNeg(settings.otThreshold) || 160;
    const ot = round2(Math.max(0, tot.qualifying - threshold));
    const bucket = Math.min(threshold, tot.qualifying);

    // STD is the “bucket” minus hours already paid as holiday/lieu/BH/double (not paid again at base)
    const std = round2(Math.max(0, bucket - (tot.hol + tot.lieu + tot.bankHol + tot.dbl)));

    tot.ot = ot;
    tot.std = std;

    // Pay
    const base = clampNonNeg(settings.baseRate);
   const otAdd   = clampNonNeg(settings.otAddOn);
   const lateAdd = clampNonNeg(settings.latePremium);
   const nightAdd = clampNonNeg(settings.nightPremium);
    const holRate = clampNonNeg(settings.holidayRate);

   tot.stdPay = round2(tot.std * base);
   tot.otPay  = round2(tot.ot * (base + otAdd));
    tot.sickPay = round2(tot.sick * base);

    tot.lateAddPay = round2(tot.late * lateAdd);
    tot.nightAddPay = round2(tot.night * nightAdd);

    // Lieu/BH/double treated as base pay items here (adjust if your policy differs)
    tot.lieuPay = round2(tot.lieu * base);
    tot.bankHolPay = round2(tot.bankHol * base);

    tot.doublePay = round2(tot.dbl * base * doubleMult);

    // Holiday paid at full holiday rate (not base+add) – this matches your earlier style
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
  }, [rows, settings]);

  const saveDayToMonth = () => {
    // Create row using current day inputs
    const row: ShiftRow = {
      id: date + "-" + Date.now(),
      date,
      scheduledHours: clampNonNeg(Number(scheduledHours)),
      startTime,
      endTime,
      holidayFlag,
      unpaidFlag,
      lieuFlag,
      bankHolFlag,
      doubleFlag,
      sickHours: clampNonNeg(Number(sickHours)),
    };

    setRows((prev) => [...prev, row]);
    clearDayInputs(); // clear after saving (as requested)
  };

  const clearMonth = () => {
    if (!confirm("Clear the saved month rows?")) return;
    setRows([]);
  };

  const exportCSV = () => {
  const header = [
    "date",
    "scheduledHours",
    "startTime",
    "endTime",
    "holidayFlag",
    "unpaidFlag",
    "lieuFlag",
    "bankHolFlag",
    "doubleFlag",
    "sickHours",
  ].join(",");

  // IMPORTANT: use the correct array name here:
  // If your state is called ⁠ rows ⁠, keep ⁠ rows ⁠.
  // If your state is called ⁠ shifts ⁠, change ⁠ rows ⁠ -> ⁠ shifts ⁠.
  const rowsCsv = rows.map((r) => {
  const vals = [
    r.date,
    r.scheduledHours,
    r.startTime,
    r.endTime,
    r.holidayFlag,
    r.unpaidFlag,
    r.lieuFlag,
    r.bankHolFlag,
    r.doubleFlag,
    r.sickHours,
  ];

  return vals.map((v) => '"' + String(v ?? "").replaceAll('"', '""') + '"').join(",");
});

  const summary = [
    "",
    "MONTH_SUMMARY",
    "Worked=" + month.worked,
    "Qualifying=" + month.qualifying,
    "STD=" + month.std,
    "OT=" + month.ot,
    "Late=" + month.late,
    "Night=" + month.night,
    "Holiday=" + month.hol,
    "LIEU=" + month.lieu,
    "BH=" + month.bankHol,
    "Double=" + month.dbl,
    "UnpaidFull=" + month.unpaidFull,
    "UnpaidPart=" + month.unpaidPart,
    "Sick=" + month.sick,
    "TotalPay=" + month.totalPay,
  ].join(",");

  const csv = [header, ...rowsCsv, summary].join("\n");
  downloadText("wage-app-export.csv", csv);
};

  return (
    <main className="min-h-screen p-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6 flex justify-between items-start gap-4">
        <div className="text-center w-full">
          <h1 className="text-2xl font-bold mb-2">Wage Check</h1>
          <p className="text-xs text-gray-500 dark:text-gray-300 mb-1">Created by Phil Crompton</p>
          <p className="text-[10px] text-gray-400 dark:text-gray-400">v1.0.0</p>
        </div>

        <div className="flex gap-2 h-fit">
          <Link
            href="/help"
            className="text-xs bg-gray-200 text-gray-900 hover:bg-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600 px-3 py-1 rounded-lg"
          >
            Help
          </Link>
          <Link
            href="/settings"
            className="text-xs bg-gray-200 text-gray-900 hover:bg-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600 px-3 py-1 rounded-lg"
          >
            Settings
          </Link>
        </div>
      </div>

      {/* This shift */}
      <div className="mb-6 p-5 rounded-2xl bg-blue-900 text-white shadow">
        <div className="text-lg font-semibold mb-4">This shift</div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="opacity-80 mb-1">Date</div>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-gray-900"
            />
          </div>

          <div>
            <div className="opacity-80 mb-1">Scheduled hours</div>
            <input
              type="number"
              inputMode="decimal"
              value={scheduledHours}
              onChange={(e) => setScheduledHours(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-gray-900"
              placeholder=""
            />
          </div>

          <div>
            <div className="opacity-80 mb-1">Start</div>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-gray-900"
            />
          </div>

          <div>
            <div className="opacity-80 mb-1">Finish</div>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-gray-900"
            />
          </div>

          <div>
            <div className="opacity-80 mb-1">Holiday (Y/P)</div>
            <select
              value={holidayFlag}
              onChange={(e) => setHolidayFlag(e.target.value as Flag)}
              className="w-full rounded-lg px-3 py-2 text-gray-900"
            >
              <option value=""></option>
              <option value="Y">Y</option>
              <option value="P">P</option>
            </select>
          </div>

          <div>
            <div className="opacity-80 mb-1">Unpaid (Y/P)</div>
            <select
              value={unpaidFlag}
              onChange={(e) => setUnpaidFlag(e.target.value as Flag)}
              className="w-full rounded-lg px-3 py-2 text-gray-900"
            >
              <option value=""></option>
              <option value="Y">Y</option>
              <option value="P">P</option>
            </select>
          </div>

          <div>
            <div className="opacity-80 mb-1">LIEU (Y/P)</div>
            <select
              value={lieuFlag}
              onChange={(e) => setLieuFlag(e.target.value as Flag)}
              className="w-full rounded-lg px-3 py-2 text-gray-900"
            >
              <option value=""></option>
              <option value="Y">Y</option>
              <option value="P">P</option>
            </select>
          </div>

          <div>
            <div className="opacity-80 mb-1">BH (Y/P)</div>
            <select
              value={bankHolFlag}
              onChange={(e) => setBankHolFlag(e.target.value as Flag)}
              className="w-full rounded-lg px-3 py-2 text-gray-900"
            >
              <option value=""></option>
              <option value="Y">Y</option>
              <option value="P">P</option>
            </select>
          </div>

          <div>
            <div className="opacity-80 mb-1">Double (Y/P)</div>
            <select
              value={doubleFlag}
              onChange={(e) => setDoubleFlag(e.target.value as Flag)}
              className="w-full rounded-lg px-3 py-2 text-gray-900"
            >
              <option value=""></option>
              <option value="Y">Y</option>
              <option value="P">P</option>
            </select>
          </div>

          <div>
            <div className="opacity-80 mb-1">Sick hours</div>
            <input
              type="number"
              inputMode="decimal"
              value={sickHours}
              onChange={(e) => setSickHours(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-gray-900"
              placeholder=""
            />
          </div>
        </div>

        {/* Live cards */}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="bg-blue-950/40 rounded-2xl p-4">
            <div className="opacity-80 text-sm">Worked hours</div>
            <div className="text-3xl font-bold">{live.worked}</div>
          </div>
          <div className="bg-blue-950/40 rounded-2xl p-4">
            <div className="opacity-80 text-sm">Qualifying today</div>
            <div className="text-3xl font-bold">{live.qualifying}</div>
          </div>
          <div className="bg-blue-950/40 rounded-2xl p-4">
            <div className="opacity-80 text-sm">Late premium hours</div>
            <div className="text-3xl font-bold">{live.late}</div>
          </div>
          <div className="bg-blue-950/40 rounded-2xl p-4">
            <div className="opacity-80 text-sm">Night premium hours</div>
            <div className="text-3xl font-bold">{live.night}</div>
          </div>
          <div className="bg-blue-950/40 rounded-2xl p-4">
            <div className="opacity-80 text-sm">Holiday hours</div>
            <div className="text-3xl font-bold">{live.hol}</div>
          </div>
          <div className="bg-blue-950/40 rounded-2xl p-4">
            <div className="opacity-80 text-sm">Unpaid hours</div>
            <div className="text-3xl font-bold">{round2(live.unpaidFull + live.unpaidPart)}</div>
          </div>
        </div>

        <button
          onClick={saveDayToMonth}
          className="mt-5 w-full rounded-xl bg-white/20 hover:bg-white/25 px-4 py-3 font-semibold"
        >
          Save day to month
        </button>
      </div>

      {/* This month */}
      <div className="rounded-2xl bg-gray-900 text-white p-5 shadow">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <div className="text-lg font-semibold">This month</div>
          <div className="flex gap-2">
            <button
              className="px-4 py-2 rounded bg-green-600 hover:bg-green-700 font-semibold text-sm"
              onClick={exportCSV}
            >
              Export CSV
            </button>
            <button
              className="px-4 py-2 rounded bg-red-600 hover:bg-red-700 font-semibold text-sm"
              onClick={clearMonth}
            >
              Clear Month
            </button>
          </div>
        </div>

        <div className="text-lg font-semibold mb-2">Hours</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-sm text-gray-100">
          <div>Total Worked: <b>{month.worked}</b></div>
          <div>Qualifying (for {settings.otThreshold}): <b>{month.qualifying}</b></div>
          <div>STD Hours: <b>{month.std}</b></div>
          <div>OT Hours: <b>{month.ot}</b></div>
          <div>Late Prem: <b>{month.late}</b></div>
          <div>Night Prem: <b>{month.night}</b></div>
          <div>HOL Hours: <b>{month.hol}</b></div>
          <div>LIEU Hours: <b>{month.lieu}</b></div>
          <div>BH Hours: <b>{month.bankHol}</b></div>
          <div>Double Hours: <b>{month.dbl}</b></div>
          <div>Unpaid (Full): <b>{month.unpaidFull}</b></div>
          <div>Unpaid (Part): <b>{month.unpaidPart}</b></div>
          <div>Sick Hours: <b>{month.sick}</b></div>
          {/* Saved shifts list */}
<div className="mt-5 border-t border-white/20 pt-4">
  <div className="text-lg font-semibold mb-2">Saved shifts</div>

  {rows.length === 0 ? (
    <div className="text-sm text-gray-100/80">No saved shifts yet.</div>
  ) : (
    <div className="space-y-2">
      {rows
        .slice()
        .reverse()
        .map((r) => (
          <div
            key={r.id}
            className="rounded-lg bg-white/10 p-3 text-sm text-gray-100"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold">{r.date}</div>
              <div className="text-xs text-gray-100/70">
                {r.startTime} → {r.endTime}
              </div>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <div>Scheduled: <b>{r.scheduledHours}</b></div>
              <div>Sick: <b>{r.sickHours ?? 0}</b></div>

              <div>Holiday (Y/P): <b>{r.holidayFlag || "-"}</b></div>
              <div>Unpaid (Y/P): <b>{r.unpaidFlag || "-"}</b></div>

              <div>LIEU (Y/P): <b>{r.lieuFlag || "-"}</b></div>
              <div>BH (Y/P): <b>{r.bankHolFlag || "-"}</b></div>

              <div>Double (Y/P): <b>{r.doubleFlag || "-"}</b></div>
            </div>
          </div>
        ))}
    </div>
  )}
</div>
        </div>

        <div className="pt-4 mt-4 border-t border-white/20">
          <div className="text-lg font-semibold mb-2">Pay (£)</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-sm text-gray-100">
            <div>STD pay: <b>{fmtGBP(month.stdPay)}</b></div>
            <div>OT pay: <b>{fmtGBP(month.otPay)}</b></div>
            <div>Sick pay: <b>{fmtGBP(month.sickPay)}</b></div>
            <div>Late add-on: <b>{fmtGBP(month.lateAddPay)}</b></div>
            <div>Night add-on: <b>{fmtGBP(month.nightAddPay)}</b></div>
            <div>LIEU pay: <b>{fmtGBP(month.lieuPay)}</b></div>
            <div>BH pay: <b>{fmtGBP(month.bankHolPay)}</b></div>
            <div>Double pay: <b>{fmtGBP(month.doublePay)}</b></div>
            <div>Holiday pay: <b>{fmtGBP(month.holPay)}</b></div>
            <div className="sm:col-span-2 text-base mt-2">
              Total: <b>{fmtGBP(month.totalPay)}</b>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}