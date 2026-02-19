"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getSettings, type Settings } from "./lib/settings";

type Flag = "" | "Y" | "P";

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function hhmmToMinutes(hhmm: string) {
  // expects "HH:MM"
  const [h, m] = hhmm.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

function minutesDiff(start: string, end: string) {
  // handles crossing midnight
  const s = hhmmToMinutes(start);
  const e = hhmmToMinutes(end);
  if (e >= s) return e - s;
  return (24 * 60 - s) + e;
}

function overlapMinutes(startMin: number, endMin: number, a: number, b: number) {
  // overlap between [startMin,endMin) and [a,b) on same day minutes
  const s = Math.max(startMin, a);
  const e = Math.min(endMin, b);
  return Math.max(0, e - s);
}

function computeLateNightHours(start: string, end: string) {
  // Late = 14:00–22:00, Night = 22:00–06:00 (crosses midnight)
  const s = hhmmToMinutes(start);
  let e = hhmmToMinutes(end);
  let crosses = false;
  if (e < s) {
    e += 24 * 60;
    crosses = true;
  }

  // Late window in minutes: 14:00–22:00 on day 0
  const late = overlapMinutes(s, e, 14 * 60, 22 * 60);

  // Night windows: 22:00–24:00 day0 and 00:00–06:00 day1
  const night1 = overlapMinutes(s, e, 22 * 60, 24 * 60);
  const night2 = crosses ? overlapMinutes(s, e, 24 * 60, 30 * 60) : overlapMinutes(s, e, 0, 6 * 60);

  const night = night1 + night2;

  return {
    lateHours: round2(late / 60),
    nightHours: round2(night / 60),
  };
}

const MONTH_KEY = "wagecheck.month.v1";

type DayEntry = {
  date: string; // YYYY-MM-DD
  scheduledHours: number;
  startTime: string; // HH:MM
  endTime: string;   // HH:MM
  holidayFlag: Flag; // Y/P
  unpaidFlag: Flag;  // Y/P
  sickHours: number;
};

function loadMonth(): DayEntry[] {
  try {
    const raw = localStorage.getItem(MONTH_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveMonth(rows: DayEntry[]) {
  try {
    localStorage.setItem(MONTH_KEY, JSON.stringify(rows));
  } catch {}
}

export default function Home() {
  const [settings, setSettings] = useState<Settings>(() => getSettings());

  // Refresh settings when returning from Settings / switching back to app
  useEffect(() => {
    const refresh = () => setSettings(getSettings());
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  // Daily inputs
  const [date, setDate] = useState<string>(() => {
    const d = new Date();
    const yyyy = d.getFullYear();
const mm = String(d.getMonth() + 1).padStart(2, "0");
const dd = String(d.getDate()).padStart(2, "0");
return ⁠ ${yyyy}-${mm}-${dd} ⁠;
  });
  const [scheduledHours, setScheduledHours] = useState<number>(10);
  const [startTime, setStartTime] = useState<string>("17:00");
  const [endTime, setEndTime] = useState<string>("03:00");
  const [holidayFlag, setHolidayFlag] = useState<Flag>("");
  const [unpaidFlag, setUnpaidFlag] = useState<Flag>("");
  const [sickHours, setSickHours] = useState<number>(0);

  const [monthRows, setMonthRows] = useState<DayEntry[]>(() => loadMonth());

  useEffect(() => {
    saveMonth(monthRows);
  }, [monthRows]);

  // When holiday/unpaid full shift Y: ignore times
  const timesDisabled = holidayFlag === "Y" || unpaidFlag === "Y";

  const workedHours = useMemo(() => {
    if (timesDisabled) return 0;
    const mins = minutesDiff(startTime, endTime);
    return round2(mins / 60);
  }, [startTime, endTime, timesDisabled]);

  const unpaidHours = useMemo(() => {
    if (unpaidFlag === "Y") return scheduledHours;
    if (unpaidFlag === "P") return Math.max(0, round2(scheduledHours - workedHours));
    return 0;
  }, [unpaidFlag, scheduledHours, workedHours]);

  const holidayHours = useMemo(() => {
    if (holidayFlag === "Y") return scheduledHours;
    if (holidayFlag === "P") return Math.max(0, round2(scheduledHours - workedHours));
    return 0;
  }, [holidayFlag, scheduledHours, workedHours]);

  const qualifyingToday = useMemo(() => {
    // Qualifying = worked + sick + holiday (but not unpaid)
    return round2(Math.max(0, workedHours) + Math.max(0, sickHours) + Math.max(0, holidayHours));
  }, [workedHours, sickHours, holidayHours]);

  const premiums = useMemo(() => {
    // Premiums only count on actual worked time (and not for full holiday/unpaid)
    if (timesDisabled) return { late: 0, night: 0 };
    const { lateHours, nightHours } = computeLateNightHours(startTime, endTime);
    return { late: lateHours, night: nightHours };
  }, [startTime, endTime, timesDisabled]);

  function upsertDay() {
    const row: DayEntry = {
      date,
      scheduledHours: round2(scheduledHours),
      startTime,
      endTime,
      holidayFlag,
      unpaidFlag,
      sickHours: round2(sickHours),
    };

    setMonthRows((prev) => {
      const idx = prev.findIndex((r) => r.date === date);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = row;
        return copy.sort((a, b) => a.date.localeCompare(b.date));
      }
      return [...prev, row].sort((a, b) => a.date.localeCompare(b.date));
    });
  }

  function clearMonth() {
    setMonthRows([]);
    try {
      localStorage.removeItem(MONTH_KEY);
    } catch {}
  }

  function exportCSV() {
    // Minimal CSV month export
    const header = [
      "date",
      "scheduledHours",
      "startTime",
      "endTime",
      "holidayFlag",
      "unpaidFlag",
      "sickHours",
    ];
    const lines = [header.join(",")].concat(
      monthRows.map((r) =>
        [
          r.date,
          r.scheduledHours,
          r.startTime,
          r.endTime,
          r.holidayFlag,
          r.unpaidFlag,
          r.sickHours,
        ].join(",")
      )
    );

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "wagecheck-month.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const month = useMemo(() => {
    const tot = {
      worked: 0,
      sick: 0,
      holiday: 0,
      unpaid: 0,
      qualifying: 0,
      late: 0,
      night: 0,
    };

    for (const r of monthRows) {
      const timesDisabledRow = r.holidayFlag === "Y" || r.unpaidFlag === "Y";
      const wh = timesDisabledRow ? 0 : round2(minutesDiff(r.startTime, r.endTime) / 60);

      const uh =
        r.unpaidFlag === "Y"
          ? r.scheduledHours
          : r.unpaidFlag === "P"
          ? Math.max(0, round2(r.scheduledHours - wh))
          : 0;

      const hh =
        r.holidayFlag === "Y"
          ? r.scheduledHours
          : r.holidayFlag === "P"
          ? Math.max(0, round2(r.scheduledHours - wh))
          : 0;

      const q = round2(wh + (r.sickHours || 0) + hh);

      const prem = timesDisabledRow ? { late: 0, night: 0 } : computeLateNightHours(r.startTime, r.endTime);

      tot.worked += wh;
      tot.sick += r.sickHours || 0;
      tot.holiday += hh;
      tot.unpaid += uh;
      tot.qualifying += q;
      tot.late += prem.lateHours;
      tot.night += prem.nightHours;
    }

    tot.worked = round2(tot.worked);
    tot.sick = round2(tot.sick);
    tot.holiday = round2(tot.holiday);
    tot.unpaid = round2(tot.unpaid);
    tot.qualifying = round2(tot.qualifying);
    tot.late = round2(tot.late);
    tot.night = round2(tot.night);

    // Allocation:
    // Bucket counts all qualifying hours up to threshold (worked + sick + holiday).
    // But holiday hours are NOT paid again at base; they are paid at holiday rate.
    const bucket = Math.min(settings.otThreshold, tot.qualifying);
    const otHours = round2(Math.max(0, tot.qualifying - settings.otThreshold));

    const stdHoursPaid = round2(Math.max(0, bucket - tot.holiday)); // holiday deducted from std pay
    const sickPaidHours = tot.sick; // sick paid at base (already included inside stdHoursPaid via bucket, but keep display separate if you want later)

    // Money:
    const stdPay = round2(stdHoursPaid * settings.baseRate);
    const otPay = round2(otHours * (settings.baseRate + settings.otPremiumAdd));
    const holidayPay = round2(tot.holiday * settings.holidayRate);

    const latePay = round2(tot.late * settings.latePremiumAdd);
    const nightPay = round2(tot.night * settings.nightPremiumAdd);

    const totalPay = round2(stdPay + otPay + holidayPay + latePay + nightPay);

    return {
      ...tot,
      bucket: round2(bucket),
      stdHoursPaid,
      otHours,
      stdPay,
      otPay,
      holidayPay,
      latePay,
      nightPay,
      totalPay,
    };
  }, [monthRows, settings]);

  return (
    <main className="min-h-screen p-4 sm:p-6 bg-[#0B2A6F] text-white">
      {/* Header */}
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold">WageCheck</h1>
          <div className="flex gap-2">
            <Link
              href="/help"
              className="text-xs px-3 py-1 rounded-lg bg-gray-200 text-gray-900 hover:bg-gray-300
                         dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600"
            >
              Help
            </Link>
            <Link
              href="/settings"
              className="text-xs px-3 py-1 rounded-lg bg-gray-200 text-gray-900 hover:bg-gray-300
                         dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600"
            >
              Settings
            </Link>
          </div>
        </div>

        {/* This Shift */}
        <div className="rounded-2xl bg-blue-900 p-5 shadow-sm mb-4">
          <h2 className="text-lg font-semibold mb-3">This shift</h2>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <label className="flex flex-col">
              <span className="opacity-90">Date</span>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1 rounded-lg px-2 py-1 text-gray-900"
              />
            </label>

            <label className="flex flex-col">
              <span className="opacity-90">Scheduled hours</span>
              <input
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={scheduledHours}
                onChange={(e) => setScheduledHours(Number(e.target.value))}
                className="mt-1 rounded-lg px-2 py-1 text-gray-900"
              />
            </label>

            <label className="flex flex-col">
              <span className="opacity-90">Start</span>
              <input
                type="time"
                value={startTime}
                disabled={timesDisabled}
                onChange={(e) => setStartTime(e.target.value)}
                className="mt-1 rounded-lg px-2 py-1 text-gray-900 disabled:opacity-60"
              />
            </label>

            <label className="flex flex-col">
              <span className="opacity-90">Finish</span>
              <input
                type="time"
                value={endTime}
                disabled={timesDisabled}
                onChange={(e) => setEndTime(e.target.value)}
                className="mt-1 rounded-lg px-2 py-1 text-gray-900 disabled:opacity-60"
              />
            </label>

            <label className="flex flex-col">
              <span className="opacity-90">Holiday (Y/P)</span>
              <select
                value={holidayFlag}
                onChange={(e) => setHolidayFlag(e.target.value as Flag)}
                className="mt-1 rounded-lg px-2 py-1 text-gray-900"
              >
                <option value="">—</option>
                <option value="Y">Y</option>
                <option value="P">P</option>
              </select>
            </label>

            <label className="flex flex-col">
              <span className="opacity-90">Unpaid (Y/P)</span>
              <select
                value={unpaidFlag}
                onChange={(e) => setUnpaidFlag(e.target.value as Flag)}
                className="mt-1 rounded-lg px-2 py-1 text-gray-900"
              >
                <option value="">—</option>
                <option value="Y">Y</option>
                <option value="P">P</option>
              </select>
            </label>

            <label className="flex flex-col col-span-2">
              <span className="opacity-90">Sick hours</span>
              <input
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={sickHours}
                onChange={(e) => setSickHours(Number(e.target.value))}
                className="mt-1 rounded-lg px-2 py-1 text-gray-900"
              />
            </label>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-blue-950/60 p-3">
              <div className="opacity-90">Worked hours</div>
              <div className="text-xl font-bold">{workedHours}</div>
            </div>
            <div className="rounded-xl bg-blue-950/60 p-3">
              <div className="opacity-90">Qualifying today</div>
              <div className="text-xl font-bold">{qualifyingToday}</div>
            </div>
            <div className="rounded-xl bg-blue-950/60 p-3">
              <div className="opacity-90">Late premium hours</div>
              <div className="text-xl font-bold">{premiums.late}</div>
            </div>
            <div className="rounded-xl bg-blue-950/60 p-3">
              <div className="opacity-90">Night premium hours</div>
              <div className="text-xl font-bold">{premiums.night}</div>
            </div>
            <div className="rounded-xl bg-blue-950/60 p-3">
              <div className="opacity-90">Holiday hours</div>
              <div className="text-xl font-bold">{holidayHours}</div>
            </div>
            <div className="rounded-xl bg-blue-950/60 p-3">
              <div className="opacity-90">Unpaid hours</div>
              <div className="text-xl font-bold">{unpaidHours}</div>
            </div>
          </div>

          <div className="mt-4 flex gap-3 flex-wrap">
            <button
              onClick={upsertDay}
              className="rounded-lg bg-white/15 px-4 py-2 font-semibold hover:bg-white/25"
            >
              Save day to month
            </button>
          </div>
        </div>

        {/* This Month */}
        <div className="rounded-2xl bg-gray-900 p-5 shadow-sm">
          <h2 className="text-lg font-semibold mb-3">This month</h2>

          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>Total worked: <b>{month.worked}</b></div>
            <div>Unpaid: <b>{month.unpaid}</b></div>
            <div>Holiday: <b>{month.holiday}</b></div>
            <div>Sick: <b>{month.sick}</b></div>
            <div>Late premium hrs: <b>{month.late}</b></div>
            <div>Night premium hrs: <b>{month.night}</b></div>
            <div>Qualifying (for {settings.otThreshold}): <b>{month.qualifying}</b></div>
            <div>OT hours: <b>{month.otHours}</b></div>
            <div>STD paid hours: <b>{month.stdHoursPaid}</b></div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
            <div>STD pay: <b>£{month.stdPay.toFixed(2)}</b></div>
            <div>OT pay: <b>£{month.otPay.toFixed(2)}</b></div>
            <div>Holiday pay: <b>£{month.holidayPay.toFixed(2)}</b></div>
            <div>Late premium: <b>£{month.latePay.toFixed(2)}</b></div>
            <div>Night premium: <b>£{month.nightPay.toFixed(2)}</b></div>
            <div className="col-span-2 text-base mt-2">
              Total: <b>£{month.totalPay.toFixed(2)}</b>
            </div>
          </div>

          <div className="mt-4 flex gap-3 flex-wrap">
            <button
              className="px-4 py-2 rounded font-semibold transition-colors duration-200 bg-green-600 hover:bg-green-700 text-white dark:bg-green-500 dark:hover:bg-green-600"
              onClick={exportCSV}
            >
              Export CSV
            </button>

            <button
              className="px-4 py-2 rounded font-semibold transition-colors duration-200 bg-red-600 hover:bg-red-700 text-white dark:bg-red-500 dark:hover:bg-red-600"
              onClick={clearMonth}
            >
              Clear Month
            </button>
          </div>
        </div>

        <p className="mt-6 text-xs text-white/70 text-center">
          Estimated calculation only — refer to your official payslip for final figures.
        </p>
      </div>
    </main>
  );
}