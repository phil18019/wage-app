"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Settings = {
  baseRate: number;        // e.g. 17.3
  otThreshold: number;     // e.g. 160
  otPremiumAdd: number;    // e.g. 6.7 (added on top of base)
  latePremiumAdd: number;  // e.g. 2.26
  nightPremiumAdd: number; // e.g. 3.45
  doubleRate: number;      // e.g. 34.6
  holidayRate: number;     // variable, user enters
};

const DEFAULTS: Settings = {
  baseRate: 17.3,
  otThreshold: 160,
  otPremiumAdd: 6.7,
  latePremiumAdd: 2.26,
  nightPremiumAdd: 3.45,
  doubleRate: 34.6,
  holidayRate: 0,
};

const KEY = "wagecheck.settings.v1";

export default function SettingsPage() {
  const router = useRouter();
  const [s, setS] = useState<Settings>(DEFAULTS);
  const [savedMsg, setSavedMsg] = useState<string>("");

  useEffect(() => {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      try {
        setS({ ...DEFAULTS, ...JSON.parse(raw) });
      } catch {
        // ignore bad data
      }
    }
  }, []);

  const setNum = (k: keyof Settings) => (v: string) => {
    const n = v === "" ? 0 : Number(v);
    setS((prev) => ({ ...prev, [k]: Number.isFinite(n) ? n : prev[k] }));
  };

  const save = () => {
    localStorage.setItem(KEY, JSON.stringify(s));
    console.log("SAVED SETTINGS:", localStorage.getItem(KEY));
    setSavedMsg("Saved ✓");
    setTimeout(() => setSavedMsg(""), 1500);
  };

  const reset = () => {
    setS(DEFAULTS);
    localStorage.setItem(KEY, JSON.stringify(DEFAULTS));
    setSavedMsg("Reset ✓");
    setTimeout(() => setSavedMsg(""), 1500);
  };

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <button
            onClick={() => router.push("/")}
            className="text-sm px-3 py-1 border rounded"
          >
            ← Back
          </button>

          <div className="text-right">
            <h1 className="text-xl font-bold">Settings</h1>
            <p className="text-xs text-gray-500">Saved to this device</p>
          </div>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Field label="Base rate (£/hr)" value={s.baseRate} onChange={setNum("baseRate")} />
          <Field label="OT qualifies after (hours)" value={s.otThreshold} onChange={setNum("otThreshold")} />
          <Field label="OT add-on (£/hr)" value={s.otPremiumAdd} onChange={setNum("otPremiumAdd")} />
          <Field label="Late premium add (£/hr)" value={s.latePremiumAdd} onChange={setNum("latePremiumAdd")} />
          <Field label="Night premium add (£/hr)" value={s.nightPremiumAdd} onChange={setNum("nightPremiumAdd")} />
          <Field label="Double rate (£/hr)" value={s.doubleRate} onChange={setNum("doubleRate")} />
          <Field label="Holiday rate (£/hr) (variable)" value={s.holidayRate} onChange={setNum("holidayRate")} />
        </div>

        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={save}
            className="rounded-lg bg-[#0B2A6F] text-white px-4 py-2 text-sm font-medium"
          >
            Save
          </button>

          <button
            onClick={reset}
            className="rounded-lg border px-4 py-2 text-sm"
          >
            Reset defaults
          </button>

          {savedMsg && <span className="text-sm text-green-700">{savedMsg}</span>}
        </div>

        <div className="mt-6 rounded-xl bg-gray-50 p-4 text-sm text-gray-700">
          <p className="font-semibold mb-1">Notes</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Overtime rate is calculated as: base rate + OT add-on.</li>
            <li>Late/Night premiums are add-ons paid in addition to base.</li>
            <li>Holiday rate can change monthly — update it when needed.</li>
          </ul>
        </div>
      </div>
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-gray-700">{label}</span>
      <input
        inputMode="decimal"
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
      />
    </label>
  );
}