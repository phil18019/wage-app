export default function HelpPage() {
  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <h1 className="text-2xl font-bold">Help</h1>
        <p className="mt-2 text-sm text-gray-600">
          Quick guide to using WageCheck.
        </p>

        <div className="mt-6 space-y-6">
          <section>
            <h2 className="text-lg font-semibold">Getting started</h2>
            <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-gray-700">
              <li>Set your base hourly rate.</li>
              <li>Set your overtime qualifying hours (default 160, editable).</li>
              <li>If your holiday rate changes monthly, enter it when needed.</li>
            </ol>
          </section>

          <section>
            <h2 className="text-lg font-semibold">Adding shifts</h2>
            <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-gray-700">
              <li>Enter your scheduled hours / start time / finish time.</li>
              <li>Select absence types if applicable (holiday, sick, unpaid, lieu, etc.).</li>
              <li>Part-shift absences adjust worked hours automatically.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold">Understanding totals</h2>
            <ul className="mt-2 list-disc space-y-2 pl-5 text-sm text-gray-700">
              <li><span className="font-medium">Standard:</span> hours counted toward your standard total.</li>
              <li><span className="font-medium">Overtime:</span> hours above the qualifying threshold.</li>
              <li><span className="font-medium">Premiums:</span> late/night additions based on your times.</li>
              <li><span className="font-medium">Holiday:</span> paid at your entered holiday rate (if variable).</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-semibold">Saving & history</h2>
            <p className="mt-2 text-sm text-gray-700">
              Use <span className="font-medium">Save Month</span> to store a snapshot of totals on your phone. You
              can view past months later in <span className="font-medium">Saved Months</span>.
            </p>
          </section>

          <section className="rounded-xl bg-gray-50 p-4">
            <h2 className="text-base font-semibold">Important note</h2>
            <p className="mt-2 text-sm text-gray-700">
              WageCheck provides an estimate based on the information entered. Always compare with your official
              payslip and workplace policy.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}