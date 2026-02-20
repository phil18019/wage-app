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
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(t.trim());
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

function isFullFlag(flag: Flag) {
  return flag === "Y";
}

function isAnyFullFlag(r: Pick<ShiftRow, "holidayFlag" | "unpaidFlag" | "lieuFlag" | "bankHolFlag" | "doubleFlag">) {
  return (
    isFullFlag(r.unpaidFlag) ||
    isFullFlag(r.holidayFlag) ||
    isFullFlag(r.lieuFlag) ||
    isFullFlag(r.bankHolFlag) ||
    isFullFlag(r.doubleFlag)
  );
}

/**
 * Business rules implemented:
 * - "Worked" = physically worked hours from times, unless ANY FULL flag (Y) is set -> worked becomes 0.
 * - PART flags (P) consume the remainder of the scheduled shift AFTER worked hours:
 *   remainder = max(0, scheduled - worked)
 *   That remainder is allocated in order: Unpaid(P) -> Holiday(P) -> Lieu(P) -> BH(P) -> Double(P)
 * - Premiums:
 *   - Blocked only for FULL Holiday (Y) or FULL Unpaid (Y)
 *   - If LIEU/BH/Double present (Y or P), premiums are "protected" across the scheduled shift end (start + scheduledHours)
 *   - Otherwise premiums apply only to the actual worked time window (start->end)
 */
function computeRowBreakdown(r: ShiftRow) {
  const whRaw = clampNonNeg(computeWorkedHours(r.startTime, r.endTime));
  const sh = clampNonNeg(Number(r.scheduledHours) || 0);

  const baseShift = sh > 0 ? sh : whRaw;

  // Worked hours are only "physical worked". Full-flag days are not physically worked.
  const workedPhysical = isAnyFullFlag(r) ? 0 : Math.min(whRaw, baseShift);

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

  // FULL flags: consume the whole baseShift (and remainder becomes 0)
  if (r.unpaidFlag === "Y") {
    out.unpaidFull = baseShift;
    remainder = 0;
  } else if (r.holidayFlag === "Y") {
    out.hol = baseShift;
    remainder = 0;
  } else if (r.lieuFlag === "Y") {
    out.lieu = baseShift;
    remainder = 0;
  } else if (r.bankHolFlag === "Y") {
    out.bankHol = baseShift;
    remainder = 0;
  } else if (r.doubleFlag === "Y") {
    out.dbl = baseShift;
    remainder = 0;
  } else {
    // PART flags: consume the remaining (non-worked) portion once, in priority order
    if (r.unpaidFlag === "P" && remainder > 0) {
      out.unpaidPart += remainder;
      remainder = 0;
    }
    if (r.holidayFlag === "P" && remainder > 0) {
      out.hol += remainder;
      remainder = 0;
    }
    if (r.lieuFlag === "P" && remainder > 0) {
      out.lieu += remainder;
      remainder = 0;
    }
    if (r.bankHolFlag === "P" && remainder > 0) {
      out.bankHol += remainder;
      remainder = 0;
    }
    if (r.doubleFlag === "P" && remainder > 0) {
      out.dbl += remainder;
      remainder = 0;
    }
  }

  // Premiums
  const premiumsBlocked = r.holidayFlag === "Y" || r.unpaidFlag === "Y";
  if (!premiumsBlocked && baseShift > 0 && r.startTime) {
    const premiumsProtected = r.lieuFlag !== "" || r.bankHolFlag !== "" || r.doubleFlag !== "";

    // If protected and we have scheduled hours, compute premiums across the scheduled shift length.
    // Otherwise compute on actual worked window.
    const premEnd =
      premiumsProtected && sh > 0
        ? addHoursToTime(r.startTime, sh)
        : r.endTime;

    const p = computeLateNightHours(r.startTime, premEnd);

    // If it's NOT protected, only pay premiums when there is physical worked time
    if (premiumsProtected) {
      out.late += clampNonNeg(p.lateHours);
      out.night += clampNonNeg(p.nightHours);
    } else if (workedPhysical > 0) {
      out.late += clampNonNeg(p.lateHours);
      out.night += clampNonNeg(p.nightHours);
    }
  }

  return out;
}

