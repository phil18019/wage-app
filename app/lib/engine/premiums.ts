// app/lib/engine/premiums.ts
import type { Settings } from "../settings";

export type PremiumWindow = { start: string; end: string };
export type PremiumWindows = { late: PremiumWindow; night: PremiumWindow };

export type PremiumPreset = {
  id: string;
  label: string; // shown in Settings dropdown (times only)
  windows: PremiumWindows;
};

// ✅ Presets: labels are time windows only (no company names)
export const PREMIUM_PRESETS: PremiumPreset[] = [
  {
    id: "p1",
    label: "Late 14:00–22:00 • Night 22:00–06:00",
    windows: {
      late: { start: "14:00", end: "22:00" },
      night: { start: "22:00", end: "06:00" },
    },
  },
  {
    id: "p2",
    label: "Late 16:00–22:00 • Night 22:00–06:00",
    windows: {
      late: { start: "16:00", end: "22:00" },
      night: { start: "22:00", end: "06:00" },
    },
  },
  {
    id: "p3",
    label: "Late 18:00–00:00 • Night 00:00–06:00",
    windows: {
      late: { start: "18:00", end: "00:00" },
      night: { start: "00:00", end: "06:00" },
    },
  },
];

// helper: parse "HH:MM" -> minutes
function toMinutes(t: string) {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec((t || "").trim());
  if (!m) return NaN;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return NaN;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return NaN;
  return hh * 60 + mm;
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// Builds a set of segments for a window that may cross midnight
function windowSegments(startMin: number, endMin: number) {
  // if end <= start => crosses midnight
  if (endMin <= startMin) {
    return [
      { s: startMin, e: 24 * 60 }, // day part
      { s: 0, e: endMin }, // next day part
    ];
  }
  return [{ s: startMin, e: endMin }];
}

function overlap(sA: number, eA: number, sB: number, eB: number) {
  return Math.max(0, Math.min(eA, eB) - Math.max(sA, sB));
}

/**
 * Compute premium hours for a shift, based on configurable windows.
 * Handles shifts and windows that cross midnight.
 */
export function computePremiumHours(
  startTime: string,
  endTime: string,
  windows: PremiumWindows
) {
  const s0 = toMinutes(startTime);
  const e0 = toMinutes(endTime);
  if (!Number.isFinite(s0) || !Number.isFinite(e0)) {
    return { lateHours: 0, nightHours: 0 };
  }

  // shift minutes, allow cross midnight
  let s = s0;
  let e = e0;
  if (e <= s) e += 24 * 60;

  const ls = toMinutes(windows.late.start);
  const le = toMinutes(windows.late.end);
  const ns = toMinutes(windows.night.start);
  const ne = toMinutes(windows.night.end);

  if (![ls, le, ns, ne].every(Number.isFinite)) {
    return { lateHours: 0, nightHours: 0 };
  }

  const lateSegs = windowSegments(ls, le);
  const nightSegs = windowSegments(ns, ne);

  let lateMin = 0;
  let nightMin = 0;

  // Check previous day / same day / next day to catch midnight-crossing overlaps
  for (const dayOffset of [-1, 0, 1]) {
    const base = dayOffset * 24 * 60;

    for (const seg of lateSegs) {
      lateMin += overlap(s, e, base + seg.s, base + seg.e);
    }
    for (const seg of nightSegs) {
      nightMin += overlap(s, e, base + seg.s, base + seg.e);
    }
  }

  return {
    lateHours: round2(lateMin / 60),
    nightHours: round2(nightMin / 60),
  };
}

/**
 * Resolve windows from Settings (preset or custom).
 * Safe defaults if fields missing.
 */
export function getPremiumWindows(settings: Settings): PremiumWindows {
  const mode = (settings as any)?.premiumMode ?? "preset";
  const presetId = (settings as any)?.premiumPresetId ?? "p1";

  if (mode === "custom") {
    const c = (settings as any)?.premiumCustomWindows;
    const safe: PremiumWindows = {
      late: { start: c?.late?.start ?? "14:00", end: c?.late?.end ?? "22:00" },
      night: { start: c?.night?.start ?? "22:00", end: c?.night?.end ?? "06:00" },
    };
    return safe;
  }

  const preset = PREMIUM_PRESETS.find((p) => p.id === presetId) ?? PREMIUM_PRESETS[0];
  return preset.windows;
}