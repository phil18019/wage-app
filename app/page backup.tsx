"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { DEFAULT_SETTINGS, getSettings, type Settings } from "./lib/settings";
import { computeWorkedHours } from "./lib/engine/time";
import { fmtGBP } from "./lib/engine/money";
import { computeMonthTotals } from "./lib/engine/month";
import { computeWeeklyTotals } from "./lib/engine/week";
import { isProEnabled, tryUnlockPro } from "./lib/pro";
import {
  listSavedMonths,
  upsertSavedMonth,
  deleteSavedMonth,
  monthIdFromDate,
  labelFromMonthId,
  type SavedMonth,
} from "./lib/engine/history";

type Flag = "" | "Y" | "P";

type ShiftRow = {
  id: string;
  date: string; // YYYY-MM-DD
  scheduledHours: number;
  startTime: string; // "HH:MM"
  endTime: string; // "HH:MM"
  holidayFlag: Flag;
  unpaidFlag: Flag;
  lieuFlag: Flag;
  bankHolFlag: Flag;
  doubleFlag: Flag;
  sickHours: number;
};

const STORAGE_KEY_MONTH = "wagecheck.month.v1";
const STORAGE_KEY_ALLTIME = "wagecheck.alltime.v1";
const APP_VERSION = "1.0.0";

/* ------------------------- small utilities ------------------------- */

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

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function csvEscape(v: unknown) {
  const s = String(v ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/* ------------------------- premiums helpers ------------------------- */

function computeLateNightHours(startTime: string, endTime: string) {
  const s0 = toMinutes(startTime);
  const e0 = toMinutes(endTime);
  if (!Number.isFinite(s0) || !Number.isFinite(e0)) {
    return { lateHours: 0, nightHours: 0 };
  }

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

    // Night: 22:00–06:00
    nightMin += overlap(s, e, base + 22 * 60, base + 24 * 60);
    nightMin += overlap(s, e, base + 24 * 60, base + 30 * 60);
  }

  return {
    lateHours: round2(lateMin / 60),
    nightHours: round2(nightMin / 60),
  };
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

/* -------------------- ALL-TIME SHIFT LOG (background) -------------------- */

type AllTimeShiftRow = ShiftRow & {
  createdAt?: number;
  updatedAt?: number;
};

function listAllTimeShifts(): AllTimeShiftRow[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ALLTIME);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AllTimeShiftRow[]) : [];
  } catch {
    return [];
  }
}

function saveAllTimeShifts(all: AllTimeShiftRow[]) {
  try {
    localStorage.setItem(STORAGE_KEY_ALLTIME, JSON.stringify(all));
  } catch {
    // ignore
  }
}

function upsertAllTimeShift(row: ShiftRow) {
  const all = listAllTimeShifts();
  const idx = all.findIndex((r) => r.id === row.id);
  const now = Date.now();

  if (idx >= 0) {
    const prev = all[idx];
    all[idx] = { ...prev, ...row, updatedAt: now };
  } else {
    all.unshift({ ...row, createdAt: now, updatedAt: now });
  }

  saveAllTimeShifts(all);
}

function deleteAllTimeShift(id: string) {
  const all = listAllTimeShifts().filter((r) => r.id !== id);
  saveAllTimeShifts(all);
}

function exportAllTimeCSV() {
  const all = listAllTimeShifts()
    .slice()
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      const sa = toMinutes(a.startTime || "");
      const sb = toMinutes(b.startTime || "");
      if (!Number.isFinite(sa) && !Number.isFinite(sb)) return 0;
      if (!Number.isFinite(sa)) return 1;
      if (!Number.isFinite(sb)) return -1;
      return sa - sb;
    });

  const header = [
    "id",
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
    "createdAt",
    "updatedAt",
  ].join(",");

  const rowsCsv = all.map((r) => {
    const worked = clampNonNeg(
      computeWorkedHours(r.startTime || "", r.endTime || "")
    );
    const b = computeRowBreakdown(r);

    const cells = [
      csvEscape(r.id),
      csvEscape(r.date),
      csvEscape(r.startTime || ""),
      csvEscape(r.endTime || ""),
      csvEscape(r.scheduledHours ?? 0),
      csvEscape(worked),
      csvEscape(b.late),
      csvEscape(b.night),
      csvEscape(r.holidayFlag || ""),
      csvEscape(r.unpaidFlag || ""),
      csvEscape(r.lieuFlag || ""),
      csvEscape(r.bankHolFlag || ""),
      csvEscape(r.doubleFlag || ""),
      csvEscape(r.sickHours ?? 0),
      csvEscape(r.createdAt ?? ""),
      csvEscape(r.updatedAt ?? ""),
    ];

    return cells.join(",");
  });

  downloadText("wagecheck-all-shifts.csv", [header, ...rowsCsv].join("\n"));
}

