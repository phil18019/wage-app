import type { Settings } from "../settings";
import type { ShiftRow, MonthTotals } from "./month";
import { computeMonthTotals } from "./month";

export type WeekTotals = MonthTotals & {
  weekId: string; // e.g. "2026-02-16"
  label: string;  // e.g. "Week of 16 Feb 2026"
};

function toDateOnly(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseYMD(ymd: string) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function clampWeekStartsOn(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.min(6, Math.max(0, Math.floor(n)));
}

/**
 * Returns the week start date (YYYY-MM-DD) for a given date string.
 * weekStartsOn: 0=Sunday ... 6=Saturday
 */
export function weekIdFromDate(dateYMD: string, weekStartsOn: number) {
  const ws = clampWeekStartsOn(weekStartsOn);

  const d = parseYMD(dateYMD);
  const day = d.getDay(); // 0-6 (Sun-Sat)
  const diff = (day - ws + 7) % 7;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return toDateOnly(d);
}

export function weekLabelFromId(weekId: string) {
  const d = parseYMD(weekId);
  return `Week of ${d.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })}`;
}

/**
 * Groups shift rows into weeks, then runs the SAME calculation engine per week.
 * (It reuses computeMonthTotals so logic stays consistent.)
 */
export function computeWeeklyTotals(
  rows: ShiftRow[],
  settings: Settings,
  weekStartsOn: number
): WeekTotals[] {
  const map = new Map<string, ShiftRow[]>();

  for (const r of rows) {
    const id = weekIdFromDate(r.date, weekStartsOn);
    const arr = map.get(id) ?? [];
    arr.push(r);
    map.set(id, arr);
  }

  const weeks: WeekTotals[] = [];
  for (const [weekId, weekRows] of map.entries()) {
    const totals = computeMonthTotals(weekRows, settings);

    weeks.push({
      ...totals,
      weekId,
      label: weekLabelFromId(weekId),
    });
  }

  // newest week first
  weeks.sort((a, b) => parseYMD(b.weekId).getTime() - parseYMD(a.weekId).getTime());
  return weeks;
}