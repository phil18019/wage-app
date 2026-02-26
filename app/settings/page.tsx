"use client";

import { useEffect, useMemo, useState } from "react";
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

export default function SettingsPage() {
  const router = useRouter();

  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  const [msg, setMsg] = useState("");

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

  const currentRate = useMemo(() => getRateForDate(todayYMD()), [s]); // re-eval if settings saved

  const save = () => {
    // 1) Save base settings (holiday + week start + existing rates array)
    saveSettings(s);

    // 2) Save/Upsert a rate change at the chosen effective date
    addOrUpdateRateChange(effectiveDate, {
      baseRate: num(rateDraft.baseRate),
      otAddOn: num(rateDraft.otAddOn),
      latePremium: num(rateDraft.latePremium),
      nightPremium: num(rateDraft.nightPremium),
      otThreshold: num(rateDraft.otThreshold),
      doubleRate: num(rateDraft.doubleRate),
    });

    // 3) Reload (so UI reflects normalization + sorting)
    const reloaded = getSettings();
    setS(reloaded);

    setMsg("Saved ✅");
    setTimeout(() => setMsg(""), 1200);
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
            <span className="text-sm text-green-700 dark:text-green-400">{msg}</span>
          </div>

          {/* Current rate (read-only helper) */}
          <div className="mb-5 rounded-xl border p-3 dark:border-white/20">
            <div className="text-sm font-semibold mb-1">Current rate (today)</div>
            <div className="text-xs text-gray-600 dark:text-white/60">
              Base £{currentRate.baseRate} • OT add-on £{currentRate.otAddOn} • Late £{currentRate.latePremium} • Night £{currentRate.nightPremium} • OT threshold {currentRate.otThreshold} • Double x{currentRate.doubleRate}
            </div>
          </div>

          <div className="grid gap-4">
            {/* Holiday rate stays manual (not in history) */}
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

            <div className="border-t pt-4 dark:border-white/20">
              <div className="text-sm font-semibold">Pay rate change</div>
              <p className="text-xs text-gray-600 dark:text-white/60 mt-1">
                Set the date the new rate becomes effective. Past shifts keep their old rate.
              </p>

              <div className="mt-3">
                <label className={labelClass}>Effective from</label>
                <input
                  className={inputClass}
                  type="date"
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
                    value={rateDraft.doubleRate}
                    onChange={(e) => setRateDraft((p) => ({ ...p, doubleRate: Number(e.target.value) }))}
                  />
                </div>
              </div>
            </div>

            {/* Rate history */}
            <div className="border-t pt-4 dark:border-white/20">
              <div className="text-sm font-semibold mb-2">Rate history</div>

              {s.rates.length === 0 ? (
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
                            Base £{r.baseRate} • OT+ £{r.otAddOn} • Late £{r.latePremium} • Night £{r.nightPremium} • Thr {r.otThreshold} • Double x{r.doubleRate}
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

              {s.rates.length <= 1 && (
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  You must keep at least one rate record.
                </p>
              )}
            </div>
          </div>

          <div className="mt-6 flex gap-3 flex-wrap">
            <button
              onClick={save}
              className="rounded-xl px-5 py-2 font-semibold bg-green-600 text-white hover:bg-green-700"
            >
              Save
            </button>

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
    </main>
  );
}