/* ------------------------------------------------------------------------- */

// FULL flags that mean "not worked" (Double is NOT one of these)
function isOffFullFlag(
  r: Pick<ShiftRow, "holidayFlag" | "unpaidFlag" | "lieuFlag" | "bankHolFlag">
) {
  return (
    r.unpaidFlag === "Y" ||
    r.holidayFlag === "Y" ||
    r.lieuFlag === "Y" ||
    r.bankHolFlag === "Y"
  );
}

function computeRowBreakdown(r: ShiftRow) {
  const sh = clampNonNeg(Number(r.scheduledHours) || 0);
  const whRaw = clampNonNeg(computeWorkedHours(r.startTime, r.endTime));
  const scheduledPortion = sh > 0 ? sh : whRaw;

  const workedPhysical = isOffFullFlag(r) ? 0 : whRaw;

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

  // Allocate flags on the SCHEDULED portion
  if (r.unpaidFlag === "Y") {
    out.unpaidFull = scheduledPortion;
  } else if (r.holidayFlag === "Y") {
    out.hol = scheduledPortion;
  } else if (r.lieuFlag === "Y") {
    out.lieu = scheduledPortion;
  } else if (r.bankHolFlag === "Y") {
    out.bankHol = scheduledPortion;
  } else if (r.doubleFlag === "Y") {
    out.dbl = scheduledPortion;
  } else {
    // PART flags consume ONLY the remainder (scheduled - worked)
    let remainder = round2(Math.max(0, scheduledPortion - workedPhysical));

    const takeRemainder = () => {
      const amt = remainder;
      remainder = 0;
      return amt;
    };

    if (r.unpaidFlag === "P" && remainder > 0)
      out.unpaidPart += takeRemainder();
    if (r.holidayFlag === "P" && remainder > 0) out.hol += takeRemainder();
    if (r.lieuFlag === "P" && remainder > 0) out.lieu += takeRemainder();
    if (r.bankHolFlag === "P" && remainder > 0)
      out.bankHol += takeRemainder();
    if (r.doubleFlag === "P" && remainder > 0) out.dbl += takeRemainder();
  }

  // Premiums
  const premiumsBlocked = r.holidayFlag === "Y" || r.unpaidFlag === "Y";
  const premiumsProtected =
    r.lieuFlag !== "" || r.bankHolFlag !== "" || r.doubleFlag !== "";

  if (!premiumsBlocked && r.startTime) {
    let premEnd = r.endTime;

    if (premiumsProtected) {
      const schedEnd = sh > 0 ? addHoursToTime(r.startTime, sh) : r.endTime;

      // Double: if worked exceeds scheduled, use actual end to include extra premiums
      const isDouble = r.doubleFlag !== "";
      if (isDouble && sh > 0 && workedPhysical > sh && r.endTime) {
        premEnd = r.endTime;
      } else {
        premEnd = schedEnd;
      }

      const p = computeLateNightHours(r.startTime, premEnd);
      out.late += clampNonNeg(p.lateHours);
      out.night += clampNonNeg(p.nightHours);
    } else {
      if (workedPhysical > 0) {
        const p = computeLateNightHours(r.startTime, r.endTime);
        out.late += clampNonNeg(p.lateHours);
        out.night += clampNonNeg(p.nightHours);
      }
    }
  }

  return out;
}

function displayFlag(flag: Flag) {
  if (flag === "Y") return "Full";
  if (flag === "P") return "Part";
  return "-";
}

