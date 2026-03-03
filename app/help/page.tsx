"use client";

import { useRouter } from "next/navigation";

type Section = {
  title: string;
  bullets: string[];
};

const SECTIONS: Section[] = [
  {
    title: "Shift entry",
    bullets: [
      "Enter start and finish times to calculate worked hours automatically (overnight supported).",
      "Scheduled hours are used for leave calculations and protected premium scenarios.",
      "If sick hours are entered, remove start and finish times.",
    ],
  },
  {
    title: "Premium hours (Late & Night)",
    bullets: [
      "Premiums are calculated automatically using the time windows set in Settings.",
      "Holiday (Full) and Unpaid (Full) shifts do not generate premiums.",
      "LIEU/BH premium behaviour is controlled by the “Protect premiums” toggle in Settings.",
      "When protection is OFF, only physically worked hours generate premiums.",
    ],
  },
  {
    title: "Weekly overtime",
    bullets: [
      "Overtime is calculated per week and resets at the start of each new week.",
      "Qualifying hours include worked + Holiday + LIEU + Bank Holiday.",
      "The overtime threshold is taken from the pay rate effective at the start of that week.",
      "Overtime is only paid from physically worked hours (Double hours handled separately).",
      "For full shift overtime entries, leave scheduled hours blank",
    ],
  },
  {
    title: "Shifts tab",
    bullets: [
      "Displays a full numeric breakdown for each saved shift.",
      "Worked shows 0 for full-day leave and the hours are allocated to the correct leave type.",
      "Premiums follow the same rules as the Week and Month tabs for consistency.",
    ],
  },
  {
    title: "Monthly summary",
    bullets: [
      "Monthly totals are built from weekly calculations to keep overtime accurate.",
      "Shows a complete hours and pay breakdown using the correct historical rate for each shift.",
      "Export the current month or your full shift history to CSV at any time.",
    ],
  },
  {
    title: "Rate history",
    bullets: [
      "Store multiple pay rates with effective dates to handle pay rises automatically.",
      "Each shift uses the correct rate for its date.",
      "The overtime threshold is also taken from the active rate for that period.",
    ],
  },
  {
    title: "Holiday balance",
    bullets: [
      "Set your starting balance and ‘balance as at’ date in Settings.",
      "Holiday taken is tracked within the current tax year.",
      "For best accuracy, enter your balance from the start of the tax year.",
    ],
  },
  {
    title: "Data storage",
    bullets: [
      "All data is stored locally on your device.",
      "Clearing browser data or changing device will remove saved data unless exported.",
    ],
  },
];

export default function HelpPage() {
  const router = useRouter();

  return (
   <main className="min-h-[100dvh] bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100 p-4 sm:p-6">
      <div className="mx-auto max-w-3xl flex flex-col">

        <button
          onClick={() => router.push("/app")}
          className="mb-4 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold bg-gray-200 text-gray-900 hover:bg-gray-300 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600"
        >
          ← Back
        </button>

        <div className="rounded-2xl border bg-white p-5 shadow-sm dark:bg-gray-800 dark:border-white/20">
          <h1 className="text-2xl font-bold">Help</h1>

          <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
            Enter your shifts on the Home screen. Hours, premiums, overtime and pay are calculated automatically based on your settings.
          </p>

          <div className="mt-4 space-y-3">

            {SECTIONS.map((section) => (
              <details
                key={section.title}
                className="group rounded-xl border border-gray-200 bg-gray-50 dark:bg-white/5 dark:border-white/10"
              >
                <summary className="cursor-pointer list-none px-4 py-3 font-semibold flex justify-between items-center">
                  {section.title}
                  <span className="text-xs text-gray-500 group-open:hidden">
                    Tap to expand
                  </span>
                  <span className="text-xs text-gray-500 hidden group-open:inline">
                    Tap to collapse
                  </span>
                </summary>

                <ul className="px-4 pb-4 list-disc pl-5 space-y-2 text-sm text-gray-700 dark:text-gray-200">
                  {section.bullets.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              </details>
            ))}

          </div>
        </div>

        <p className="mt-6 text-xs text-gray-500 dark:text-gray-400 text-center">
          This is an estimated wage calculation and should be used as a guide.
          Always refer to your official company payslip for final figures.
        </p>
      </div>
    </main>
  );
}