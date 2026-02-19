"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_SETTINGS,
  getSettings,
  restoreDefaultSettings,
  saveSettings,
  type Settings,
} from "../lib/settings";

export default function SettingsPage() {
  const router = useRouter();
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    setS(getSettings());
  }, []);

  const save = () => {
    saveSettings(s);
    setMsg("Saved ✅");
    setTimeout(() => setMsg(""), 1200);
  };

  const restore = () => {
    restoreDefaultSettings();
    setS(DEFAULT_SETTINGS);
    setMsg("Defaults restored");
    setTimeout(() => setMsg(""), 1200);
  };

  const inputClass =
    "mt-2 w-full rounded-xl border px-3 py-2 text-sm bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100 dark:border-white/20";

  const labelClass = "text-sm font-medium text-gray-700 dark:text-gray-200";

  return (
    <main className="min-h-screen bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100 p-4 sm:p-6">
      <div className="mx-auto max-w-3xl flex flex-col">
        <button
          onClick={() => router.push("/")}
          className="mb-4 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold bg-gray-200 text-gray-900 hover:bg-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600"
        >
          ← Back
        </button>

        <div className="rounded-2xl border bg-white p-5 shadow-sm dark:bg-gray-800 dark:border-white/20">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h1 className="text-2xl font-bold">Settings</h1>
            <span className="text-sm text-green-700 dark:text-green-400">{msg}</span>
          </div>

          <div className="grid gap-4">
            <div>
              <label className={labelClass}>Base rate (£)</label>
              <input
                className={inputClass}
                type="number"
                step="0.01"
                value={s.baseRate}
                onChange={(e) => setS((p) => ({ ...p, baseRate: Number(e.target.value) }))}
              />
            </div>

            <div>
              <label className={labelClass}>OT qualifying hours</label>
              <input
                className={inputClass}
                type="number"
                step="1"
                value={s.otThreshold}
                onChange={(e) => setS((p) => ({ ...p, otThreshold: Number(e.target.value) }))}
              />
            </div>

            <div>
              <label className={labelClass}>Overtime add-on (£)</label>
              <input
                className={inputClass}
                type="number"
                step="0.01"
                value={s.otPremiumAdd}
                onChange={(e) =>
                  setS((p) => ({ ...p, otPremiumAdd: Number(e.target.value) }))
                }
              />
            </div>

            <div>
              <label className={labelClass}>Late premium add-on (£)</label>
              <input
                className={inputClass}
                type="number"
                step="0.01"
                value={s.latePremiumAdd}
                onChange={(e) =>
                  setS((p) => ({ ...p, latePremiumAdd: Number(e.target.value) }))
                }
              />
            </div>

            <div>
              <label className={labelClass}>Night premium add-on (£)</label>
              <input
                className={inputClass}
                type="number"
                step="0.01"
                value={s.nightPremiumAdd}
                onChange={(e) =>
                  setS((p) => ({ ...p, nightPremiumAdd: Number(e.target.value) }))
                }
              />
            </div>

            <div>
              <label className={labelClass}>Double time rate (£)</label>
              <input
                className={inputClass}
                type="number"
                step="0.01"
                value={s.doubleRate}
                onChange={(e) => setS((p) => ({ ...p, doubleRate: Number(e.target.value) }))}
              />
            </div>

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
                Holiday rate can vary monthly — update when needed.
              </p>
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