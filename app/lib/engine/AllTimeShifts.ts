"use client";

export type AllTimeShiftRow = {
  id: string;
  date: string; // YYYY-MM-DD
  scheduledHours: number;
  startTime: string;
  endTime: string;

  holidayFlag: "" | "Y" | "P";
  unpaidFlag: "" | "Y" | "P";
  lieuFlag: "" | "Y" | "P";
  bankHolFlag: "" | "Y" | "P";
  doubleFlag: "" | "Y" | "P";

  sickHours: number;

  createdAt?: number; // optional metadata
  updatedAt?: number; // optional metadata
};

export const STORAGE_KEY_ALLTIME = "wagecheck.alltime.v1";

export function listAllTimeShifts(): AllTimeShiftRow[] {
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
  localStorage.setItem(STORAGE_KEY_ALLTIME, JSON.stringify(all));
}

// Upsert by id (create or update)
export function upsertAllTimeShift(row: AllTimeShiftRow) {
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

export function deleteAllTimeShift(id: string) {
  const all = listAllTimeShifts().filter((r) => r.id !== id);
  saveAllTimeShifts(all);
}

export function clearAllTimeShifts() {
  localStorage.removeItem(STORAGE_KEY_ALLTIME);
}

export function sortAllTimeByDateAsc(rows: AllTimeShiftRow[]) {
  return [...rows].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    // tie-break stable by id
    return a.id < b.id ? -1 : 1;
  });
}