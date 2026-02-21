"use client";

import { useRouter } from "next/navigation";

export default function HelpPage() {
  const router = useRouter();

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
          <h1 className="text-2xl font-bold">Help</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            Enter your shifts on the Home screen. Premiums and overtime are calculated automatically.
          </p>

          <ul className="mt-4 list-disc pl-5 space-y-2 text-sm text-gray-700 dark:text-gray-200">
            <li>Use Settings to change pay rates and the overtime threshold.</li>
            <li>For full shifts sick, input date and scheduled hours only</li>
            <li>Export CSV to save your month totals.</li>
            <li>To calculate individual weeks, change qualifying for 160 to contractual weekly hours in the settings tab</li>
            <li>All data stays on your phone (local storage).</li>
          </ul>
        </div>

        <p className="mt-6 text-xs text-gray-500 dark:text-gray-400 text-center">
          This is an estimated wage calculation and should be used as a guide. Always refer to your official company payslip for final figures.
        </p>
      </div>
    </main>
  );
}