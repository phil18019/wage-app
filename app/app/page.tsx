// app/app/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { DEFAULT_SETTINGS, getSettings, type Settings, SETTINGS_KEY } from "../lib/settings";
import { computeWorkedHours } from "../lib/engine/time";
import { fmtGBP } from "../lib/engine/money";
import { computeHolidayBalance } from "../lib/engine/holidayBalance";
import { computeMonthTotals } from "../lib/engine/month";
import { computeWeeklyTotals } from "../lib/engine/week";
import {
  computePremiumHours,
  getPremiumWindows,
  type PremiumWindows,
} from "../lib/engine/premiums";
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
const APP_VERSION = "1.0.1";

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

function exportAllTimeCSV(settings: Settings, windows: PremiumWindows) {
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
    const b = computeRowBreakdown(r, settings, windows);

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

  downloadText("paycore-all-shifts.csv", [header, ...rowsCsv].join("\n"));
}

/* ------------------------------------------------------------------------- */

/**
 * Per-row breakdown used by:
 * - Shifts tab display (so Worked=0 when Full LIEU/BH/HOL/Unpaid)
 * - CSV exports
 *
 * IMPORTANT: this mirrors the logic in app/lib/engine/week.ts
 * including the new setting: settings.protectPremiumsForLieuBH
 */
