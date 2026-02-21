"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { DEFAULT_SETTINGS, getSettings, type Settings } from "./lib/settings";

type Flag = "" | "Y" | "P";

type ShiftRow = {
  id: string;
  date: string; // YYYY-MM-DD
  scheduledHours: number; // numeric value saved
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"

  holidayFlag: Flag;
  unpaidFlag: Flag;
  lieuFlag: Flag;
  bankHolFlag: Flag;
  doubleFlag: Flag;

  sickHours: number;
};

const STORAGE_KEY_MONTH = "wagecheck.month.v1"; // keeps your existing month storage

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

function toMinutes(t: string) {
  // accepts "HH:MM" or "HH:MM:SS"
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec((t || "").trim());
  if (!m) return NaN;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return NaN;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return NaN;
  return hh * 60 + mm;
}

function computeWorkedHours(startTime: string, endTime: string) {
  const s = toMinutes(startTime);
  const e0 = toMinutes(endTime);
  if (!Number.isFinite(s) || !Number.isFinite(e0)) return 0;

  let e = e0;
  // overnight support
  if (e <= s) e += 24 * 60;

  const minutes = Math.max(0, e - s);
  return round2(minutes / 60);
}

function computeLateNightHours(startTime: string, endTime: string) {
  const s0 = toMinutes(startTime);
  const e0 = toMinutes(endTime);
  if (!Number.isFinite(s0) || !Number.isFinite(e0)) return { lateHours: 0, nightHours: 0 };

  // normalize shift to an interval [s, e] where e may be next day
  let s = s0;
  let e = e0;
  if (e <= s) e += 24 * 60;

  const overlap = (sA: number, eA: number, sB: number, eB: number) =>
    Math.max(0, Math.min(eA, eB) - Math.max(sA, sB));

  let lateMin = 0;
  let nightMin = 0;

  // check windows across day offsets so 22:00–06:00 works for any start/end
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

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
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

// FULL flags that mean "not worked" (Double is NOT one of these)
function isOffFullFlag(r: Pick<ShiftRow, "holidayFlag" | "unpaidFlag" | "lieuFlag" | "bankHolFlag">) {
  return r.unpaidFlag === "Y" || r.holidayFlag === "Y" || r.lieuFlag === "Y" || r.bankHolFlag === "Y";
}

/**
 * Business rules implemented (updated to match your examples):
 *
 * Worked (physical) = hours from start/end,
 *   except if FULL Holiday/Unpaid/Lieu/BH => worked = 0.
 *
 * Scheduled portion = scheduledHours if set, else worked.
 *
 * Remainder = max(0, scheduled - worked).
 * PART flags (P) consume the remainder (NOT half), in priority order:
 *   Unpaid(P) -> Holiday(P) -> Lieu(P) -> BH(P) -> Double(P)
 *
 * FULL flags:
 *   - Unpaid(Y), Holiday(Y), Lieu(Y), BH(Y) consume the entire scheduled portion.
 *   - Double(Y) consumes the scheduled portion too (but DOES NOT zero worked).
 *
 * Premiums:
 *   - Blocked only for FULL Holiday (Y) or FULL Unpaid (Y)
 *   - Premiums are protected if LIEU/BH/Double set (Y or P)
 *       - LIEU/BH: use scheduled end (start + scheduled)
 *       - Double: use actual end IF worked > scheduled, else scheduled end
 *   - If not protected: premiums only count when worked > 0, using actual end
 */
function computeRowBreakdown(r: ShiftRow) {
  const sh = clampNonNeg(Number(r.scheduledHours) || 0);
  const whRaw = clampNonNeg(computeWorkedHours(r.startTime, r.endTime));
  const scheduledPortion = sh > 0 ? sh : whRaw;

  const workedPhysical = isOffFullFlag(r) ? 0 : whRaw;

  const out = {
    worked: workedPhysical, // physical
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

  // ----- allocate flags on the SCHEDULED portion -----
  // FULL flags (off types): consume scheduled portion
  if (r.unpaidFlag === "Y") {
    out.unpaidFull = scheduledPortion;
  } else if (r.holidayFlag === "Y") {
    out.hol = scheduledPortion;
  } else if (r.lieuFlag === "Y") {
    out.lieu = scheduledPortion;
  } else if (r.bankHolFlag === "Y") {
    out.bankHol = scheduledPortion;
  } else if (r.doubleFlag === "Y") {
    // Double full = scheduled portion paid at double (still worked physically)
    out.dbl = scheduledPortion;
  } else {
    // PART flags: consume ONLY the remainder of the scheduled shift (scheduled - worked)
    let remainder = round2(Math.max(0, scheduledPortion - workedPhysical));

    const takeRemainder = () => {
      const amt = remainder;
      remainder = 0;
      return amt;
    };

    if (r.unpaidFlag === "P" && remainder > 0) out.unpaidPart += takeRemainder();
    if (r.holidayFlag === "P" && remainder > 0) out.hol += takeRemainder();
    if (r.lieuFlag === "P" && remainder > 0) out.lieu += takeRemainder();
    if (r.bankHolFlag === "P" && remainder > 0) out.bankHol += takeRemainder();
    if (r.doubleFlag === "P" && remainder > 0) out.dbl += takeRemainder();
  }

  // ----- premiums -----
  const premiumsBlocked = r.holidayFlag === "Y" || r.unpaidFlag === "Y";
  const premiumsProtected = r.lieuFlag !== "" || r.bankHolFlag !== "" || r.doubleFlag !== "";

  if (!premiumsBlocked && r.startTime) {
    let premEnd = r.endTime;

    if (premiumsProtected) {
      // scheduled end if we can compute it
      const schedEnd = sh > 0 ? addHoursToTime(r.startTime, sh) : r.endTime;

      const isDouble = r.doubleFlag !== "";

      // Double: if worked exceeds scheduled, use actual end to include extra premiums (e.g. 22–05 = 7h)
      if (isDouble && sh > 0 && workedPhysical > sh && r.endTime) {
        premEnd = r.endTime;
      } else {
        // LIEU/BH (and Double when not exceeding scheduled): use scheduled end
        premEnd = schedEnd;
      }

      const p = computeLateNightHours(r.startTime, premEnd);
      out.late += clampNonNeg(p.lateHours);
      out.night += clampNonNeg(p.nightHours);
    } else {
      // Not protected: only if physically worked
      if (workedPhysical > 0) {
        const p = computeLateNightHours(r.startTime, r.endTime);
        out.late += clampNonNeg(p.lateHours);
        out.night += clampNonNeg(p.nightHours);
      }
    }
  }

  return out;
}

export default function Home() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [rows, setRows] = useState<ShiftRow[]>([]);

  const [date, setDate] = useState<string>(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  });

  const [scheduledHours, setScheduledHours] = useState<string>("");
  const [startTime, setStartTime] = useState<string>("");
  const [endTime, setEndTime] = useState<string>("");
  const [holidayFlag, setHolidayFlag] = useState<Flag>("");
  const [unpaidFlag, setUnpaidFlag] = useState<Flag>("");
  const [lieuFlag, setLieuFlag] = useState<Flag>("");
  const [bankHolFlag, setBankHolFlag] = useState<Flag>("");
  const [doubleFlag, setDoubleFlag] = useState<Flag>("");

  const [sickHours, setSickHours] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  useEffect(() => {
    try {
      const s = getSettings();
      setSettings(s);
    } catch {
      setSettings(DEFAULT_SETTINGS);
    }

    try {
      const raw = localStorage.getItem(STORAGE_KEY_MONTH);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) setRows(parsed as ShiftRow[]);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_MONTH, JSON.stringify(rows));
    } catch {
      // ignore
    }
  }, [rows]);

  const workedHours = useMemo(
    () => computeWorkedHours(startTime, endTime),
    [startTime, endTime]
  );

  // DAILY premiums (mirror monthly logic)
  const prem = useMemo(() => {
    const sh = clampNonNeg(Number(scheduledHours) || 0);
    const wh = clampNonNeg(computeWorkedHours(startTime, endTime));

    const premiumsBlocked = holidayFlag === "Y" || unpaidFlag === "Y";
    const premiumsProtected = lieuFlag !== "" || bankHolFlag !== "" || doubleFlag !== "";

    if (premiumsBlocked || !startTime) return { lateHours: 0, nightHours: 0 };

    if (premiumsProtected) {
      const schedEnd = sh > 0 ? addHoursToTime(startTime, sh) : endTime;

      // Double: if worked > scheduled, use actual end
      const isDouble = doubleFlag !== "";
      const premEnd = isDouble && sh > 0 && wh > sh && endTime ? endTime : schedEnd;

      return computeLateNightHours(startTime, premEnd);
    }

    // Not protected: only if physically worked
    if (wh <= 0) return { lateHours: 0, nightHours: 0 };
    return computeLateNightHours(startTime, endTime);
  }, [startTime, endTime, scheduledHours, holidayFlag, unpaidFlag, lieuFlag, bankHolFlag, doubleFlag]);

  const month = useMemo(() => {
    const tot = {
      worked: 0,       // physical worked
      qualifying: 0,   // trigger for OT
      std: 0,
      ot: 0,           // PAID OT hours (worked only, excluding double)
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

    tot.worked = round2(tot.worked);
    tot.hol = round2(tot.hol);
    tot.lieu = round2(tot.lieu);
    tot.bankHol = round2(tot.bankHol);
    tot.dbl = round2(tot.dbl);
    tot.late = round2(tot.late);
    tot.night = round2(tot.night);

    // Qualifying counts toward OT trigger (NOT unpaid)
    tot.qualifying = round2(tot.worked + tot.hol + tot.lieu + tot.bankHol);

    // OT triggered by qualifying,
    // but OT PAID can only come from hours that are physically worked AND not already paid as Double.
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

    // Double pay: base * doubleRate (NOT base + base again)
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
  }, [rows, settings]);

  function resetDailyInputs() {
    setScheduledHours("");
    setStartTime("");
    setEndTime("");
    setHolidayFlag("");
    setUnpaidFlag("");
    setLieuFlag("");
    setBankHolFlag("");
    setDoubleFlag("");
    setSickHours("");
  }

  function saveDayToMonth() {
    const sh = clampNonNeg(Number(scheduledHours) || 0);
    const sick = clampNonNeg(Number(sickHours) || 0);

    const row: ShiftRow = {
      id: `${date}-${Date.now()}`,
      date,
      scheduledHours: sh,
      startTime: startTime || "",
      endTime: endTime || "",
      holidayFlag,
      unpaidFlag,
      lieuFlag,
      bankHolFlag,
      doubleFlag,
      sickHours: sick,
    };

    setRows((prev) => [row, ...prev]);
    resetDailyInputs();
  }

  function deleteShift(id: string) {
    if (!confirm("Delete this saved shift?")) return;
    setRows((prev) => prev.filter((r) => r.id !== id));
  }
  function loadShiftForEdit(row: ShiftRow) {
    setDate(row.date);
    setScheduledHours(String(row.scheduledHours ?? ""));
    setStartTime(row.startTime || "");
    setEndTime(row.endTime || "");

    setHolidayFlag(row.holidayFlag || "");
    setUnpaidFlag(row.unpaidFlag || "");
    setLieuFlag(row.lieuFlag || "");
    setBankHolFlag(row.bankHolFlag || "");
    setDoubleFlag(row.doubleFlag || "");
    setSickHours(String(row.sickHours ?? ""));

    setEditingId(row.id);
  }


  function updateShift() {
    if (!editingId) return;

    const sh = clampNonNeg(Number(scheduledHours) || 0);
    const sick = clampNonNeg(Number(sickHours) || 0);

    setRows((prev) =>
      prev.map((r) =>
        r.id === editingId
          ? {
            ...r,
            date,
            scheduledHours: sh,
            startTime: startTime || "",
            endTime: endTime || "",
            holidayFlag,
            unpaidFlag,
            lieuFlag,
            bankHolFlag,
            doubleFlag,
            sickHours: sick,
          }
          : r
      )
    );

    setEditingId(null);
    resetDailyInputs();
  }

  function cancelEdit() {
    setEditingId(null);
    resetDailyInputs();
  }

  function clearMonth() {
    if (!confirm("Clear all saved shifts for this month?")) return;
    setRows([]);
  }

  function exportCSV() {
    const header = [
      "date",
      "startTime",
      "endTime",
      "scheduledHours",
      "workedHours",
      "lateHours",
      "nightHours",
      "holidayFlag",
      "unpaidFlag",
      "lieuFlag",
      "bankHolFlag",
      "doubleFlag",
      "sickHours",
    ].join(",");

    const rowsCsv = rows.map((r) => {
      const worked = clampNonNeg(computeWorkedHours(r.startTime, r.endTime));
      const b = computeRowBreakdown(r);

      const cells = [
        r.date,
        r.startTime,
        r.endTime,
        String(r.scheduledHours ?? 0),
        String(worked),
        String(b.late),
        String(b.night),
        r.holidayFlag,
        r.unpaidFlag,
        r.lieuFlag,
        r.bankHolFlag,
        r.doubleFlag,
        String(r.sickHours ?? 0),
      ];
      return cells.join(",");
    });

    const summary = [
      "",
      "MONTH_SUMMARY",
      `Worked=${month.worked}`,
      `Qualifying=${month.qualifying}`,
      `STD=${month.std}`,
      `OT=${month.ot}`,
      `Late=${month.late}`,
      `Night=${month.night}`,
      `Holiday=${month.hol}`,
      `LIEU=${month.lieu}`,
      `BH=${month.bankHol}`,
      `Double=${month.dbl}`,
      `UnpaidFull=${month.unpaidFull}`,
      `UnpaidPart=${month.unpaidPart}`,
      `Sick=${month.sick}`,
      `TotalPay=${month.totalPay}`,
    ].join(",");

    const csv = [header, ...rowsCsv, summary].join("\n");
    downloadText("wage-app-export.csv", csv);
  }

  const card =
    "rounded-2xl bg-gray-100 border border-gray-200 p-4 shadow dark:bg-white/10 dark:border-white/10";

  const label = "text-sm text-gray-700 dark:text-white/70";

  const input =
    "mt-1 w-full rounded-xl bg-white border border-gray-300 px-3 py-2 text-gray-900 dark:bg-white/10 dark:border-white/10 dark:text-white";

  const APP_VERSION = "1.0.0";

  return (
    <main className="min-h-screen p-6 max-w-4xl mx-auto text-[var(--foreground)]">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">

          <img
            src="/icon-192.png"
            alt="Wage Check logo"
            className="h-30 w-30 sm:h-16 sm:w-16 rounded-2xl shadow-md"
          />

          <div>
            <h1 className="text-2xl font-bold">Wage Check</h1>
            <p className="text-xs text-gray-600 dark:text-white/60">
              v{APP_VERSION} . Created by Phil Crompton
            </p>
          </div>

        </div>

        <div className="flex gap-2">
          <Link href="/help" className="text-sm px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15">
            Help
          </Link>
          <Link href="/settings" className="text-sm px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15">
            Settings
          </Link>
        </div>
      </div>

      {/* This shift */}
      <div className={`${card} mb-5`}>
        <div className="text-lg font-semibold mb-3">This shift</div>
      
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <div className={label}>Date</div>
            <input type="date" className={input} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>

          <div>
            <div className={label}>Scheduled hours</div>
            <input
              className={input}
              value={scheduledHours}
              onChange={(e) => setScheduledHours(e.target.value)}
              placeholder="e.g. 10"
              inputMode="decimal"
            />
          </div>

          <div>
            <div className={label}>Start</div>
            <input type="time" step="60" className={input} value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </div>

          <div>
            <div className={label}>Finish</div>
            <input type="time" step="60" className={input} value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </div>

          <div>
            <div className={label}>Holiday (Y/P)</div>
            <select className={input} value={holidayFlag} onChange={(e) => setHolidayFlag(e.target.value as Flag)}>
              <option value="">-</option>
              <option value="Y">Y</option>
              <option value="P">P</option>
            </select>
          </div>

          <div>
            <div className={label}>Unpaid (Y/P)</div>
            <select className={input} value={unpaidFlag} onChange={(e) => setUnpaidFlag(e.target.value as Flag)}>
              <option value="">-</option>
              <option value="Y">Y</option>
              <option value="P">P</option>
            </select>
          </div>

          <div>
            <div className={label}>LIEU (Y/P)</div>
            <select className={input} value={lieuFlag} onChange={(e) => setLieuFlag(e.target.value as Flag)}>
              <option value="">-</option>
              <option value="Y">Y</option>
              <option value="P">P</option>
            </select>
          </div>

          <div>
            <div className={label}>BH (Y/P)</div>
            <select className={input} value={bankHolFlag} onChange={(e) => setBankHolFlag(e.target.value as Flag)}>
              <option value="">-</option>
              <option value="Y">Y</option>
              <option value="P">P</option>
            </select>
          </div>

          <div>
            <div className={label}>Double (Y/P)</div>
            <select className={input} value={doubleFlag} onChange={(e) => setDoubleFlag(e.target.value as Flag)}>
              <option value="">-</option>
              <option value="Y">Y</option>
              <option value="P">P</option>
            </select>
          </div>

          <div>
            <div className={label}>Sick hours</div>
            <input className={input} value={sickHours} onChange={(e) => setSickHours(e.target.value)} placeholder="0" inputMode="decimal" />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-xl bg-gray-100 border border-gray-200 p-3 dark:bg-black/20 dark:border-white/10">
            <div className="text-sm text-gray-700 dark:text-white/70">Worked hours</div>
            <div className="text-xl font-bold text-gray-900 dark:text-white">{workedHours}</div>
          </div>

          <div className="rounded-xl bg-gray-100 border border-gray-200 p-3 dark:bg-black/20 dark:border-white/10">
            <div className="text-sm text-gray-700 dark:text-white/70">Premiums today (Late / Night)</div>
            <div className="text-xl font-bold text-gray-900 dark:text-white">
              {prem.lateHours} / {prem.nightHours}
            </div>
            <div className="text-xs text-gray-600 dark:text-white/50 mt-1">
              Late window 14:00–22:00 • Night window 22:00–06:00
            </div>
          </div>
        </div>

        {editingId ? (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              className="w-full rounded-xl bg-blue-600 hover:bg-blue-700 px-4 py-3 font-semibold text-white"
              onClick={updateShift}
              type="button"
            >
              Update shift
            </button>

            <button
              className="w-full rounded-xl bg-white/15 hover:bg-white/20 px-4 py-3 font-semibold"
              onClick={cancelEdit}
              type="button"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            className="mt-4 w-full rounded-xl bg-white/15 hover:bg-white/20 px-4 py-3 font-semibold"
            onClick={saveDayToMonth}
            type="button"
          >
            Save day to month
          </button>
        )}
        </div>  {/* ✅ closes the This shift card */}

        {/* This month */}
        <div className={`${card} mb-5`}>
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <div className="text-lg font-semibold">This month</div>
            <div className="flex gap-2">
              <button className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 font-semibold" onClick={exportCSV}>
                Export CSV
              </button>
              <button className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 font-semibold" onClick={clearMonth}>
                Clear Month
              </button>
            </div>
          </div>

          <div className="text-lg font-semibold mb-2">Hours</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-sm">
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
          </div>

          <div className="pt-4 mt-4 border-t border-white/20">
            <div className="text-lg font-semibold mb-2">Pay (£)</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-sm">
              <div>STD pay: <b>{fmtGBP(month.stdPay)}</b></div>
              <div>OT pay: <b>{fmtGBP(month.otPay)}</b></div>
              <div>Sick pay: <b>{fmtGBP(month.sickPay)}</b></div>
              <div>Late add-on: <b>{fmtGBP(month.lateAddPay)}</b></div>
              <div>Night add-on: <b>{fmtGBP(month.nightAddPay)}</b></div>
              <div>LIEU pay: <b>{fmtGBP(month.lieuPay)}</b></div>
              <div>BH pay: <b>{fmtGBP(month.bankHolPay)}</b></div>
              <div>Double pay: <b>{fmtGBP(month.doublePay)}</b></div>
              <div>Holiday pay: <b>{fmtGBP(month.holPay)}</b></div>
            </div>

            <div className="mt-3 text-base font-semibold">Total: {fmtGBP(month.totalPay)}</div>
          </div>
        </div>

        {/* Saved shifts */}
        <div className={`${card}`}>
          <div className="text-lg font-semibold mb-3">Saved shifts</div>

          {rows.length === 0 ? (
            <div className="text-sm text-white/60">No saved shifts yet.</div>
          ) : (
            <div className="space-y-3">
              {rows.map((r) => {
                const wh = computeWorkedHours(r.startTime, r.endTime);
                return (
                  <div key={r.id} className="rounded-xl bg-black/20 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-semibold">{r.date}</div>

                      <div className="flex items-center gap-3">
                        <div className="text-sm text-white/70">
                          {r.startTime || "--:--"} → {r.endTime || "--:--"}
                        </div>

                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => loadShiftForEdit(r)}
                            className="text-xs px-2 py-1 rounded bg-blue-500 text-white"
                          >
                            Edit
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              console.log("DELETE CLICKED", r.id);
                              deleteShift(r.id);
                            }}
                            className="text-xs px-2 py-1 rounded bg-red-500 text-white"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-1 text-sm text-white/80">
                      <div>Scheduled: <b>{r.scheduledHours ?? 0}</b></div>
                      <div>Worked: <b>{wh}</b></div>
                      <div>Holiday (Y/P): <b>{r.holidayFlag || "-"}</b></div>
                      <div>Unpaid (Y/P): <b>{r.unpaidFlag || "-"}</b></div>
                      <div>LIEU (Y/P): <b>{r.lieuFlag || "-"}</b></div>
                      <div>BH (Y/P): <b>{r.bankHolFlag || "-"}</b></div>
                      <div>Double (Y/P): <b>{r.doubleFlag || "-"}</b></div>
                      <div>Sick: <b>{r.sickHours ?? 0}</b></div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
    </main>
  );
}