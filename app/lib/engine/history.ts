// app/lib/engine/history.ts
"use client";

/**
 * Saved Periods (history)
 * - Stores snapshots of calculated totals + the rows for that saved period
 * - Uses localStorage
 */

export type SavedMonth = {
  id: string;         // e.g. "2026-02-24_2026-03-22"
  label: string;      // e.g. "24 Feb - 22 Mar 26"
  createdAt: number;  // Date.now()

  // Optional metadata for display
  shiftCount: number;

  // Store the raw shifts as they were at the time
  rows: any[];

  // Store totals snapshot so the history never changes if you tweak settings later
  totals: any;
};

export const STORAGE_KEY_HISTORY = "wagecheck.history.v1";

export function listSavedMonths(): SavedMonth[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_HISTORY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SavedMonth[]) : [];
  } catch {
    return [];
  }
}

export function saveSavedMonths(all: SavedMonth[]) {
  localStorage.setItem(STORAGE_KEY_HISTORY, JSON.stringify(all));
}

export function upsertSavedMonth(entry: SavedMonth) {
  const all = listSavedMonths();
  const idx = all.findIndex((m) => m.id === entry.id);
  if (idx >= 0) all[idx] = entry;
  else all.unshift(entry);
  saveSavedMonths(all);
}

export function deleteSavedMonth(id: string) {
  const all = listSavedMonths().filter((m) => m.id !== id);
  saveSavedMonths(all);
}

export function clearAllSavedMonths() {
  localStorage.removeItem(STORAGE_KEY_HISTORY);
}

/** Helpers */

function formatShortDate(yyyyMmDd: string) {
  const [y, m, d] = yyyyMmDd.split("-");
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const idx = Math.max(1, Math.min(12, Number(m))) - 1;
  return `${Number(d)} ${monthNames[idx]} ${String(y).slice(-2)}`;
}

export function periodIdFromDates(startDate: string, endDate: string) {
  // e.g. "2026-02-24_2026-03-22"
  return `${startDate}_${endDate}`;
}

export function labelFromPeriodDates(startDate: string, endDate: string) {
  // e.g. "24 Feb 26 - 22 Mar 26"
  return `${formatShortDate(startDate)} - ${formatShortDate(endDate)}`;
}

export function getDateRangeFromRows(rows: any[]) {
  const validDates = rows
    .map((r) => r?.date)
    .filter((d): d is string => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();

  if (!validDates.length) {
    return { startDate: "", endDate: "" };
  }

  return {
    startDate: validDates[0],
    endDate: validDates[validDates.length - 1],
  };
}