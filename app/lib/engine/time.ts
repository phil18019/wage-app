function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// accepts "HH:MM" (or "HH:MM:SS") and returns minutes from midnight
function toMinutes(t: string): number {
  const [hh, mm] = t.split(":").map(Number);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return NaN;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return NaN;
  return hh * 60 + mm;
}

export function computeWorkedHours(startTime: string, endTime: string) {
  const s = toMinutes(startTime);
  const e0 = toMinutes(endTime);
  if (!Number.isFinite(s) || !Number.isFinite(e0)) return 0;

  let e = e0;
  // overnight support
  if (e <= s) e += 24 * 60;

  const minutes = Math.max(0, e - s);
  return round2(minutes / 60);
}