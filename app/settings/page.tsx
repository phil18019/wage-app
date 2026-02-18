"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const KEY = "wagecheck.settings.v1";

const DEFAULTS = {
  baseRate: 0,
  otAddRate: 0,
  nightAddRate: 0,
  lateAddRate: 0,
  holidayRate: 0,
  otThreshold: 160,
};

export default function SettingsPage() {
  const router = useRouter();

  const [rates, setRates] = useState(DEFAULTS);
  const [savedMsg, setSavedMsg] = useState("");

  // Load saved settings
  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return;

      const parsed = JSON.parse(raw);
      setRates({ ...DEFAULTS, ...parsed });
    } catch {}
  }, []);

  // Save settings
  const save = () => {
    localStorage.setItem(KEY, JSON.stringify(rates));
    setSavedMsg("Saved ✅");
    setTimeout(() => setSavedMsg(""), 1500);
  };

  // Reset settings
  const reset = () => {
    setRates(DEFAULTS);
    localStorage.setItem(KEY, JSON.stringify(DEFAULTS));
    setSavedMsg("Reset to defaults");
    setTimeout(() => setSavedMsg(""), 1500);
  };

  const handleChange = (field: string, value: string) => {
    setRates(prev => ({
      ...prev,
      [field]: Number(value),
    }));
  };

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">

      {/* Back button */}
      <button
        onClick={() => router.push("/")}
        className="mb-4 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold
                   bg-gray-200 text-gray-900 hover:bg-gray-300
                   dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600"
      >
        ← Back
      </button>

      <div className="rounded-2xl border bg-white p-5 shadow-sm dark:bg-gray-800 dark:border-gray-700">

        <div className="flex justify-between items-center mb-4">
          <h1 className="text-xl font-bold">Settings</h1>
          <span className="text-sm text-green-600">{savedMsg}</span>
        </div>

        <div className="grid gap-3">

          <Input label="Base rate (£)" value={rates.baseRate} onChange={v => handleChange("baseRate", v)} />
          <Input label="OT add-on (£)" value={rates.otAddRate} onChange={v => handleChange("otAddRate", v)} />
          <Input label="Night premium (£)" value={rates.nightAddRate} onChange={v => handleChange("nightAddRate", v)} />
          <Input label="Late premium (£)" value={rates.lateAddRate} onChange={v => handleChange("lateAddRate", v)} />
          <Input label="Holiday rate (£)" value={rates.holidayRate} onChange={v => handleChange("holidayRate", v)} />
          <Input label="OT qualifying hours" value={rates.otThreshold} onChange={v => handleChange("otThreshold", v)} />

        </div>

        <div className="flex gap-3 mt-5 flex-wrap">
          <button
            onClick={save}
            className="rounded-lg bg-green-600 px-4 py-2 font-semibold text-white hover:bg-green-700"
          >
            Save
          </button>

          <button
            onClick={reset}
            className="rounded-lg bg-gray-300 px-4 py-2 font-semibold text-gray-900 hover:bg-gray-400
                       dark:bg-gray-600 dark:text-white dark:hover:bg-gray-500"
          >
            Restore defaults
          </button>
        </div>

      </div>
    </main>
  );
}

function Input({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col text-sm">
      <span className="mb-1 text-gray-600 dark:text-gray-300">{label}</span>
      <input
        type="number"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="rounded-lg border px-3 py-2
                   bg-white text-gray-900
                   dark:bg-gray-700 dark:text-white dark:border-gray-600"
      />
    </label>
  );
}