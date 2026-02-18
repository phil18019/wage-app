"use client";

import { useRouter } from "next/navigation";

export default function HelpPage() {
  const router = useRouter();

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
          <h1 className="text-2xl font-bold">Help</h1>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            This app calculates your worked hours, overtime and pay automatically.
          </p>

          <div className="mt-6 space-y-6">
            <section>
              <h2 className="text-lg font-semibold">Getting started</h2>
              <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-gray-700 dark:text-gray-200">
                <li>Add your shift times on the Home screen.</li>
                <li>Enter part/full shifts accordingly</li>
                <li>Edit pay rates and qualifying hours in Settings.</li>
                <li>Export your monthly data to CSV.</li>
              </ul>
            </section>

            <section>
              <h2 className="text-lg font-semibold">Notes</h2>
              <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-gray-700 dark:text-gray-200">
                <li>All data is saved locally on your device (local storage).</li>
                <li>Changing Settings updates calculations automatically.</li>
              </ul>
            </section>
          </div>
        </div>

        <p className="mt-6 text-xs text-gray-500 dark:text-gray-400">
          This is an estimated wage calculation and should be used as a guide, your company payslip remains the official record of pay. 
        </p>
      </div>
    </main>
  );
}