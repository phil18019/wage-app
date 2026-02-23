// app/lib/engine/history.ts
"use client";

/**
 * Saved Months (history)
 * - Stores "month snapshots" of your calculated totals + the rows for that month
 * - Uses localStorage (same approach as your current month storage)
 */

export type SavedMonth = {
  id: string;         // e.g. "2026-02"
  label: string;      // e.g. "Feb 2026"
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
export function monthIdFromDate(yyyyMmDd: string) {
  // expects "YYYY-MM-DD"
  return yyyyMmDd.slice(0, 7); // "YYYY-MM"
}

export function labelFromMonthId(monthId: string) {
  // monthId "YYYY-MM"
  const [y, m] = monthId.split("-");
  const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const idx = Math.max(1, Math.min(12, Number(m))) - 1;
  return `${monthNames[idx]} ${y}`;
}