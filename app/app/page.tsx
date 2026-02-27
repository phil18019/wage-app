"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { DEFAULT_SETTINGS, getSettings, type Settings } from "../lib/settings";
import { computeWorkedHours } from "../lib/engine/time";
import { fmtGBP } from "../lib/engine/money";
import { computeMonthTotals } from "../lib/engine/month";
import { computeWeeklyTotals } from "../lib/engine/week";
import { isProEnabled, tryUnlockPro } from "../lib/pro";
import {
  listSavedMonths,
  upsertSavedMonth,
  deleteSavedMonth,
  monthIdFromDate,
  labelFromMonthId,
  type SavedMonth,
} from "../lib/engine/history";

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
  const rates = Array.isArray((settings as any)?.rates)
    ? (settings as any).rates
    : [];
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
  const [selectedSavedMonthId, setSelectedSavedMonthId] = useState<string>("");

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

  const sickConflict =
    Number(sickHours) > 0 && (startTime !== "" || endTime !== "");

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

    // nice UX: scroll to the input card when editing from lower down
    try {
      document.getElementById("card-this-shift")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    } catch {
      // ignore
    }
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

  /* ------------------------- styling tokens ------------------------- */

  const card =
    "rounded-2xl bg-gray-100 border border-gray-200 p-4 shadow-sm dark:bg-white/10 dark:border-white/10";
  const label = "text-sm text-gray-700 dark:text-white/70";
  const input =
    "mt-1 w-full min-w-0 max-w-full rounded-xl bg-white border border-gray-300 px-3 py-2 text-gray-900 dark:bg-white/10 dark:border-white/10 dark:text-white";

  const tile =
    "rounded-xl bg-white/70 border border-gray-200 px-3 py-2 dark:bg-black/20 dark:border-white/10";
  const tileK = "text-xs text-gray-600 dark:text-white/60";
  const tileV = "text-lg font-bold text-gray-900 dark:text-white";

  function StatTile(props: { k: string; v: React.ReactNode; sub?: string }) {
    return (
      <div className={tile}>
        <div className={tileK}>{props.k}</div>
        <div className={tileV}>{props.v}</div>
        {props.sub ? (
          <div className="text-[11px] text-gray-500 dark:text-white/45 mt-0.5">
            {props.sub}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <main className="min-h-screen p-6 max-w-4xl mx-auto text-[var(--foreground)] pb-28">
        {/* Header */}
        <header className="mb-5">
          <div className="flex items-center justify-between gap-3">
            {/* Left */}
            <div className="flex items-center gap-3 min-w-0">
              {/* Small icon (optional, keeps branding without clutter) */}
              <img
                src="/icon-192.png"
                alt="PayCore"
                className="h-12 w-12 rounded-2xl shadow bg-white"
              />

              <div className="min-w-0">
                <div className="font-semibold leading-tight">PayCore</div>
                <p className="text-xs text-gray-600 dark:text-white/60 truncate">
                  v{APP_VERSION} • Created by Phil Crompton
                </p>
              </div>
            </div>

            {/* Right */}
            <nav className="flex items-center gap-2 shrink-0">
              <Link
                href="/help"
                className="text-sm px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 border border-white/10"
              >
                Help
              </Link>

              {/* Settings + subtle Pro lock hint */}
              <div className="relative group">
                <Link
                  href="/settings"
                  className="text-sm px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 border border-white/10 inline-flex items-center gap-2"
                >
                  Settings
                  {!pro && (
                    <span className="text-xs opacity-90" aria-label="Pro locked">
                      🔒
                    </span>
                  )}
                </Link>

                {!pro && (
                  <div className="pointer-events-none absolute right-0 mt-2 hidden group-hover:block">
                    <div className="rounded-xl bg-black text-white text-xs px-3 py-2 shadow-lg whitespace-nowrap">
                      Pro features locked — enter code to unlock
                    </div>
                  </div>
                )}
              </div>
            </nav>
          </div>

          {/* Pro unlock box (only when not Pro) — smaller + calmer */}
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

              {proError && (
                <div className="mt-2 text-red-300 text-sm">{proError}</div>
              )}
            </div>
          )}
        </header>

        {/* This shift (single input card — unchanged structure, just cleaner) */}
        <div id="card-this-shift" className={`${card} mb-5`}>
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="text-lg font-semibold">This shift</div>
            {editingId ? (
              <div className="text-xs rounded-full bg-blue-600/20 text-blue-800 dark:text-blue-200 px-3 py-1">
                Editing saved shift
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="min-w-0">
              <div className={label}>Date</div>
              <input
                type="date"
                className={input}
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>

            <div className="min-w-0">
              <div className={label}>Scheduled hours</div>
              <input
                className={input}
                value={scheduledHours}
                onChange={(e) => setScheduledHours(e.target.value)}
                placeholder="e.g. 10"
                inputMode="decimal"
              />
            </div>

            <div className="min-w-0">
              <div className={label}>Start</div>
              <input
                type="time"
                step="60"
                className={input}
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>

            <div className="min-w-0">
              <div className={label}>Finish</div>
              <input
                type="time"
                step="60"
                className={input}
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>

            <div className="min-w-0 sm:col-span-2">
              <button
                type="button"
                onClick={() => {
                  setStartTime("");
                  setEndTime("");
                }}
                className="mt-1 w-full text-xs px-3 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10"
              >
                Clear start / finish times
              </button>
            </div>

            {/* Flags (kept all in this card, per your requirement) */}
            <div className="min-w-0">
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

            <div className="min-w-0">
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

            <div className="min-w-0">
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

            <div className="min-w-0">
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

            <div className="min-w-0">
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

            <div className="min-w-0">
              <div className={label}>Sick hours</div>
              <input
                className={input}
                value={sickHours}
                onChange={(e) => setSickHours(e.target.value)}
                placeholder="0"
                inputMode="decimal"
              />

              {sickConflict && (
                <div className="mt-2 rounded-xl bg-red-100 text-red-800 px-3 py-2 text-sm font-medium">
                  Start &amp; finish times must be removed when sick hours are
                  entered
                </div>
              )}
            </div>
          </div>

          {/* Small live tiles */}
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
            <StatTile k="Worked hours" v={workedHours} />
            <StatTile k="Premiums (Late / Night)" v={`${prem.lateHours} / ${prem.nightHours}`} />
            <StatTile k="OT threshold" v={otThresholdDisplay} sub="from rate history" />
            <StatTile k="Editing?" v={editingId ? "Yes" : "No"} />
          </div>

          {/* Save/Update */}
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
                className="w-full rounded-xl bg-white/15 hover:bg-white/20 px-4 py-3 font-semibold border border-white/10"
                onClick={cancelEdit}
                type="button"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              className="mt-4 w-full rounded-xl bg-blue-600 hover:bg-blue-700 px-4 py-3 font-semibold text-white"
              onClick={saveDayToMonth}
              type="button"
            >
              Save day to month
            </button>
          )}
        </div>

        {/* Daily shifts (separate card, edit sends user back to This shift) */}
        <div className={`${card} mb-5`}>
          <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
            <div className="text-lg font-semibold">Daily shifts</div>
            <div className="text-xs text-gray-600 dark:text-white/60">
              Tap Edit to load into “This shift”
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="text-sm text-gray-600 dark:text-white/60">
              No saved shifts yet.
            </div>
          ) : (
            <div className="space-y-3">
              {rows.map((r) => {
                const wh = computeWorkedHours(r.startTime, r.endTime);
                return (
                  <div key={r.id} className="rounded-xl bg-black/10 dark:bg-black/20 p-3">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="font-semibold">{r.date}</div>

                      <div className="flex items-center gap-3">
                        <div className="text-sm text-gray-700 dark:text-white/70">
                          {r.startTime || "--:--"} → {r.endTime || "--:--"}
                        </div>

                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => loadShiftForEdit(r)}
                            className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white"
                          >
                            Edit
                          </button>

                          <button
                            type="button"
                            onClick={() => deleteShift(r.id)}
                            className="text-xs px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                      <div className={tile}>
                        <div className={tileK}>Scheduled</div>
                        <div className="font-semibold">{r.scheduledHours ?? 0}</div>
                      </div>
                      <div className={tile}>
                        <div className={tileK}>Worked</div>
                        <div className="font-semibold">{wh}</div>
                      </div>
                      <div className={tile}>
                        <div className={tileK}>Holiday</div>
                        <div className="font-semibold">{displayFlag(r.holidayFlag)}</div>
                      </div>
                      <div className={tile}>
                        <div className={tileK}>Unpaid</div>
                        <div className="font-semibold">{displayFlag(r.unpaidFlag)}</div>
                      </div>
                      <div className={tile}>
                        <div className={tileK}>LIEU</div>
                        <div className="font-semibold">{displayFlag(r.lieuFlag)}</div>
                      </div>
                      <div className={tile}>
                        <div className={tileK}>BH</div>
                        <div className="font-semibold">{displayFlag(r.bankHolFlag)}</div>
                      </div>
                      <div className={tile}>
                        <div className={tileK}>Double</div>
                        <div className="font-semibold">{displayFlag(r.doubleFlag)}</div>
                      </div>
                      <div className={tile}>
                        <div className={tileK}>Sick</div>
                        <div className="font-semibold">{r.sickHours ?? 0}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* This month (tiles instead of long text lists) */}
        <div className={`${card} mb-5`}>
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <div className="text-lg font-semibold">This month</div>

            <div className="flex gap-2 flex-wrap">
              <button
                className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 font-semibold text-white"
                onClick={exportCSV}
                type="button"
              >
                Export CSV
              </button>

              <button
                className="px-4 py-2 rounded-lg bg-emerald-700 hover:bg-emerald-800 font-semibold text-white"
                onClick={exportAllTimeCSV}
                type="button"
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
                type="button"
              >
                Clear Month
              </button>
            </div>
          </div>

          <div className="text-sm font-semibold mb-2">Hours</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            <StatTile k="Worked" v={month.worked} />
            <StatTile k={`Qualifying (for ${otThresholdDisplay})`} v={month.qualifying} />
            <StatTile k="STD hours" v={month.std} />
            <StatTile k="OT hours" v={month.ot} />
            <StatTile k="Late prem" v={month.late} />
            <StatTile k="Night prem" v={month.night} />
            <StatTile k="Holiday" v={month.hol} />
            <StatTile k="LIEU" v={month.lieu} />
            <StatTile k="BH" v={month.bankHol} />
            <StatTile k="Double" v={month.dbl} />
            <StatTile k="Unpaid (full)" v={month.unpaidFull} />
            <StatTile k="Unpaid (part)" v={month.unpaidPart} />
            <StatTile k="Sick" v={month.sick} />
          </div>

          <div className="pt-4 mt-4 border-t border-white/20">
            <div className="text-sm font-semibold mb-2">Pay (£)</div>

            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
              <StatTile k="STD pay" v={fmtGBP(month.stdPay)} />
              <StatTile k="OT pay" v={fmtGBP(month.otPay)} />
              <StatTile k="Sick pay" v={fmtGBP(month.sickPay)} />
              <StatTile k="Late add-on" v={fmtGBP(month.lateAddPay)} />
              <StatTile k="Night add-on" v={fmtGBP(month.nightAddPay)} />
              <StatTile k="LIEU pay" v={fmtGBP(month.lieuPay)} />
              <StatTile k="BH pay" v={fmtGBP(month.bankHolPay)} />
              <StatTile k="Double pay" v={fmtGBP(month.doublePay)} />
              <StatTile k="Holiday pay" v={fmtGBP(month.holPay)} />
            </div>

            <div className="mt-3 rounded-xl bg-blue-600/15 border border-blue-600/20 px-4 py-3 flex items-center justify-between">
              <div className="text-sm font-semibold">Total pay</div>
              <div className="text-xl font-bold">{fmtGBP(month.totalPay)}</div>
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
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="font-semibold">{w.label}</div>
                    <div className="text-sm">
                      Total: <b>{fmtGBP(w.totalPay)}</b>
                    </div>
                  </div>

                  <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                    <StatTile k="Worked" v={w.worked} />
                    <StatTile k="Qualifying" v={w.qualifying} />
                    <StatTile k="STD" v={w.std} />
                    <StatTile k="OT" v={w.ot} />
                    <StatTile k="Holiday" v={w.hol} />
                    <StatTile k="LIEU" v={w.lieu} />
                    <StatTile k="BH" v={w.bankHol} />
                    <StatTile k="Double" v={w.dbl} />
                    <StatTile k="Late" v={w.late} />
                    <StatTile k="Night" v={w.night} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Saved months */}
        <div className={`${card} mt-5`}>
          <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
            <div className="text-lg font-semibold">Saved months</div>
            <button
              type="button"
              onClick={refreshSavedMonths}
              className="text-xs px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 border border-white/10"
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
                      ? `Shifts: ${selectedSavedMonth.shiftCount} • Saved: ${new Date(
                          selectedSavedMonth.createdAt
                        ).toLocaleString()}`
                      : ""}
                  </div>
                </div>

                <div className="flex items-end justify-end gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      selectedSavedMonth && renameSavedMonth(selectedSavedMonth.id)
                    }
                    className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 font-semibold text-white"
                  >
                    Rename
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      selectedSavedMonth && removeSavedMonth(selectedSavedMonth.id)
                    }
                    className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 font-semibold text-white"
                  >
                    Delete selected
                  </button>
                </div>
              </div>

              {selectedSavedMonth && (
                <div className="mt-4 rounded-xl bg-black/10 dark:bg-black/20 p-3">
                  <div className="font-semibold mb-2">{selectedSavedMonth.label}</div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                    <StatTile k="Worked" v={selectedSavedMonth.totals?.worked ?? 0} />
                    <StatTile
                      k="Qualifying"
                      v={selectedSavedMonth.totals?.qualifying ?? 0}
                    />
                    <StatTile k="STD" v={selectedSavedMonth.totals?.std ?? 0} />
                    <StatTile k="OT" v={selectedSavedMonth.totals?.ot ?? 0} />
                    <StatTile k="Holiday" v={selectedSavedMonth.totals?.hol ?? 0} />
                    <StatTile k="LIEU" v={selectedSavedMonth.totals?.lieu ?? 0} />
                    <StatTile k="BH" v={selectedSavedMonth.totals?.bankHol ?? 0} />
                    <StatTile k="Double" v={selectedSavedMonth.totals?.dbl ?? 0} />
                    <StatTile k="Late" v={selectedSavedMonth.totals?.late ?? 0} />
                    <StatTile k="Night" v={selectedSavedMonth.totals?.night ?? 0} />
                    <StatTile
                      k="Total pay"
                      v={fmtGBP(selectedSavedMonth.totals?.totalPay ?? 0)}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {/* Sticky bottom bar (running totals) */}
      <div className="fixed bottom-0 left-0 right-0 z-50">
        <div className="mx-auto max-w-4xl px-6 pb-4">
          <div className="rounded-2xl border border-white/10 bg-black/70 backdrop-blur-md text-white shadow-lg">
            <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
              <div className="text-sm font-semibold">Running totals</div>

              <div className="flex items-center gap-3 text-sm">
                <div className="opacity-80">Worked:</div>
                <div className="font-semibold">{month.worked}</div>

                <div className="opacity-80">OT:</div>
                <div className="font-semibold">{month.ot}</div>

                <div className="opacity-80">Late/Night:</div>
                <div className="font-semibold">
                  {month.late}/{month.night}
                </div>

                <div className="opacity-80">Total:</div>
                <div className="font-bold">{fmtGBP(month.totalPay)}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}