function weekStartLabel(weekStartsOn: number) {
  const names = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  const i = Number.isFinite(weekStartsOn)
    ? Math.min(6, Math.max(0, Math.floor(weekStartsOn)))
    : 0;
  return names[i];
}

/**
 * ✅ SSR-safe rate lookup:
 * Do NOT call getRateForDate() here (it reads localStorage and causes hydration mismatch).
 * Instead, derive from the already-loaded `settings` state.
 */
function rateForDateFromSettings(settings: Settings, date: string) {
  const rates = Array.isArray((settings as any)?.rates) ? (settings as any).rates : [];
  if (!rates.length) return { otThreshold: 0 };

  const sorted = [...rates].sort((a, b) =>
    a.effectiveDate < b.effectiveDate ? -1 : 1
  );

  let best = sorted[0];
  for (const r of sorted) {
    if (r.effectiveDate <= date) best = r;
    else break;
  }
  return best;
}

export default function Home() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [rows, setRows] = useState<ShiftRow[]>([]);
  const [hasLoadedRows, setHasLoadedRows] = useState(false); // ✅ prevents overwriting storage with []

  const [savedMonths, setSavedMonths] = useState<SavedMonth[]>([]);
  const [selectedSavedMonthId, setSelectedSavedMonthId] =
    useState<string>("");

  const [pro, setPro] = useState(false);
  const [proCode, setProCode] = useState("");
  const [proError, setProError] = useState<string | null>(null);

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

  const weekStartsOn = settings.weekStartsOn ?? 0;

  function refreshSavedMonths() {
    setSavedMonths(listSavedMonths());
  }

  // Load settings / month rows / pro / saved months
  useEffect(() => {
    try {
      setSettings(getSettings());
    } catch {
      setSettings(DEFAULT_SETTINGS);
    }

    setPro(isProEnabled());

    try {
      const raw = localStorage.getItem(STORAGE_KEY_MONTH);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setRows(parsed as ShiftRow[]);
      }
    } catch {
      // ignore
    } finally {
      setHasLoadedRows(true); // ✅ NEW
    }

    try {
      refreshSavedMonths();
    } catch {
      // ignore
    }
  }, []);

  // keep dropdown selection valid
  useEffect(() => {
    if (!pro) {
      setSelectedSavedMonthId("");
      return;
    }
    if (savedMonths.length === 0) {
      setSelectedSavedMonthId("");
      return;
    }
    const exists = savedMonths.some((m) => m.id === selectedSavedMonthId);
    if (!selectedSavedMonthId || !exists) {
      setSelectedSavedMonthId(savedMonths[0].id);
    }
  }, [pro, savedMonths, selectedSavedMonthId]);

  const selectedSavedMonth = useMemo(() => {
    if (!selectedSavedMonthId) return null;
    return savedMonths.find((m) => m.id === selectedSavedMonthId) ?? null;
  }, [savedMonths, selectedSavedMonthId]);

  // Persist month rows (✅ only after we've loaded once)
  useEffect(() => {
    if (!hasLoadedRows) return;
    try {
      localStorage.setItem(STORAGE_KEY_MONTH, JSON.stringify(rows));
    } catch {
      // ignore
    }
  }, [rows, hasLoadedRows]);

  const workedHours = useMemo(
    () => computeWorkedHours(startTime, endTime),
    [startTime, endTime]
  );

  const prem = useMemo(() => {
    const sh = clampNonNeg(Number(scheduledHours) || 0);
    const wh = clampNonNeg(computeWorkedHours(startTime, endTime));

    const premiumsBlocked = holidayFlag === "Y" || unpaidFlag === "Y";
    const premiumsProtected =
      lieuFlag !== "" || bankHolFlag !== "" || doubleFlag !== "";

    if (premiumsBlocked || !startTime) return { lateHours: 0, nightHours: 0 };

    if (premiumsProtected) {
      const schedEnd = sh > 0 ? addHoursToTime(startTime, sh) : endTime;
      const isDouble = doubleFlag !== "";
      const premEnd =
        isDouble && sh > 0 && wh > sh && endTime ? endTime : schedEnd;
      return computeLateNightHours(startTime, premEnd);
    }

    if (wh <= 0) return { lateHours: 0, nightHours: 0 };
    return computeLateNightHours(startTime, endTime);
  }, [
    startTime,
    endTime,
    scheduledHours,
    holidayFlag,
    unpaidFlag,
    lieuFlag,
    bankHolFlag,
    doubleFlag,
  ]);

  const month = useMemo(
    () => computeMonthTotals(rows as any, settings),
    [rows, settings]
  );

  const weeks = useMemo(
    () => computeWeeklyTotals(rows as any, settings, weekStartsOn),
    [rows, settings, weekStartsOn]
  );

  // ✅ OT threshold display (rate-history aware, SSR-safe)
  const otThresholdDisplay = useMemo(() => {
    try {
      return Number(rateForDateFromSettings(settings, date)?.otThreshold ?? 0);
    } catch {
      return 0;
    }
  }, [settings, date]);

  function resetDailyInputs() {
    setScheduledHours("");
    setStartTime("");
    setEndTime("");
    setHolidayFlag("");
    setUnpaidFlag("");
    setBankHolFlag("");
    setDoubleFlag("");
    setLieuFlag("");
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
    upsertAllTimeShift(row); // ✅ background log
    resetDailyInputs();
  }

  function deleteShift(id: string) {
    if (!confirm("Delete this saved shift?")) return;
    setRows((prev) => prev.filter((r) => r.id !== id));
    deleteAllTimeShift(id); // ✅ background log
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

    const updatedRow: ShiftRow = {
      id: editingId,
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

    setRows((prev) => prev.map((r) => (r.id === editingId ? updatedRow : r)));
    upsertAllTimeShift(updatedRow); // ✅ background log

    setEditingId(null);
    resetDailyInputs();
  }

  function cancelEdit() {
    setEditingId(null);
    resetDailyInputs();
  }

  function requirePro(action: () => void) {
    if (!pro) {
      alert("This is a Pro feature 🔒");
      return;
    }
    action();
  }

  function saveCurrentMonthSnapshot() {
    if (!pro) {
      alert("Pro feature: unlock Pro to save months.");
      return;
    }
    if (rows.length === 0) {
      alert("No shifts saved this month yet.");
      return;
    }

    const id = monthIdFromDate(date);
    const defaultLabel = labelFromMonthId(id);

    const customLabelRaw = prompt("Name this saved period:", defaultLabel);
    if (customLabelRaw === null) return;
    const label = customLabelRaw.trim() || defaultLabel;

    const existing = savedMonths.find((m) => m.id === id);

    if (existing) {
      const ok = confirm(
        `${existing.label} already exists. Overwrite saved period?`
      );
      if (!ok) return;

      // ✅ If overwriting, remove the old period's shifts from all-time log
      const oldRows = (existing.rows ?? []) as ShiftRow[];
      for (const r of oldRows) {
        if (r?.id) deleteAllTimeShift(r.id);
      }
    }

    const entry: SavedMonth = {
      id,
      label,
      createdAt: Date.now(),
      shiftCount: rows.length,
      rows,
      totals: month,
    };

    upsertSavedMonth(entry);
    refreshSavedMonths();

    // ✅ auto-clear current month list after saving
    setRows([]);
    setEditingId(null);
    resetDailyInputs();

    alert(`Saved: ${label} (current list cleared)`);
  }

  function removeSavedMonth(id: string) {
    if (!pro) {
      alert("Pro feature: unlock Pro to manage saved months.");
      return;
    }

    const found = savedMonths.find((m) => m.id === id);
    const label = found?.label ?? id;

    const msg =
      `Delete saved period "${label}"?\n\n` +
      `This will permanently remove:\n` +
      `• The saved period entry\n` +
      `• All shifts stored inside it (also removed from Export ALL shifts)\n\n` +
      `This cannot be undone.`;

    if (!confirm(msg)) return;

    // ✅ delete the period’s stored shifts from the all-time log
    const periodRows = (found?.rows ?? []) as ShiftRow[];
    for (const r of periodRows) {
      if (r?.id) deleteAllTimeShift(r.id);
    }

    deleteSavedMonth(id);
    refreshSavedMonths();
  }

  function renameSavedMonth(id: string) {
    if (!pro) {
      alert("Pro feature: unlock Pro to manage saved months.");
      return;
    }

    const found = savedMonths.find((m) => m.id === id);
    if (!found) return;

    const newLabelRaw = prompt("Rename saved month:", found.label);
    if (newLabelRaw === null) return;

    const newLabel = newLabelRaw.trim();
    if (!newLabel) {
      alert("Name cannot be empty.");
      return;
    }

    upsertSavedMonth({ ...found, label: newLabel });
    refreshSavedMonths();
  }

  function clearMonth() {
    if (!confirm("Clear all saved shifts for this month?")) return;
    setRows([]);
    // NOTE: does NOT clear all-time log (intentional)
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
        csvEscape(r.date),
        csvEscape(r.startTime),
        csvEscape(r.endTime),
        csvEscape(r.scheduledHours ?? 0),
        csvEscape(worked),
        csvEscape(b.late),
        csvEscape(b.night),
        csvEscape(r.holidayFlag),
        csvEscape(r.unpaidFlag),
        csvEscape(r.lieuFlag),
        csvEscape(r.bankHolFlag),
        csvEscape(r.doubleFlag),
        csvEscape(r.sickHours ?? 0),
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

    downloadText("wage-app-export.csv", [header, ...rowsCsv, summary].join("\n"));
  }

  const card =
    "rounded-2xl bg-gray-100 border border-gray-200 p-4 shadow dark:bg-white/10 dark:border-white/10";
  const label = "text-sm text-gray-700 dark:text-white/70";
  const input =
    "mt-1 w-full rounded-xl bg-white border border-gray-300 px-3 py-2 text-gray-900 dark:bg-white/10 dark:border-white/10 dark:text-white";

  return (
    <main className="min-h-screen p-6 max-w-4xl mx-auto text-[var(--foreground)]">
      {/* Header */}
{/* Header */}
<header className="mb-5">
  <div className="flex items-center justify-between gap-3">
    {/* Left: Logo + subtitle */}
    <div className="flex items-center gap-3 min-w-0">
      <img
        src="/icon-192.png"
        alt="PayCore logo"
        className="h-20 w-20 sm:h-24 sm:w-24 md:h-28 md:w-28 rounded-2xl shadow-md bg-white"
      />

      <div className="min-w-0">
        <p className="text-xs text-gray-600 dark:text-white/60 truncate">
          v{APP_VERSION} • Created by Phil Crompton
        </p>

        {/* Pro status pill */}
        <div className="mt-1">
          {pro ? (
            <span className="inline-flex items-center gap-2 rounded-full bg-green-100 text-green-900 px-3 py-1 text-xs font-semibold">
              Pro unlocked ✅
            </span>
          ) : (
            <span className="inline-flex items-center gap-2 rounded-full bg-yellow-100 text-yellow-900 px-3 py-1 text-xs font-semibold">
              Free version — Pro locked 🔒
            </span>
          )}
        </div>
      </div>
    </div>

    {/* Right: Buttons */}
    <nav className="flex items-center gap-2 shrink-0">
      <Link
        href="/help"
        className="text-sm px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 border border-white/10"
      >
        Help
      </Link>
      <Link
        href="/settings"
        className="text-sm px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 border border-white/10"
      >
        Settings
      </Link>
    </nav>
  </div>

  {/* Pro unlock box (only when not Pro) */}
  {!pro && (
    <div className="mt-4 rounded-2xl bg-white/10 border border-white/10 p-4">
      <div className="font-semibold mb-2">Unlock Pro</div>

      <div className="flex flex-col sm:flex-row gap-2">
        <input
          value={proCode}
          onChange={(e) => {
            setProCode(e.target.value);
            setProError(null);
          }}
          placeholder="Enter Pro code"
          className="flex-1 rounded-xl bg-black/30 px-3 py-2 text-white placeholder:text-white/40"
        />

        <button
          type="button"
          onClick={() => {
            const res = tryUnlockPro(proCode);

            if (res.ok) {
              setPro(true);
              setProError(null);
              setProCode("");
              refreshSavedMonths();
            } else {
              setPro(false);
              setProError(res.error);
            }
          }}
          className="rounded-xl bg-blue-600 hover:bg-blue-700 px-4 py-2 font-semibold text-white"
        >
          Unlock
        </button>
      </div>

      {proError && <div className="mt-2 text-red-300 text-sm">{proError}</div>}
    </div>
  )}
</header>

      {/* This shift */}
      <div className={`${card} mb-5`}>
        <div className="text-lg font-semibold mb-3">This shift</div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <div className={label}>Date</div>
            <input
              type="date"
              className={input}
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
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
            <input
              type="time"
              step="60"
              className={input}
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </div>

          <div>
            <div className={label}>Finish</div>
            <input
              type="time"
              step="60"
              className={input}
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            />
          </div>

          <div>
            <div className={label}>Holiday</div>
            <select
              className={input}
              value={holidayFlag}
              onChange={(e) => setHolidayFlag(e.target.value as Flag)}
            >
              <option value="">-</option>
              <option value="Y">Full</option>
              <option value="P">Part</option>
            </select>
          </div>

          <div>
            <div className={label}>Unpaid</div>
            <select
              className={input}
              value={unpaidFlag}
              onChange={(e) => setUnpaidFlag(e.target.value as Flag)}
            >
              <option value="">-</option>
              <option value="Y">Full</option>
              <option value="P">Part</option>
            </select>
          </div>

          <div>
            <div className={label}>LIEU</div>
            <select
              className={input}
              value={lieuFlag}
              onChange={(e) => setLieuFlag(e.target.value as Flag)}
            >
              <option value="">-</option>
              <option value="Y">Full</option>
              <option value="P">Part</option>
            </select>
          </div>

          <div>
            <div className={label}>BH</div>
            <select
              className={input}
              value={bankHolFlag}
              onChange={(e) => setBankHolFlag(e.target.value as Flag)}
            >
              <option value="">-</option>
              <option value="Y">Full</option>
              <option value="P">Part</option>
            </select>
          </div>

          <div>
            <div className={label}>Double</div>
            <select
              className={input}
              value={doubleFlag}
              onChange={(e) => setDoubleFlag(e.target.value as Flag)}
            >
              <option value="">-</option>
              <option value="Y">Full</option>
              <option value="P">Part</option>
            </select>
          </div>

          <div>
            <div className={label}>Sick hours</div>
            <input
              className={input}
              value={sickHours}
              onChange={(e) => setSickHours(e.target.value)}
              placeholder="0"
              inputMode="decimal"
            />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="rounded-xl bg-gray-100 border border-gray-200 p-3 dark:bg-black/20 dark:border-white/10">
            <div className="text-sm text-gray-700 dark:text-white/70">
              Worked hours
            </div>
            <div className="text-xl font-bold text-gray-900 dark:text-white">
              {workedHours}
            </div>
          </div>

          <div className="rounded-xl bg-gray-100 border border-gray-200 p-3 dark:bg-black/20 dark:border-white/10">
            <div className="text-sm text-gray-700 dark:text-white/70">
              Premiums today (Late / Night)
            </div>
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
      </div>

      {/* This month */}
      <div className={`${card} mb-5`}>
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div className="text-lg font-semibold">This month</div>
          <div className="flex gap-2 flex-wrap">
            <button
              className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 font-semibold text-white"
              onClick={exportCSV}
            >
              Export CSV
            </button>

            <button
              className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 font-semibold text-white"
              onClick={exportAllTimeCSV}
              title="Exports every shift you've ever saved (even across cleared months)"
            >
              Export ALL shifts
            </button>

            <button
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 font-semibold text-white"
              onClick={() => requirePro(saveCurrentMonthSnapshot)}
              type="button"
              title={!pro ? "Unlock Pro to save months" : "Save this month"}
            >
              Save Month
            </button>

            <button
              className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 font-semibold text-white"
              onClick={clearMonth}
            >
              Clear Month
            </button>
          </div>
        </div>

        <div className="text-lg font-semibold mb-2">Hours</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-sm">
          <div>
            Total Worked: <b>{month.worked}</b>
          </div>

          {/* ✅ FIXED: SSR-safe OT threshold display (no localStorage reads during render) */}
          <div>
            Qualifying (for {otThresholdDisplay}): <b>{month.qualifying}</b>
          </div>

          <div>
            STD Hours: <b>{month.std}</b>
          </div>
          <div>
            OT Hours: <b>{month.ot}</b>
          </div>
          <div>
            Late Prem: <b>{month.late}</b>
          </div>
          <div>
            Night Prem: <b>{month.night}</b>
          </div>
          <div>
            HOL Hours: <b>{month.hol}</b>
          </div>
          <div>
            LIEU Hours: <b>{month.lieu}</b>
          </div>
          <div>
            BH Hours: <b>{month.bankHol}</b>
          </div>
          <div>
            Double Hours: <b>{month.dbl}</b>
          </div>
          <div>
            Unpaid (Full): <b>{month.unpaidFull}</b>
          </div>
          <div>
            Unpaid (Part): <b>{month.unpaidPart}</b>
          </div>
          <div>
            Sick Hours: <b>{month.sick}</b>
          </div>
        </div>

        <div className="pt-4 mt-4 border-t border-white/20">
          <div className="text-lg font-semibold mb-2">Pay (£)</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-sm">
            <div>
              STD pay: <b>{fmtGBP(month.stdPay)}</b>
            </div>
            <div>
              OT pay: <b>{fmtGBP(month.otPay)}</b>
            </div>
            <div>
              Sick pay: <b>{fmtGBP(month.sickPay)}</b>
            </div>
            <div>
              Late add-on: <b>{fmtGBP(month.lateAddPay)}</b>
            </div>
            <div>
              Night add-on: <b>{fmtGBP(month.nightAddPay)}</b>
            </div>
            <div>
              LIEU pay: <b>{fmtGBP(month.lieuPay)}</b>
            </div>
            <div>
              BH pay: <b>{fmtGBP(month.bankHolPay)}</b>
            </div>
            <div>
              Double pay: <b>{fmtGBP(month.doublePay)}</b>
            </div>
            <div>
              Holiday pay: <b>{fmtGBP(month.holPay)}</b>
            </div>
          </div>

          <div className="mt-3 text-base font-semibold">
            Total: {fmtGBP(month.totalPay)}
          </div>
        </div>
      </div>

      {/* Weekly summary */}
      <div className={`${card} mb-5`}>
        <div className="text-lg font-semibold mb-2">Weekly summary</div>
        <div className="text-xs text-gray-600 dark:text-white/60 mb-3">
          Week start: {weekStartLabel(weekStartsOn)} (set in Settings)
        </div>

        {weeks.length === 0 ? (
          <div className="text-sm text-gray-600 dark:text-white/60">
            No shifts yet.
          </div>
        ) : (
          <div className="space-y-3">
            {weeks.slice(0, 6).map((w) => (
              <div
                key={w.weekId}
                className="rounded-xl bg-black/10 dark:bg-black/20 p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="font-semibold">{w.label}</div>
                  <div className="text-sm">
                    Total: <b>{fmtGBP(w.totalPay)}</b>
                  </div>
                </div>

                <div className="mt-2 grid grid-cols-2 gap-1 text-sm">
                  <div>
                    Worked: <b>{w.worked}</b>
                  </div>
                  <div>
                    Qualifying: <b>{w.qualifying}</b>
                  </div>
                  <div>
                    STD: <b>{w.std}</b>
                  </div>
                  <div>
                    OT: <b>{w.ot}</b>
                  </div>
                  <div>
                    Holiday: <b>{w.hol}</b>
                  </div>
                  <div>
                    LIEU: <b>{w.lieu}</b>
                  </div>
                  <div>
                    BH: <b>{w.bankHol}</b>
                  </div>
                  <div>
                    Double: <b>{w.dbl}</b>
                  </div>
                  <div>
                    Late: <b>{w.late}</b>
                  </div>
                  <div>
                    Night: <b>{w.night}</b>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Saved months (dropdown) */}
      {/* ...unchanged below... */}
      <div className={`${card} mt-5`}>
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div className="text-lg font-semibold">Saved months</div>
          <button
            type="button"
            onClick={refreshSavedMonths}
            className="text-xs px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15"
            title="Refresh saved months list"
          >
            Refresh
          </button>
        </div>

        {!pro ? (
          <div className="rounded-xl bg-yellow-100 text-yellow-900 px-3 py-2 text-sm">
            Pro feature — unlock Pro to save and view historical months.
          </div>
        ) : savedMonths.length === 0 ? (
          <div className="text-sm text-gray-600 dark:text-white/60">
            No saved months yet.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <div className={label}>Select saved month</div>
                <select
                  className={input}
                  value={selectedSavedMonthId}
                  onChange={(e) => setSelectedSavedMonthId(e.target.value)}
                >
                  {savedMonths.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>

                <div className="text-xs text-gray-600 dark:text-white/60 mt-1">
                  {selectedSavedMonth
                    ? `Shifts: ${
                        selectedSavedMonth.shiftCount
                      } • Saved: ${new Date(
                        selectedSavedMonth.createdAt
                      ).toLocaleString()}`
                    : ""}
                </div>
              </div>

              <div className="flex items-end justify-end gap-2">
                <button
                  type="button"
                  onClick={() =>
                    selectedSavedMonth &&
                    renameSavedMonth(selectedSavedMonth.id)
                  }
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 font-semibold text-white"
                >
                  Rename
                </button>

                <button
                  type="button"
                  onClick={() =>
                    selectedSavedMonth &&
                    removeSavedMonth(selectedSavedMonth.id)
                  }
                  className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 font-semibold text-white"
                >
                  Delete selected
                </button>
              </div>
            </div>

            {selectedSavedMonth && (
              <div className="mt-4 rounded-xl bg-black/20 p-3">
                <div className="font-semibold mb-2">
                  {selectedSavedMonth.label}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-sm text-white/80">
                  <div>
                    Worked: <b>{selectedSavedMonth.totals?.worked ?? 0}</b>
                  </div>
                  <div>
                    Qualifying:{" "}
                    <b>{selectedSavedMonth.totals?.qualifying ?? 0}</b>
                  </div>
                  <div>
                    STD: <b>{selectedSavedMonth.totals?.std ?? 0}</b>
                  </div>
                  <div>
                    OT: <b>{selectedSavedMonth.totals?.ot ?? 0}</b>
                  </div>
                  <div>
                    Holiday: <b>{selectedSavedMonth.totals?.hol ?? 0}</b>
                  </div>
                  <div>
                    LIEU: <b>{selectedSavedMonth.totals?.lieu ?? 0}</b>
                  </div>
                  <div>
                    BH: <b>{selectedSavedMonth.totals?.bankHol ?? 0}</b>
                  </div>
                  <div>
                    Double: <b>{selectedSavedMonth.totals?.dbl ?? 0}</b>
                  </div>
                  <div>
                    Late: <b>{selectedSavedMonth.totals?.late ?? 0}</b>
                  </div>
                  <div>
                    Night: <b>{selectedSavedMonth.totals?.night ?? 0}</b>
                  </div>
                  <div>
                    Total pay:{" "}
                    <b>{fmtGBP(selectedSavedMonth.totals?.totalPay ?? 0)}</b>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Saved shifts */}
      <div className={`${card} mt-5`}>
        <div className="text-lg font-semibold mb-3">Saved shifts</div>

        {rows.length === 0 ? (
          <div className="text-sm text-gray-600 dark:text-white/60">
            No saved shifts yet.
          </div>
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
                          onClick={() => deleteShift(r.id)}
                          className="text-xs px-2 py-1 rounded bg-red-500 text-white"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="mt-2 grid grid-cols-2 gap-1 text-sm text-white/80">
                    <div>
                      Scheduled: <b>{r.scheduledHours ?? 0}</b>
                    </div>
                    <div>
                      Worked: <b>{wh}</b>
                    </div>
                    <div>
                      Holiday: <b>{displayFlag(r.holidayFlag)}</b>
                    </div>
                    <div>
                      Unpaid: <b>{displayFlag(r.unpaidFlag)}</b>
                    </div>
                    <div>
                      LIEU: <b>{displayFlag(r.lieuFlag)}</b>
                    </div>
                    <div>
                      BH: <b>{displayFlag(r.bankHolFlag)}</b>
                    </div>
                    <div>
                      Double: <b>{displayFlag(r.doubleFlag)}</b>
                    </div>
                    <div>
                      Sick: <b>{r.sickHours ?? 0}</b>
                    </div>
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