function computeRowBreakdown(r: ShiftRow, settings: Settings, windows: PremiumWindows) {
  const sh = clampNonNeg(Number(r.scheduledHours) || 0);
  const whRaw = clampNonNeg(computeWorkedHours(r.startTime ?? "", r.endTime ?? ""));
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

  // If any "full day off" flag is set, physical worked is 0.
  // (Double is NOT a day-off flag.)
  const workedPhysical = fullUnpaid || fullHol || fullLieu || fullBH ? 0 : whRaw;

  let remainder = round2(Math.max(0, baseShift - workedPhysical));

 const out = {
  worked: workedPhysical,
  hol: 0,
  lieu: 0,
  bankHol: 0,
  dbl: 0,
  stdTopUp: 0,
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

  // Double allocation (subset of worked)
  if (fullDouble) {
    out.dbl = round2(Math.min(baseShift, Math.max(0, whRaw || baseShift)));
} else if (partDouble) {
  out.dbl = round2(workedPhysical);
  out.stdTopUp = round2(Math.max(0, baseShift - workedPhysical));
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

  // Default true if missing (keeps old behaviour)
  const protectLieuBH =
    (settings as any)?.protectPremiumsForLieuBH === undefined
      ? true
      : Boolean((settings as any)?.protectPremiumsForLieuBH);

  if (!premiumsBlocked && baseShift > 0 && r.startTime) {
    const hasEnd = (r.endTime ?? "").trim() !== "";

    const hasLieuOrBH = (r.lieuFlag ?? "").trim() !== "" || (r.bankHolFlag ?? "").trim() !== "";
    const hasDouble = (r.doubleFlag ?? "").trim() !== "";

    const normalPremEnd = hasEnd
      ? (r.endTime as string)
      : sh > 0
        ? addHoursToTime(r.startTime, sh)
        : "";

    const scheduledPremEnd = sh > 0 ? addHoursToTime(r.startTime, sh) : normalPremEnd;

    let premEnd = "";

    // Double: prefer actual endTime (includes extra premiums if worked > scheduled)
    // Full Double: keep existing behaviour
if (fullDouble) {
  premEnd = hasEnd ? (r.endTime as string) : sh > 0 ? addHoursToTime(r.startTime, sh) : "";
}
// Part Double: when protection is ON, protect across scheduled window
else if (partDouble && protectLieuBH) {
  premEnd = scheduledPremEnd;
}
// Part Double: when protection is OFF, use actual/normal end
else if (partDouble) {
  premEnd = normalPremEnd;
}
// LIEU/BH: protect to scheduled window only if toggle ON
else if (hasLieuOrBH && protectLieuBH) {
  premEnd = scheduledPremEnd;
}
// Normal (or LIEU/BH with protection OFF)
else {
  premEnd = normalPremEnd;
}

    const p = computePremiumHours(r.startTime, premEnd, windows);

    // Premiums count if:
    // - It's a protected scenario (Double always protected; LIEU/BH depends on toggle), OR
    // - There was worked time (normal shifts)
    const premiumsProtected = hasDouble || (hasLieuOrBH && protectLieuBH);

    if (premiumsProtected || workedPhysical > 0) {
      out.late += clampNonNeg(p.lateHours);
      out.night += clampNonNeg(p.nightHours);
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
 * Do NOT read localStorage during render.
 * We derive from already-loaded `settings` state.
 */
function rateForDateFromSettings(settings: Settings, date: string) {
  const rates = Array.isArray((settings as any)?.rates) ? (settings as any).rates : [];
  if (!rates.length) return { otThreshold: 0 };

  const sorted = [...rates].sort((a, b) => (a.effectiveDate < b.effectiveDate ? -1 : 1));

  let best = sorted[0];
  for (const r of sorted) {
    if (r.effectiveDate <= date) best = r;
    else break;
  }
  return best;
}

/* ------------------------------ UI tabs ------------------------------ */

type TabKey = "shift" | "shifts" | "week" | "month" | "history";

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabKey>("shift");

  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [rows, setRows] = useState<ShiftRow[]>([]);
  const [hasLoadedRows, setHasLoadedRows] = useState(false);

  const [savedMonths, setSavedMonths] = useState<SavedMonth[]>([]);
  const [selectedSavedMonthId, setSelectedSavedMonthId] = useState<string>("");

  const [pro, setPro] = useState(false);
 

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

  const premiumWindows = useMemo(() => getPremiumWindows(settings), [settings]);
  const premiumLabel = useMemo(() => {
    return `Late ${premiumWindows.late.start}–${premiumWindows.late.end} • Night ${premiumWindows.night.start}–${premiumWindows.night.end}`;
  }, [premiumWindows]);

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

 const params = new URLSearchParams(window.location.search);
const success = params.get("success");

if (success === "1") {
  localStorage.setItem("wagecheck_pro_v1", "1");
  setPro(true);
  window.history.replaceState({}, "", "/app");
} else {
  setPro(isProEnabled());
}
    try {
      const raw = localStorage.getItem(STORAGE_KEY_MONTH);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setRows(parsed as ShiftRow[]);
      }
    } catch {
      // ignore
    } finally {
      setHasLoadedRows(true);
    }

    try {
      refreshSavedMonths();
    } catch {
      // ignore
    }
  }, []);
useEffect(() => {
  if (typeof window === "undefined") return;

  const params = new URLSearchParams(window.location.search);
  const success = params.get("success");

  if (success === "1") {
    localStorage.setItem("wagecheck_pro_v1", "1");
    setPro(true);

    // remove the success parameter from the URL
    window.history.replaceState({}, "", "/");
  }
}, []);
  // Re-sync settings when returning from /settings (fixes Shift tab using stale checkbox value)
  useEffect(() => {
    const syncSettings = () => {
      try {
        setSettings(getSettings());
      } catch {
        setSettings(DEFAULT_SETTINGS);
      }
    };

    window.addEventListener("focus", syncSettings);

    const onVis = () => {
      if (!document.hidden) syncSettings();
    };
    document.addEventListener("visibilitychange", onVis);

    const onStorage = (e: StorageEvent) => {
      if (e.key === SETTINGS_KEY) syncSettings();
    };
    window.addEventListener("storage", onStorage);

    return () => {
      window.removeEventListener("focus", syncSettings);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("storage", onStorage);
    };
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

  const sickConflict = Number(sickHours) > 0 && (startTime !== "" || endTime !== "");

  const workedHoursRaw = useMemo(
    () => clampNonNeg(computeWorkedHours(startTime, endTime)),
    [startTime, endTime]
  );

  // ✅ What the UI should show as "Worked hours" on Shift tab
  // Full LIEU/BH/HOL/Unpaid = not physically worked (even if times entered)
  const workedHours = useMemo(() => {
    const fullHol = holidayFlag === "Y";
    const fullUnpaid = unpaidFlag === "Y";
    const fullLieu = lieuFlag === "Y";
    const fullBH = bankHolFlag === "Y";
    return fullHol || fullUnpaid || fullLieu || fullBH ? 0 : workedHoursRaw;
  }, [workedHoursRaw, holidayFlag, unpaidFlag, lieuFlag, bankHolFlag]);

  // ✅ Shift-tab premiums now match week/month rules:
  // - With checkbox OFF: LIEU/BH do NOT protect premiums AND premiums only count when physically worked.
  // - Full LIEU/BH/HOL/Unpaid => workedPhysical=0, so premiums must be 0.
  const prem = useMemo(() => {
    const sh = clampNonNeg(Number(scheduledHours) || 0);
    const wh = workedHoursRaw; // raw worked from times (may be >0 even on Full LIEU)
    const workedPhysical =
      holidayFlag === "Y" || unpaidFlag === "Y" || lieuFlag === "Y" || bankHolFlag === "Y"
        ? 0
        : wh;

    const fullHol = holidayFlag === "Y";
    const fullUnpaid = unpaidFlag === "Y";
    const premiumsBlocked = fullHol || fullUnpaid;

    const protectLieuBH =
      (settings as any)?.protectPremiumsForLieuBH === undefined
        ? true
        : Boolean((settings as any)?.protectPremiumsForLieuBH);

    const hasLieuOrBH = lieuFlag !== "" || bankHolFlag !== "";
    const hasDouble = doubleFlag !== "";
    const fullDouble = doubleFlag === "Y";
    const partDouble = doubleFlag === "P";

    if (premiumsBlocked || !startTime) return { lateHours: 0, nightHours: 0 };

    const hasEnd = (endTime || "").trim() !== "";

    const normalPremEnd = hasEnd ? endTime : sh > 0 ? addHoursToTime(startTime, sh) : "";
    const scheduledPremEnd = sh > 0 ? addHoursToTime(startTime, sh) : normalPremEnd;
let premEnd = normalPremEnd;

// Full Double: keep existing behaviour
if (fullDouble) {
  premEnd = hasEnd ? endTime : sh > 0 ? addHoursToTime(startTime, sh) : "";
}
// Part Double: protect across scheduled window when toggle ON
else if (partDouble && protectLieuBH) {
  premEnd = scheduledPremEnd;
}
// Part Double: normal worked window when toggle OFF
else if (partDouble) {
  premEnd = normalPremEnd;
}
// LIEU/BH: protect to scheduled window only if toggle ON
else if (hasLieuOrBH && protectLieuBH) {
  premEnd = scheduledPremEnd;
}
// Normal (or LIEU/BH with protection OFF)
else {
  premEnd = normalPremEnd;
}

    const p = computePremiumHours(startTime, premEnd, premiumWindows);

    // Premiums count if:
    // - Protected scenario (Double always; LIEU/BH only when toggle ON), OR
    // - There was physically worked time
   
    const premiumsProtected =
  fullDouble ||
  (partDouble && protectLieuBH) ||
  (hasLieuOrBH && protectLieuBH);

    if (premiumsProtected || workedPhysical > 0) return p;

    return { lateHours: 0, nightHours: 0 };
  }, [
    startTime,
    endTime,
    scheduledHours,
    holidayFlag,
    unpaidFlag,
    lieuFlag,
    bankHolFlag,
    doubleFlag,
    premiumWindows,
    settings,
    workedHoursRaw,
  ]);

  const month = useMemo(() => computeMonthTotals(rows as any, settings), [rows, settings]);



  const holidayBal = useMemo(() => {
    try {

      const savedRows = (savedMonths ?? []).reduce((acc: any[], m: any) => {
        return acc.concat(m.rows ?? m.shifts ?? []);
      }, []);

      const allRows = [...(rows ?? []), ...savedRows];

      return computeHolidayBalance(allRows as any, settings as any);

    } catch {
      return null;
    }
  }, [rows, savedMonths, settings]);
  const weeks = useMemo(
    () => computeWeeklyTotals(rows as any, settings, weekStartsOn),
    [rows, settings, weekStartsOn]
  );

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
  upsertAllTimeShift(row);
  resetDailyInputs();
}

  function deleteShift(id: string) {
    if (!confirm("Delete this saved shift?")) return;
    setRows((prev) => prev.filter((r) => r.id !== id));
    deleteAllTimeShift(id);
  }
async function handleRestorePro() {
  const email = window.prompt("Enter the email used for your subscription");

  if (!email) return;

  try {
    const res = await fetch("/api/stripe/restore", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email }),
    });

    const data = await res.json();

    if (data.active) {
      localStorage.setItem("wagecheck_pro_v1", "1");
      setPro(true);
      alert("Pro restored successfully.");
    } else {
      alert("No active subscription found for that email.");
    }
  } catch (err) {
    console.error(err);
    alert("Unable to restore Pro right now. Please try again.");
  }
}

  function loadShiftForEdit(row: ShiftRow) {
    setActiveTab("shift");

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
    upsertAllTimeShift(updatedRow);

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

    const ok = confirm(
      "Save this month as a history snapshot?\n\n" +
      "This locks the totals for this period.\n" +
      "Future edits to shifts will NOT update this saved month.\n\n" +
      "If you need to change it later, delete the saved month and save again."
    );
    if (!ok) return;

    const id = monthIdFromDate(date);
    const defaultLabel = labelFromMonthId(id);

    const customLabelRaw = prompt("Name this saved period:", defaultLabel);
    if (customLabelRaw === null) return;
    const label = customLabelRaw.trim() || defaultLabel;

    const existing = savedMonths.find((m) => m.id === id);

    if (existing) {
      const ok2 = confirm(`${existing.label} already exists. Overwrite saved period?`);
      if (!ok2) return;

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
    const labelTxt = found?.label ?? id;

    const msg =
      `Delete saved period "${labelTxt}"?\n\n` +
      `This will permanently remove:\n` +
      `• The saved period entry\n` +
      `• All shifts stored inside it (also removed from Export ALL shifts)\n\n` +
      `This cannot be undone.`;

    if (!confirm(msg)) return;

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
      const b = computeRowBreakdown(r, settings, premiumWindows);

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

    downloadText("paycore-export.csv", [header, ...rowsCsv, summary].join("\n"));
  }

  /* ------------------------------ styles ------------------------------ */

const card =
  "rounded-2xl overflow-hidden bg-gray-100 border border-gray-200 p-4 shadow dark:bg-white/10 dark:border-white/10";
  const label = "text-sm text-gray-700 dark:text-white/70";

  // ✅ important for mobile: prevents time inputs/selects from forcing overflow
const input =
  "mt-1 w-full min-w-0 max-w-full box-border appearance-none rounded-xl bg-white border border-gray-300 px-3 py-2 text-gray-900 dark:bg-white/10 dark:border-white/10 dark:text-white";

  function tabButtonClass(isActive: boolean, locked?: boolean) {
    return [
      "flex-1 rounded-xl px-3 py-2 text-xs sm:text-sm font-semibold border",
      isActive
        ? "bg-blue-600 text-white border-blue-700"
        : "bg-white/70 dark:bg-white/10 text-gray-900 dark:text-white border-gray-200 dark:border-white/10",
      locked ? "opacity-80" : "",
    ].join(" ");
  }

  /* ------------------------------ render ------------------------------ */

  return (
    <div className="h-[100dvh] overflow-hidden text-[var(--foreground)]">
      <div className="mx-auto max-w-4xl p-4 sm:p-6 h-full flex flex-col">
        {/* App title */}
        {/* App title */}
        <div className="mb-3 flex justify-center">
          <h1 className="text-3xl font-extrabold tracking-tight leading-none">

            <span className="text-black dark:text-white">
              Pay
            </span>

            <span className="text-red-600">
              C
            </span>

            <span className="text-yellow-500">
              o
            </span>

            <span className="text-red-600">
              re
            </span>

          </h1>
        </div>

        {/* Top mini header */}
        <header className="mb-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs text-gray-600 dark:text-white/60 truncate">
                v{APP_VERSION} • Created by Phil Crompton
              </div>

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
        </header>

        {/* Announcement banner */}
<div className="overflow-hidden bg-blue-600/20 border border-blue-400/30 rounded-xl mb-4">
  <div className="whitespace-nowrap text-sm py-2 animate-marquee">
    Final testing stages — PayCore launching soon • Final testing stages — PayCore launching soon • Final testing stages — PayCore launching soon •
  </div>
</div>
        <div className="flex-1 min-h-0 overflow-y-auto pb-28">

        {/* -------------------- SHIFT TAB -------------------- */}
        {activeTab === "shift" && (
          <div className={card}>
            <div className="text-lg font-semibold mb-3">This shift</div>

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
                  className="mt-1 w-full text-xs px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 border border-white/10"
                >
                  Clear start / finish times
                </button>
              </div>

              {/* Flags */}
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
                    Start &amp; finish times must be removed when sick hours are entered
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="rounded-xl bg-gray-100 border border-gray-200 p-3 dark:bg-black/20 dark:border-white/10">
                <div className="text-sm text-gray-700 dark:text-white/70">Worked hours</div>
                <div className="text-xl font-bold text-gray-900 dark:text-white">{workedHours}</div>
              </div>

              <div className="rounded-xl bg-gray-100 border border-gray-200 p-3 dark:bg-black/20 dark:border-white/10">
                <div className="text-sm text-gray-700 dark:text-white/70">
                  Premiums today (Late / Night)
                </div>
                <div className="text-xl font-bold text-gray-900 dark:text-white">
                  {prem.lateHours} / {prem.nightHours}
                </div>
                <div className="text-xs text-gray-600 dark:text-white/50 mt-1">{premiumLabel}</div>
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
                  className="w-full rounded-xl bg-white/15 hover:bg-white/20 px-4 py-3 font-semibold border border-white/10"
                  onClick={cancelEdit}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                className="mt-4 w-full rounded-xl bg-white/15 hover:bg-white/20 px-4 py-3 font-semibold border border-white/10"
                onClick={saveDayToMonth}
                type="button"
              >
                Save day to month
              </button>
            )}
          </div>
        )}

        {/* -------------------- SHIFTS TAB -------------------- */}
        {activeTab === "shifts" && (
          <div className={card}>
            <div className="text-lg font-semibold mb-3">Daily shifts</div>

            {rows.length === 0 ? (
              <div className="text-sm text-gray-600 dark:text-white/60">No saved shifts yet.</div>
            ) : (
              <div className="space-y-3">
                {rows.map((r) => {
                  const b = computeRowBreakdown(r, settings, premiumWindows);
                  return (
                    <div key={r.id} className="rounded-xl bg-black/10 dark:bg-black/20 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-semibold">{r.date}</div>

                        <div className="flex items-center gap-3">
                          <div className="text-sm text-gray-700 dark:text-white/70">
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

                      {/* ✅ show numeric hours (matches Week/Month logic) */}
                      <div className="mt-2 grid grid-cols-2 gap-1 text-sm text-gray-700 dark:text-white/80">
                        <div>
                          Scheduled: <b>{r.scheduledHours ?? 0}</b>
                        </div>
                        <div>
                          Worked: <b>{b.worked}</b>
                        </div>
                        
                        <div>
                          Holiday hrs: <b>{b.hol}</b> <span className="text-xs opacity-70">({displayFlag(r.holidayFlag)})</span>
                        </div>
                        <div>
                          Unpaid hrs:{" "}
                          <b>{round2(b.unpaidFull + b.unpaidPart)}</b>{" "}
                          <span className="text-xs opacity-70">({displayFlag(r.unpaidFlag)})</span>
                        </div>

                        <div>
                          LIEU hrs: <b>{b.lieu}</b> <span className="text-xs opacity-70">({displayFlag(r.lieuFlag)})</span>
                        </div>
                        <div>
                          BH hrs: <b>{b.bankHol}</b> <span className="text-xs opacity-70">({displayFlag(r.bankHolFlag)})</span>
                        </div>

                        <div>
                          Double hrs: <b>{b.dbl}</b> <span className="text-xs opacity-70">({displayFlag(r.doubleFlag)})</span>
                        </div>
                        <div>
                          Sick hrs: <b>{r.sickHours ?? 0}</b>
                        </div>

                        <div>
                          Late prem: <b>{b.late}</b>
                        </div>
                        <div>
                          Night prem: <b>{b.night}</b>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* -------------------- WEEK TAB -------------------- */}
        {activeTab === "week" && (
          <div className={card}>
            <div className="text-lg font-semibold mb-2">Weekly summary</div>
            <div className="text-xs text-gray-600 dark:text-white/60 mb-3">
              Week start: {weekStartLabel(weekStartsOn)} (set in Settings)
            </div>

            {weeks.length === 0 ? (
              <div className="text-sm text-gray-600 dark:text-white/60">No shifts yet.</div>
            ) : (
              <div className="space-y-3">
                {weeks.slice(0, 8).map((w) => (
                  <div key={w.weekId} className="rounded-xl bg-black/10 dark:bg-black/20 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-semibold">{w.label}</div>
                      <div className="text-sm">
                        Total: <b>{fmtGBP(w.totalPay)}</b>
                      </div>
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-1 text-sm text-gray-700 dark:text-white/80">
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
        )}

        {/* -------------------- MONTH TAB -------------------- */}
        {activeTab === "month" && (
          <div className={card}>
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
                  onClick={() => requirePro(() => exportAllTimeCSV(settings, premiumWindows))}
                  title={!pro ? "Pro feature" : "Exports every shift you've ever saved (even across cleared months)"}
                >
                  Export ALL shifts {pro ? "" : "🔒"}
                </button>

                <button
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 font-semibold text-white"
                  onClick={() => requirePro(saveCurrentMonthSnapshot)}
                  type="button"
                  title={!pro ? "Unlock Pro to save months" : "Save this month"}
                >
                  Save Month {pro ? "" : "🔒"}
                </button>

                <button
                  className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 font-semibold text-white"
                  onClick={clearMonth}
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="text-lg font-semibold mb-2">Hours</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-sm">
              <div>
                Total Worked: <b>{month.worked}</b>
              </div>

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

              <div className="mt-3 text-base font-semibold">Total: {fmtGBP(month.totalPay)}</div>

              {/* Holiday balance */}
              <div className="pt-4 mt-4 border-t border-white/20">
                <div className="text-lg font-semibold mb-2">Holiday balance</div>

                {!holidayBal || !settings.holidayBalanceStartDateYMD ? (
                  <div className="text-sm text-gray-600 dark:text-white/60">
                    Set your starting balance + “balance as at” date in Settings to enable this.
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                      <div>
                        Starting balance: <b>{holidayBal.startingBalance}</b> hrs
                      </div>
                      <div>
                        Holiday taken: <b>{holidayBal.holidayTakenHours}</b> hrs
                      </div>
                      <div className="sm:col-span-2">
                        Remaining balance: <b>{holidayBal.remainingBalance}</b> hrs
                      </div>
                    </div>

                    <div className="mt-2 text-xs text-gray-600 dark:text-white/60">
                      Counting Holiday shifts from <b>{holidayBal.periodStart}</b> onwards (within the tax year).
                    </div>

                    <div className="mt-2 rounded-xl bg-yellow-100 text-yellow-900 px-3 py-2 text-xs">
                      Balance is only fully accurate if your starting balance is entered from the start of the current tax year.
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* -------------------- HISTORY TAB (PRO) -------------------- */}
        {activeTab === "history" && (
          <div className={card}>
            <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
              <div className="text-lg font-semibold">History</div>

              {pro && (
                <button
                  type="button"
                  onClick={refreshSavedMonths}
                  className="text-xs px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 border border-white/10"
                  title="Refresh saved months list"
                >
                  Refresh
                </button>
              )}
            </div>

            {!pro ? (
              <>
                <div className="rounded-xl bg-yellow-100 text-yellow-900 px-3 py-2 text-sm">
                  Pro feature — unlock Pro to save and view historical months.
                </div>

                <div className="mt-4 rounded-2xl bg-white/10 border border-white/10 p-4">
                  <div className="font-semibold mb-2">Unlock Pro</div>

                  <div className="flex flex-col sm:flex-row gap-2">
                    

                    <button
                      type="button"
                     onClick={() => {
                    window.location.href = "/api/stripe/checkout";
                    }}
                      className="rounded-xl bg-blue-600 hover:bg-blue-700 px-4 py-2 font-semibold text-white"
                    >
                      Unlock
                    </button>

                    <button
  type="button"
  onClick={handleRestorePro}
  className="rounded-xl bg-white/10 hover:bg-white/20 px-4 py-2 text-white"
>
  Restore Pro
</button>
                  </div>

                 
                </div>
              </>
            ) : savedMonths.length === 0 ? (
              <div className="text-sm text-gray-600 dark:text-white/60">No saved months yet.</div>
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
                      onClick={() => selectedSavedMonth && renameSavedMonth(selectedSavedMonth.id)}
                      className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 font-semibold text-white"
                    >
                      Rename
                    </button>

                    <button
                      type="button"
                      onClick={() => selectedSavedMonth && removeSavedMonth(selectedSavedMonth.id)}
                      className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 font-semibold text-white"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {selectedSavedMonth && (
                  <div className="mt-4 rounded-xl bg-black/10 dark:bg-black/20 p-3">
                    <div className="font-semibold mb-2">{selectedSavedMonth.label}</div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-1 text-sm text-gray-700 dark:text-white/80">
                      <div>
                        Worked: <b>{selectedSavedMonth.totals?.worked ?? 0}</b>
                      </div>
                      <div>
                        Qualifying: <b>{selectedSavedMonth.totals?.qualifying ?? 0}</b>
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
                        Total pay: <b>{fmtGBP(selectedSavedMonth.totals?.totalPay ?? 0)}</b>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
</div>
        {/* Bottom sticky nav (mobile tap-safe) */}
        <div className="fixed left-0 right-0 bottom-0 z-50 pointer-events-none">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 pb-[env(safe-area-inset-bottom)] pointer-events-none">
            <div className="rounded-2xl border border-gray-200 dark:border-white/10 bg-white/90 dark:bg-black/60 backdrop-blur p-2 shadow-lg pointer-events-auto">
              <div className="flex gap-2">
                <button
                  type="button"
                  className={tabButtonClass(activeTab === "shift")}
                  onClick={() => setActiveTab("shift")}
                >
                  Shift
                </button>

                <button
                  type="button"
                  className={tabButtonClass(activeTab === "shifts")}
                  onClick={() => setActiveTab("shifts")}
                >
                  Shifts
                </button>

                <button
                  type="button"
                  className={tabButtonClass(activeTab === "week")}
                  onClick={() => setActiveTab("week")}
                >
                  Week
                </button>

                <button
                  type="button"
                  className={tabButtonClass(activeTab === "month")}
                  onClick={() => setActiveTab("month")}
                >
                  Month
                </button>

                <button
                  type="button"
                  className={tabButtonClass(activeTab === "history", !pro)}
                  onClick={() => setActiveTab("history")}
                  title={!pro ? "Pro feature" : "History"}
                >
                  {pro ? "History" : "History 🔒"}
                </button>
              </div>
            </div>
          </div>
        </div>
        </div>
        </div>
        );
}