export default function Home() {
  // Settings (from lib + localStorage)
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  // Month rows
  const [rows, setRows] = useState<ShiftRow[]>([]);

  // Daily inputs
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

  // Load saved data
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

  // Persist month rows
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_MONTH, JSON.stringify(rows));
    } catch {
      // ignore
    }
  }, [rows]);

  // Computed for "This shift"
  const workedHours = useMemo(() => computeWorkedHours(startTime, endTime), [startTime, endTime]);

  // DAILY premiums (same rules as monthly)
  const prem = useMemo(() => {
    const sh = clampNonNeg(Number(scheduledHours) || 0);
    const wh = clampNonNeg(computeWorkedHours(startTime, endTime));

    // Full HOL / Full Unpaid block premiums completely
    if (holidayFlag === "Y" || unpaidFlag === "Y") return { lateHours: 0, nightHours: 0 };

    const premiumsProtected = lieuFlag !== "" || bankHolFlag !== "" || doubleFlag !== "";

    const premEnd =
      premiumsProtected && sh > 0
        ? addHoursToTime(startTime, sh)
        : endTime;

    const p = computeLateNightHours(startTime, premEnd);

    // If not protected, only allow premiums when there is physical worked time
    if (!premiumsProtected && wh <= 0) return { lateHours: 0, nightHours: 0 };

    return p;
  }, [startTime, endTime, scheduledHours, holidayFlag, unpaidFlag, lieuFlag, bankHolFlag, doubleFlag]);

  // Month totals + pay
  const month = useMemo(() => {
    const tot = {
      worked: 0,       // physical worked
      qualifying: 0,   // counts for OT trigger
      std: 0,
      ot: 0,           // OT PAID hours (worked only)

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

    // Qualifying counts toward OT trigger (NOT unpaid)
    tot.qualifying = round2(tot.worked + tot.hol + tot.lieu + tot.bankHol + tot.dbl);

    // OT triggered by qualifying, but paid only on worked
    const otRaw = Math.max(0, tot.qualifying - otThreshold);
    tot.ot = round2(Math.min(tot.worked, otRaw));

    // STD is remaining worked hours after OT paid hours
    tot.std = round2(Math.max(0, tot.worked - tot.ot));

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
      const sh = clampNonNeg(Number(r.scheduledHours) || 0);

      // Premiums in CSV should match the same rule set (blocked only full hol/unpaid; protected for lieu/bh/double)
      let late = 0;
      let night = 0;

      const premiumsBlocked = r.holidayFlag === "Y" || r.unpaidFlag === "Y";
      if (!premiumsBlocked && r.startTime) {
        const premiumsProtected = r.lieuFlag !== "" || r.bankHolFlag !== "" || r.doubleFlag !== "";
        const premEnd = premiumsProtected && sh > 0 ? addHoursToTime(r.startTime, sh) : r.endTime;
        const p = computeLateNightHours(r.startTime, premEnd);

        if (premiumsProtected || worked > 0) {
          late = p.lateHours;
          night = p.nightHours;
        }
      }

      const cells = [
        r.date,
        r.startTime,
        r.endTime,
        String(r.scheduledHours ?? 0),
        String(worked),
        String(late),
        String(night),
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

  return (
    <main className="min-h-screen p-6 max-w-4xl mx-auto text-[var(--foreground)]">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Wage Check</h1>
          <p className="text-xs text-gray-600 dark:text-white/60">
            Saved locally on this device only.
          </p>
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

        <button
          className="mt-4 w-full rounded-xl bg-white/15 hover:bg-white/20 px-4 py-3 font-semibold"
          onClick={saveDayToMonth}
        >
          Save day to month
        </button>
      </div>

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
                    <div className="text-sm text-white/70">
                      {r.startTime || "--:--"} → {r.endTime || "--:--"}
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