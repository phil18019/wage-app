const KEY = "wagecheck.settings.v1";

const DEFAULT_OT_THRESHOLD = 160;

export function getQualifyingHours(): number {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_OT_THRESHOLD;

    const parsed = JSON.parse(raw);

    const value = Number(parsed?.otThreshold);

    return Number.isFinite(value) && value > 0
      ? value
      : DEFAULT_OT_THRESHOLD;
  } catch {
    return DEFAULT_OT_THRESHOLD;
  }
}