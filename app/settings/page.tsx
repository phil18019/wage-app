"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Settings = {
  baseRate: number;
  otThreshold: number; // qualifying hours
  otPremiumAdd: number;
  latePremiumAdd: number;
  nightPremiumAdd: number;
  doubleRate: number;
  holidayRate: number;
};

const KEY = "wagecheck.settings.v1";

const DEFAULTS: Settings = {
  baseRate: 17.3,
  otThreshold: 160,
  otPremiumAdd: 0,
  latePremiumAdd: 0,
  nightPremiumAdd: 0,
  doubleRate: 0,
  holidayRate: 0,
};

function safeNumber(n: unknown, fallback: number) {
  const v = Number(n);
  return Number.isFinite(v) ? v : fallback;
}

export default function SettingsPage() {
  const router = useRouter();
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [savedMsg, setSavedMsg] = useState<string>("");

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw);

      // Accept either the full settings object or partial
      setS((prev) => ({
        ...prev,
        baseRate: safeNumber(parsed?.baseRate, prev.baseRate),
        otThreshold: safeNumber(parsed?.otThreshold, prev.otThreshold),
        otPremiumAdd: safeNumber(parsed?.otPremiumAdd, prev.otPremiumAdd),
        latePremiumAdd: safeNumber(parsed?.latePremiumAdd, prev.latePremiumAdd),
        nightPremiumAdd: safeNumber(parsed?.nightPremiumAdd, prev.nightPremiumAdd),
        doubleRate: safeNumber(parsed?.doubleRate, prev.doubleRate),
        holidayRate: safeNumber(parsed?.holidayRate, prev.holidayRate),
      }));
    } catch {
      // ignore bad data
    }
  }, []);

  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
      setSavedMsg("Saved");
      setTimeout(() => setSavedMsg(""), 1500);
    } catch {
      setSavedMsg("Could not save");
      setTimeout(() => setSavedMsg(""), 1500);
    }
  };

  const restoreDefaults = () => {
    try {
      setS(DEFAULTS);
      localStorage.setItem(KEY, JSON.stringify(DEFAULTS));
      setSavedMsg("Defaults restored");
      setTimeout(() => setSavedMsg(""), 1500);
    } catch {
      setSavedMsg("Could not restore");
      setTimeout(() => setSavedMsg(""), 1500);
    }
  };

  const inputClass =
    "mt-2 w-full rounded-xl border px-3 py-2 text-sm bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100 dark:border-white/20";

  const labelClass = "text-sm font-medium text-gray-700 dark:text-gray-200";

  return (
    <main className="min-h-screen bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100 p-4 sm:p-6">
      <div className="mx-auto max-w-3xl flex flex-col">
        {/* Back button */}
        <button
          onClick={() => router.push("/")}
          className="mb-4 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold bg-gray-200 text-gray-900 hover:bg-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600"
        >
          ← Back
        </button>

        <div className="rounded-2xl border bg-white p-5 shadow-sm dark:bg-gray-800 dark:border-white/20">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h1 className="text-2xl font-bold">Settings</h1>
            <span className="text-sm text-green-700 dark:text-green-400">
              {savedMsg}
            </span>
          </div>

          {/* Base rate */}
          <div className="mb-4">
            <label className={labelClass}>Base rate (£)</label>
            <input
              className={inputClass}
              type="number"
              step="0.01"
              value={s.baseRate}
              onChange={(e) =>
                setS((prev) => ({ ...prev, baseRate: Number(e.target.value) }))
              }
            />
          </div>

          {/* OT add-on */}
          <div className="mb-4">
            <label className={labelClass}>OT add-on (£)</label>
            <input
              className={inputClass}
              type="number"
              step="0.01"
              value={s.otPremiumAdd}
              onChange={(e) =>
                setS((prev) => ({
                  ...prev,
                  otPremiumAdd: Number(e.target.value),
                }))
              }
            />
          </div>

          {/* Night premium */}
          <div className="mb-4">
            <label className={labelClass}>Night premium (£)</label>
            <input
              className={inputClass}
              type="number"
              step="0.01"
              value={s.nightPremiumAdd}
              onChange={(e) =>
                setS((prev) => ({
                  ...prev,
                  nightPremiumAdd: Number(e.target.value),
                }))
              }
            />
          </div>

          {/* Late premium */}
          <div className="mb-4">
            <label className={labelClass}>Late premium (£)</label>
            <input
              className={inputClass}
              type="number"
              step="0.01"
              value={s.latePremiumAdd}
              onChange={(e) =>
                setS((prev) => ({
                  ...prev,
                  latePremiumAdd: Number(e.target.value),
                }))
              }
            />
          </div>

          {/* Holiday rate */}
          <div className="mb-4">
            <label className={labelClass}>Holiday rate (£)</label>
            <input
              className={inputClass}
              type="number"
              step="0.01"
              value={s.holidayRate}
              onChange={(e) =>
                setS((prev) => ({
                  ...prev,
                  holidayRate: Number(e.target.value),
                }))
              }
            />
          </div>

          {/* Qualifying hours */}
          <div className="mb-6">
            <label className={labelClass}>OT qualifying hours</label>
            <input
              className={inputClass}
              type="number"
              step="1"
              value={s.otThreshold}
              onChange={(e) =>
                setS((prev) => ({
                  ...prev,
                  otThreshold: Number(e.target.value),
                }))
              }
            />
          </div>

          <div className="flex gap-3">
            <button
              onClick={save}
              className="rounded-xl px-5 py-2 font-semibold bg-green-600 text-white hover:bg-green-700"
            >
              Save
            </button>

            <button
              onClick={restoreDefaults}
              className="rounded-xl px-5 py-2 font-semibold bg-gray-300 text-gray-900 hover:bg-gray-400 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600"
            >
              Restore defaults
            </button>
          </div>
        </div>

        <p className="mt-6 text-xs text-gray-500 dark:text-gray-400">
          Saved locally on this device only.
        </p>
      </div>
    </main>
  );
}