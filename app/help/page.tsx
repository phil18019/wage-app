"use client";

import { useRouter } from "next/navigation";

export default function HelpPage() {
  const router = useRouter();

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
        <h1 className="text-xl font-bold mb-2">Help</h1>

        <p className="text-sm text-gray-600 dark:text-gray-300">
          This app calculates your worked hours, overtime and pay automatically.
        </p>

        <ul className="mt-3 list-disc pl-5 text-sm text-gray-600 dark:text-gray-300 space-y-1">
          <li>Add your shift times on the Home screen</li>
          <li>Edit pay rates in Settings</li>
          <li>Export your monthly data to CSV</li>
        </ul>
      </div>

    </main>
  );
}