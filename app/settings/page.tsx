"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Settings = {
  baseRate: number;
  otThreshold: number;
  otPremiumAdd: number;
  latePremiumAdd: number;
  nightPremiumAdd: number;
  doubleRate: number;
  holidayRate: number;
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
  const [savedMsg, setSavedMsg] = useState("");

  useEffect(() => {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      try {
        setS({ ...DEFAULTS, ...JSON.parse(raw) });
      } catch {}
    }
  }, []);

  function save() {
    localStorage.setItem(KEY, JSON.stringify(s));
    setSavedMsg("Saved ✅");
    setTimeout(() => setSavedMsg(""), 1500);
  }

  function reset() {
    setS(DEFAULTS);
    localStorage.setItem(KEY, JSON.stringify(DEFAULTS));
    setSavedMsg("Reset to defaults");
    setTimeout(() => setSavedMsg(""), 1500);
  }

  function update<K extends keyof Settings>(key: K, value: number) {
    setS(prev => ({ ...prev, [key]: value }));
  }

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">

      {/* HEADER */}
      <div className="mb-6 flex items-center justify-between">

        <button
          onClick={() => router.push("/")}
          className="inline-flex items-center gap-2 rounded-lg
                     px-3 py-2 text-sm font-semibold
                     bg-gray-200 text-gray-900 hover:bg-gray-300
                     dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600"
        >
          ← Back
        </button>

        <div className="text-right">
          <h1 className="text-xl font-bold">Settings</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            Saved to this device
          </p>
        </div>
      </div>

      {/* CARD */}
      <div className="rounded-2xl border bg-white p-5 shadow-sm
                      dark:bg-gray-900 dark:border-gray-700 space-y-4">

        <Field label="Base hourly rate">
          <Input value={s.baseRate} onChange={v => update("baseRate", v)} />
        </Field>

        <Field label="Overtime qualifying hours">
          <Input value={s.otThreshold} onChange={v => update("otThreshold", v)} />
        </Field>

        <Field label="Overtime premium add-on">
          <Input value={s.otPremiumAdd} onChange={v => update("otPremiumAdd", v)} />
        </Field>

        <Field label="Late premium add-on">
          <Input value={s.latePremiumAdd} onChange={v => update("latePremiumAdd", v)} />
        </Field>

        <Field label="Night premium add-on">
          <Input value={s.nightPremiumAdd} onChange={v => update("nightPremiumAdd", v)} />
        </Field>

        <Field label="Double time rate">
          <Input value={s.doubleRate} onChange={v => update("doubleRate", v)} />
        </Field>

        <Field label="Holiday rate">
          <Input value={s.holidayRate} onChange={v => update("holidayRate", v)} />
        </Field>

        {/* ACTIONS */}
        <div className="flex gap-3 pt-4 flex-wrap">

          <button
            onClick={save}
            className="rounded-lg bg-blue-600 px-4 py-2 text-white font-semibold hover:bg-blue-700"
          >
            Save
          </button>

          <button
            onClick={reset}
            className="rounded-lg bg-gray-300 px-4 py-2 font-semibold hover:bg-gray-400
                       dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600"
          >
            Restore defaults
          </button>

          {savedMsg && (
            <span className="text-sm text-green-600 dark:text-green-400">
              {savedMsg}
            </span>
          )}
        </div>
      </div>
    </main>
  );
}

/* ---------------- UI helpers ---------------- */

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </div>
  );
}

function Input({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="number"
      value={value}
      onChange={e => onChange(Number(e.target.value))}
      className="w-28 rounded-lg border px-2 py-1 text-right
                 bg-white dark:bg-gray-800
                 dark:border-gray-600"
    />
  );
}