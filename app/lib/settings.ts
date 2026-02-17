const KEY = "wagecheck.qualifyingHours.v1";
const DEFAULT = 160;

export function getQualifyingHours(): number {
  try {
    const raw = localStorage.getItem(KEY);
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export function setQualifyingHours(value: number) {
  try {
    localStorage.setItem(KEY, String(value));
  } catch {}
}