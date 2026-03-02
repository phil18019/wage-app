"use client";
import { isProEnabled } from "../lib/pro";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_SETTINGS,
  getSettings,
  restoreDefaultSettings,
  saveSettings,
  type Settings,
  getRateForDate,
  addOrUpdateRateChange,
  deleteRateChange,
  type RateSnapshot,
} from "../lib/settings";
import { PREMIUM_PRESETS } from "../lib/engine/premiums";

const WEEKDAY_OPTIONS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

function todayYMD() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function num(x: any) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function clampNonNeg(n: number) {
  return Number.isFinite(n) ? Math.max(0, n) : 0;
}

function round2(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function rateForDateFromSettings(settings: Settings, date: string): RateSnapshot {
  const rates = Array.isArray(settings?.rates) ? settings.rates : [];
  if (!rates.length) return DEFAULT_SETTINGS.rates[0];

  const sorted = [...rates].sort((a, b) => (a.effectiveDate < b.effectiveDate ? -1 : 1));

  let best = sorted[0];
  for (const r of sorted) {
    if (r.effectiveDate <= date) best = r;
    else break;
  }
  return best;
}

function rateExactForDate(settings: Settings, date: string): RateSnapshot | null {
  const rates = Array.isArray(settings?.rates) ? settings.rates : [];
  const found = rates.find((r) => r.effectiveDate === date);
  return found ?? null;
}

export default function SettingsPage() {
  const router = useRouter();

  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  const [msg, setMsg] = useState("");

  // ✅ Pro state must be loaded AFTER mount (prevents hydration mismatch)
  const [pro, setPro] = useState(false);

  // ✅ One-time free pay-rate change flag (per device)
  const RATE_HISTORY_ONETIME_KEY = "paycore.rateHistory.oneTimeUsed.v1";
  const [oneTimeUsed, setOneTimeUsed] = useState(false);

  useEffect(() => {
    setPro(isProEnabled());

    // load one-time flag after mount
    try {
      setOneTimeUsed(localStorage.getItem(RATE_HISTORY_ONETIME_KEY) === "1");
    } catch {
      setOneTimeUsed(false);
    }
  }, []);

  // Prevent accidental double-taps on mobile
  const savingRef = useRef(false);

  // Pay-change editor
  const [effectiveDate, setEffectiveDate] = useState<string>(todayYMD());
  const [rateDraft, setRateDraft] = useState<Omit<RateSnapshot, "effectiveDate">>({
    baseRate: DEFAULT_SETTINGS.rates[0].baseRate,
    otAddOn: DEFAULT_SETTINGS.rates[0].otAddOn,
    latePremium: DEFAULT_SETTINGS.rates[0].latePremium,
    nightPremium: DEFAULT_SETTINGS.rates[0].nightPremium,
    otThreshold: DEFAULT_SETTINGS.rates[0].otThreshold,
    doubleRate: DEFAULT_SETTINGS.rates[0].doubleRate,
  });

  useEffect(() => {
    const loaded = getSettings();
    setS(loaded);

    // Prefill editor with "today's" current rate
    const cur = getRateForDate(todayYMD());
    setRateDraft({
      baseRate: cur.baseRate,
      otAddOn: cur.otAddOn,
      latePremium: cur.latePremium,
      nightPremium: cur.nightPremium,
      otThreshold: cur.otThreshold,
      doubleRate: cur.doubleRate,
    });
  }, []);

  const currentRate = useMemo(() => rateForDateFromSettings(s, todayYMD()), [s]);

  const requirePro = () => alert("Pro feature 🔒");

  // ✅ can edit pay rates if Pro OR one-time not used yet
  const canEditRates = pro || !oneTimeUsed;

  const save = () => {
    if (savingRef.current) return;
    savingRef.current = true;

    try {
      const nextDraft = {
        baseRate: round2(clampNonNeg(num(rateDraft.baseRate))),
        otAddOn: round2(clampNonNeg(num(rateDraft.otAddOn))),
        latePremium: round2(clampNonNeg(num(rateDraft.latePremium))),
        nightPremium: round2(clampNonNeg(num(rateDraft.nightPremium))),
        otThreshold: clampNonNeg(num(rateDraft.otThreshold)),
        doubleRate: round2(clampNonNeg(num(rateDraft.doubleRate))),
      };

      // Prefer comparing against exact entry for effectiveDate (if it exists)
      const exact = rateExactForDate(s, effectiveDate);
      const baseline = exact ?? rateForDateFromSettings(s, effectiveDate);

      const existingNorm = {
        baseRate: round2(clampNonNeg(num(baseline.baseRate))),
        otAddOn: round2(clampNonNeg(num(baseline.otAddOn))),
        latePremium: round2(clampNonNeg(num(baseline.latePremium))),
        nightPremium: round2(clampNonNeg(num(baseline.nightPremium))),
        otThreshold: clampNonNeg(num(baseline.otThreshold)),
        doubleRate: round2(clampNonNeg(num(baseline.doubleRate))),
      };

      const rateChanged =
        nextDraft.baseRate !== existingNorm.baseRate ||
        nextDraft.otAddOn !== existingNorm.otAddOn ||
        nextDraft.latePremium !== existingNorm.latePremium ||
        nextDraft.nightPremium !== existingNorm.nightPremium ||
        nextDraft.otThreshold !== existingNorm.otThreshold ||
        nextDraft.doubleRate !== existingNorm.doubleRate;

      // 1) Save base settings (always allowed)
      saveSettings({
        ...s,
        holidayRate: clampNonNeg(num(s.holidayRate)),
        holidayStartBalanceHours: clampNonNeg(num(s.holidayStartBalanceHours)),
        protectPremiumsForLieuBH: !!s.protectPremiumsForLieuBH,
      });

      // 2) Handle rate history save rules
      let didSaveRateHistory = false;

      if (rateChanged) {
        if (pro) {
          addOrUpdateRateChange(effectiveDate, nextDraft);
          didSaveRateHistory = true;
        } else {
          // free user: allow exactly one save
          if (!oneTimeUsed) {
            addOrUpdateRateChange(effectiveDate, nextDraft);
            didSaveRateHistory = true;

            try {
              localStorage.setItem(RATE_HISTORY_ONETIME_KEY, "1");
            } catch {
              // ignore
            }
            setOneTimeUsed(true);
          }
        }
      }

      // 3) Reload
      const reloaded = getSettings();
      setS(reloaded);

      // Messaging
      if (!rateChanged) {
        setMsg("Saved ✅ (no rate change)");
      } else if (didSaveRateHistory) {
        setMsg(pro ? "Saved ✅" : "Saved ✅ (one-time pay rate change used)");
      } else {
        setMsg("Saved ✅ (Pay rate changes are Pro 🔒)");
      }

      setTimeout(() => setMsg(""), 1400);
    } finally {
      setTimeout(() => {
        savingRef.current = false;
      }, 250);
    }
  };

  const restore = () => {
    restoreDefaultSettings();
    const reloaded = getSettings();
    setS(reloaded);

    const cur = getRateForDate(todayYMD());
    setEffectiveDate(todayYMD());
    setRateDraft({
      baseRate: cur.baseRate,
      otAddOn: cur.otAddOn,
      latePremium: cur.latePremium,
      nightPremium: cur.nightPremium,
      otThreshold: cur.otThreshold,
      doubleRate: cur.doubleRate,
    });

    setMsg("Defaults restored");
    setTimeout(() => setMsg(""), 1200);
  };

  const removeRate = (eff: string) => {
    if (!pro) return requirePro();

    const ok = confirm(
      `Delete rate change effective ${eff}?\n\nThis can affect pay totals for shifts on/after that date.`
    );
    if (!ok) return;

    deleteRateChange(eff);

    const reloaded = getSettings();
    setS(reloaded);

    setMsg("Rate deleted");
    setTimeout(() => setMsg(""), 1200);
  };

  const loadRateIntoEditor = (eff: string) => {
    if (!pro) return requirePro();

    const r = getRateForDate(eff);
    setEffectiveDate(eff);
    setRateDraft({
      baseRate: r.baseRate,
      otAddOn: r.otAddOn,
      latePremium: r.latePremium,
      nightPremium: r.nightPremium,
      otThreshold: r.otThreshold,
      doubleRate: r.doubleRate,
    });
    setMsg(`Loaded ${eff}`);
    setTimeout(() => setMsg(""), 1200);
  };

  const inputClass =
    "mt-2 w-full rounded-xl border px-3 py-2 text-sm bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100 dark:border-white/20";
  const labelClass = "text-sm font-medium text-gray-700 dark:text-gray-200";

  return (
    <main className="min-h-screen bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100 p-4 sm:p-6">
      <div className="mx-auto max-w-3xl flex flex-col">
        <button
          onClick={() => router.push("/app")}
          className="mb-4 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold bg-gray-200 text-gray-900 hover:bg-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600"
        >
          ← Back
        </button>

        <div className="rounded-2xl border bg-white p-5 shadow-sm dark:bg-gray-800 dark:border-white/20">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h1 className="text-2xl font-bold">Settings</h1>
          </div>

          {!pro && (
            <div className="mb-4 rounded-xl border border-yellow-300 bg-yellow-50 px-3 py-2 text-xs text-yellow-900 dark:border-yellow-500/40 dark:bg-yellow-500/10 dark:text-yellow-200">
              Some settings are Pro-only 🔒 (Rate history, Holiday balance tools, Custom premium windows, LIEU/BH premium protection toggle).
            </div>
          )}

          {/* ✅ one-time notice */}
          {!pro && !oneTimeUsed && (
            <div className="mb-4 rounded-xl border border-blue-300 bg-blue-50 px-3 py-2 text-xs text-blue-900 dark:border-blue-500/40 dark:bg-blue-500/10 dark:text-blue-200">
              You can make <b>one</b> pay rate change for free. After that, pay rate changes require Pro 🔒
            </div>
          )}

          {!pro && oneTimeUsed && (
            <div className="mb-4 rounded-xl border border-yellow-300 bg-yellow-50 px-3 py-2 text-xs text-yellow-900 dark:border-yellow-500/40 dark:bg-yellow-500/10 dark:text-yellow-200">
              Your free pay rate change has been used. Further pay rate changes require Pro 🔒
            </div>
          )}

          {/* Current rate (read-only helper) */}
          <div className="mb-5 rounded-xl border p-3 dark:border-white/20">
            <div className="text-sm font-semibold mb-1">Current rate (today)</div>
            <div className="text-xs text-gray-600 dark:text-white/60">
              Base £{currentRate.baseRate} • OT add-on £{currentRate.otAddOn} • Late £
              {currentRate.latePremium} • Night £{currentRate.nightPremium} • OT threshold{" "}
              {currentRate.otThreshold} • Double x{currentRate.doubleRate}
            </div>
          </div>

          <div className="grid gap-4">
            {/* Holiday rate */}
            <div>
              <label className={labelClass}>Holiday rate (£)</label>
              <input
                className={inputClass}
                type="number"
                step="0.01"
                value={s.holidayRate}
                onChange={(e) => setS((p) => ({ ...p, holidayRate: Number(e.target.value) }))}
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Holiday rate can vary — update when needed (not stored in history).
              </p>
            </div>

            {/* Week start */}
            <div>
              <label className={labelClass}>Week starts on</label>
              <select
                className={inputClass}
                value={s.weekStartsOn}
                onChange={(e) => setS((p) => ({ ...p, weekStartsOn: Number(e.target.value) }))}
              >
                {WEEKDAY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Holiday balance */}
            <div className="border-t pt-4 dark:border-white/20">
              <div className="text-sm font-semibold">
                Holiday balance {!pro && <span className="text-xs opacity-70"> (Pro 🔒)</span>}
              </div>
              <p className="text-xs text-gray-600 dark:text-white/60 mt-1">
                Enter your balance as at a date. The app will deduct any Holiday shifts after that date (and within the tax year).
              </p>

              <div className={!pro ? "opacity-60" : ""} onClick={!pro ? requirePro : undefined}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
                  <div>
                    <label className={labelClass}>Starting balance (hours)</label>
                    <input
                      className={inputClass}
                      type="number"
                      step="0.01"
                      disabled={!pro}
                      value={s.holidayStartBalanceHours ?? 0}
                      onChange={(e) =>
                        setS((p) => ({ ...p, holidayStartBalanceHours: Number(e.target.value) }))
                      }
                    />
                  </div>

                  <div>
                    <label className={labelClass}>Balance as at (date)</label>
                    <input
                      className={inputClass}
                      type="date"
                      disabled={!pro}
                      value={s.holidayBalanceStartDateYMD ?? ""}
                      onChange={(e) =>
                        setS((p) => ({ ...p, holidayBalanceStartDateYMD: e.target.value }))
                      }
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 mt-3">
                  <div>
                    <label className={labelClass}>Tax year starts (month)</label>
                    <input
                      className={inputClass}
                      type="number"
                      min={1}
                      max={12}
                      disabled={!pro}
                      value={s.holidayTaxYearStart?.month ?? 4}
                      onChange={(e) =>
                        setS((p) => ({
                          ...p,
                          holidayTaxYearStart: {
                            month: Number(e.target.value),
                            day: p.holidayTaxYearStart?.day ?? 6,
                          },
                        }))
                      }
                    />
                  </div>

                  <div>
                    <label className={labelClass}>Tax year starts (day)</label>
                    <input
                      className={inputClass}
                      type="number"
                      min={1}
                      max={31}
                      disabled={!pro}
                      value={s.holidayTaxYearStart?.day ?? 6}
                      onChange={(e) =>
                        setS((p) => ({
                          ...p,
                          holidayTaxYearStart: {
                            month: p.holidayTaxYearStart?.month ?? 4,
                            day: Number(e.target.value),
                          },
                        }))
                      }
                    />
                  </div>
                </div>
              </div>

              <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                Tip: For UK tax year use 06/04. Balance is most accurate if you start from the tax-year start date.
              </p>
            </div>

            {/* Premium windows */}
            <div className="border-t pt-4 dark:border-white/20">
              <div className="text-sm font-semibold">Premium windows</div>
              <p className="text-xs text-gray-600 dark:text-white/60 mt-1">
                Choose which time windows count as Late / Night.
              </p>

              {/* ✅ LIEU/BH protection toggle (Pro) */}
              <div
                className={`mt-3 rounded-xl border p-3 dark:border-white/20 ${!pro ? "opacity-60" : ""}`}
                onClick={!pro ? requirePro : undefined}
              >
                <label className="flex items-start gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4"
                    disabled={!pro}
                    checked={!!s.protectPremiumsForLieuBH}
                    onChange={(e) => setS((p) => ({ ...p, protectPremiumsForLieuBH: e.target.checked }))}
                  />
                  <span>
                    <div className="text-sm font-semibold">
                      Protect premiums for LIEU / BH {!pro && <span className="text-xs opacity-70">(Pro 🔒)</span>}
                    </div>
                    <div className="text-xs text-gray-600 dark:text-white/60">
                      If enabled, Late/Night is calculated across the scheduled window when a shift has LIEU or BH set.
                      If disabled, premiums only count when hours are physically worked.
                    </div>
                  </span>
                </label>
              </div>

              <div className="mt-3">
                <label className={labelClass}>Mode</label>
                <select
                  className={inputClass}
                  value={s.premiumMode}
                  onChange={(e) => {
                    const modeRaw = e.target.value;
                    if (!pro && modeRaw === "custom") {
                      requirePro();
                      return;
                    }

                    const mode = modeRaw === "custom" ? "custom" : "preset";
                    setS((p) => ({
                      ...p,
                      premiumMode: mode,
                      premiumCustomWindows:
                        mode === "custom"
                          ? p.premiumCustomWindows ?? {
                              late: { start: "14:00", end: "22:00" },
                              night: { start: "22:00", end: "06:00" },
                            }
                          : p.premiumCustomWindows,
                    }));
                  }}
                >
                  <option value="preset">Preset</option>
                  <option value="custom">Custom {!pro ? "🔒" : ""}</option>
                </select>
              </div>

              {s.premiumMode === "preset" && (
                <div className="mt-3">
                  <label className={labelClass}>Preset</label>
                  <select
                    className={inputClass}
                    value={s.premiumPresetId}
                    onChange={(e) => setS((p) => ({ ...p, premiumPresetId: e.target.value }))}
                  >
                    {PREMIUM_PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {s.premiumMode === "custom" && (
                <div className={!pro ? "opacity-60" : ""} onClick={!pro ? requirePro : undefined}>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
                    <div className="rounded-xl border p-3 dark:border-white/20">
                      <div className="text-sm font-semibold mb-2">
                        Late window {!pro && <span className="text-xs opacity-70">(Pro 🔒)</span>}
                      </div>

                      <label className={labelClass}>Start</label>
                      <input
                        className={inputClass}
                        type="time"
                        disabled={!pro}
                        value={s.premiumCustomWindows?.late.start ?? "14:00"}
                        onChange={(e) =>
                          setS((p) => ({
                            ...p,
                            premiumCustomWindows: {
                              ...(p.premiumCustomWindows ?? {
                                late: { start: "14:00", end: "22:00" },
                                night: { start: "22:00", end: "06:00" },
                              }),
                              late: {
                                ...(p.premiumCustomWindows?.late ?? { start: "14:00", end: "22:00" }),
                                start: e.target.value,
                              },
                            },
                          }))
                        }
                      />

                      <label className={`${labelClass} mt-3 block`}>End</label>
                      <input
                        className={inputClass}
                        type="time"
                        disabled={!pro}
                        value={s.premiumCustomWindows?.late.end ?? "22:00"}
                        onChange={(e) =>
                          setS((p) => ({
                            ...p,
                            premiumCustomWindows: {
                              ...(p.premiumCustomWindows ?? {
                                late: { start: "14:00", end: "22:00" },
                                night: { start: "22:00", end: "06:00" },
                              }),
                              late: {
                                ...(p.premiumCustomWindows?.late ?? { start: "14:00", end: "22:00" }),
                                end: e.target.value,
                              },
                            },
                          }))
                        }
                      />
                    </div>

                    <div className="rounded-xl border p-3 dark:border-white/20">
                      <div className="text-sm font-semibold mb-2">
                        Night window {!pro && <span className="text-xs opacity-70">(Pro 🔒)</span>}
                      </div>

                      <label className={labelClass}>Start</label>
                      <input
                        className={inputClass}
                        type="time"
                        disabled={!pro}
                        value={s.premiumCustomWindows?.night.start ?? "22:00"}
                        onChange={(e) =>
                          setS((p) => ({
                            ...p,
                            premiumCustomWindows: {
                              ...(p.premiumCustomWindows ?? {
                                late: { start: "14:00", end: "22:00" },
                                night: { start: "22:00", end: "06:00" },
                              }),
                              night: {
                                ...(p.premiumCustomWindows?.night ?? { start: "22:00", end: "06:00" }),
                                start: e.target.value,
                              },
                            },
                          }))
                        }
                      />

                      <label className={`${labelClass} mt-3 block`}>End</label>
                      <input
                        className={inputClass}
                        type="time"
                        disabled={!pro}
                        value={s.premiumCustomWindows?.night.end ?? "06:00"}
                        onChange={(e) =>
                          setS((p) => ({
                            ...p,
                            premiumCustomWindows: {
                              ...(p.premiumCustomWindows ?? {
                                late: { start: "14:00", end: "22:00" },
                                night: { start: "22:00", end: "06:00" },
                              }),
                              night: {
                                ...(p.premiumCustomWindows?.night ?? { start: "22:00", end: "06:00" }),
                                end: e.target.value,
                              },
                            },
                          }))
                        }
                      />
                    </div>

                    <p className="sm:col-span-2 text-xs text-gray-500 dark:text-gray-400">
                      Windows can cross midnight (e.g. 22:00 → 06:00).
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Pay rate change */}
            <div
              className={`border-t pt-4 dark:border-white/20 ${!canEditRates ? "opacity-60" : ""}`}
              onClick={!canEditRates ? requirePro : undefined}
            >
              <div className="text-sm font-semibold">
                Pay rate change {!canEditRates && <span className="text-xs opacity-70">(Pro 🔒)</span>}
              </div>
              <p className="text-xs text-gray-600 dark:text-white/60 mt-1">
                Set the date the new rate becomes effective. Past shifts keep their old rate.
              </p>

              <div className="mt-3">
                <label className={labelClass}>Effective from</label>
                <input
                  className={inputClass}
                  type="date"
                  disabled={!canEditRates}
                  value={effectiveDate}
                  onChange={(e) => setEffectiveDate(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
                <div>
                  <label className={labelClass}>Base rate (£)</label>
                  <input
                    className={inputClass}
                    type="number"
                    step="0.01"
                    disabled={!canEditRates}
                    value={rateDraft.baseRate}
                    onChange={(e) => setRateDraft((p) => ({ ...p, baseRate: Number(e.target.value) }))}
                  />
                </div>

                <div>
                  <label className={labelClass}>OT qualifying hours</label>
                  <input
                    className={inputClass}
                    type="number"
                    step="1"
                    disabled={!canEditRates}
                    value={rateDraft.otThreshold}
                    onChange={(e) => setRateDraft((p) => ({ ...p, otThreshold: Number(e.target.value) }))}
                  />
                </div>

                <div>
                  <label className={labelClass}>Overtime add-on (£)</label>
                  <input
                    className={inputClass}
                    type="number"
                    step="0.01"
                    disabled={!canEditRates}
                    value={rateDraft.otAddOn}
                    onChange={(e) => setRateDraft((p) => ({ ...p, otAddOn: Number(e.target.value) }))}
                  />
                </div>

                <div>
                  <label className={labelClass}>Late premium add-on (£)</label>
                  <input
                    className={inputClass}
                    type="number"
                    step="0.01"
                    disabled={!canEditRates}
                    value={rateDraft.latePremium}
                    onChange={(e) => setRateDraft((p) => ({ ...p, latePremium: Number(e.target.value) }))}
                  />
                </div>

                <div>
                  <label className={labelClass}>Night premium add-on (£)</label>
                  <input
                    className={inputClass}
                    type="number"
                    step="0.01"
                    disabled={!canEditRates}
                    value={rateDraft.nightPremium}
                    onChange={(e) => setRateDraft((p) => ({ ...p, nightPremium: Number(e.target.value) }))}
                  />
                </div>

                <div>
                  <label className={labelClass}>Double time multiplier (e.g. 2)</label>
                  <input
                    className={inputClass}
                    type="number"
                    step="0.01"
                    disabled={!canEditRates}
                    value={rateDraft.doubleRate}
                    onChange={(e) => setRateDraft((p) => ({ ...p, doubleRate: Number(e.target.value) }))}
                  />
                </div>
              </div>
            </div>

            {/* Rate history */}
            <div className="border-t pt-4 dark:border-white/20">
              <div className="text-sm font-semibold mb-2">
                Rate history {!pro && <span className="text-xs opacity-70">(Pro 🔒)</span>}
              </div>

              {!pro ? (
                <div
                  className="rounded-xl border p-3 text-xs text-gray-600 dark:text-white/60 dark:border-white/20"
                  onClick={requirePro}
                >
                  Rate history is a Pro feature 🔒
                </div>
              ) : s.rates.length === 0 ? (
                <div className="text-xs text-gray-600 dark:text-white/60">No rate history.</div>
              ) : (
                <div className="space-y-2">
                  {[...s.rates]
                    .slice()
                    .sort((a, b) => (a.effectiveDate < b.effectiveDate ? 1 : -1))
                    .map((r) => (
                      <div
                        key={r.effectiveDate}
                        className="rounded-xl border px-3 py-2 flex items-center justify-between gap-3 dark:border-white/20"
                      >
                        <div>
                          <div className="text-sm font-semibold">{r.effectiveDate}</div>
                          <div className="text-xs text-gray-600 dark:text-white/60">
                            Base £{r.baseRate} • OT+ £{r.otAddOn} • Late £{r.latePremium} • Night £
                            {r.nightPremium} • Thr {r.otThreshold} • Double x{r.doubleRate}
                          </div>
                        </div>

                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="text-xs px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white"
                            onClick={() => loadRateIntoEditor(r.effectiveDate)}
                          >
                            Edit
                          </button>

                          <button
                            type="button"
                            className="text-xs px-3 py-1 rounded-lg bg-red-600 hover:bg-red-700 text-white"
                            onClick={() => removeRate(r.effectiveDate)}
                            disabled={s.rates.length <= 1}
                            title={s.rates.length <= 1 ? "Must keep at least one rate" : "Delete rate"}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              )}

              {pro && s.rates.length <= 1 && (
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  You must keep at least one rate record.
                </p>
              )}
            </div>
          </div>

         <div className="mt-6 flex items-center gap-3 flex-wrap">
  <button
    onClick={save}
    className="rounded-xl px-5 py-2 font-semibold bg-green-600 text-white hover:bg-green-700"
  >
    Save
  </button>

  {msg && (
    <span className="text-sm text-green-700 dark:text-green-400 animate-fadeIn">
      {msg}
    </span>
  )}

  <button
    onClick={restore}
    className="rounded-xl px-5 py-2 font-semibold bg-gray-300 text-gray-900 hover:bg-gray-400 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600"
  >
    Restore defaults
  </button>
</div>
        </div>

        <p className="mt-6 text-xs text-gray-500 dark:text-gray-400 text-center">
          Saved locally on this device only.
        </p>
      </div>

      <div className="mt-8 border-t pt-4 text-xs text-center text-gray-500 dark:text-gray-400 space-y-2">
        <Link href="/privacy?from=settings" className="block hover:underline">
          Privacy Policy
        </Link>

        <Link href="/terms?from=settings" className="block hover:underline">
          Terms & Conditions
        </Link>
      </div>
    </main>
  );
}