import Link from "next/link";

export default function Landing() {
  return (
    <main className="min-h-screen flex flex-col items-center px-6 pt-4 sm:pt-10 pb-12">
      {/* Main content */}
      <div className="w-full max-w-xl text-center">
        <img
          src="/icon-512.png"
          alt="PayCore"
          className="mx-auto h-44 w-44 sm:h-56 sm:w-56 rounded-3xl shadow-lg mb-6"
        />

<<<<<<< HEAD
          <img
            src="/icon-192.png"
            alt="Wage Check logo"
            className="h-30 w-30 sm:h-16 sm:w-16 rounded-2xl shadow-md"
          />
         
          <div>
            <h1 className="text-2xl font-bold">Wage Check</h1>
            <p className="text-xs text-gray-600 dark:text-white/60">
              v{APP_VERSION} . Created by Phil Crompton
            </p>
            <div className="mt-2 rounded-xl bg-blue-100 text-blue-900 px-3 py-2 text-xs font-semibold">
  Test site – under development
</div>
=======
        <p className="text-gray-600 dark:text-white/70 text-center max-w-md mx-auto mt-2 mb-6">
          Take control of your pay. Every hour. Every premium. Every time.
        </p>

        <div className="mt-8 grid gap-3 text-left text-sm">
          <div className="rounded-2xl bg-black/5 dark:bg-white/10 p-4">
            ✅ Weekly overtime that resets each week
          </div>
          <div className="rounded-2xl bg-black/5 dark:bg-white/10 p-4">
            ✅ Premium windows (Late / Night) built-in
          </div>
          <div className="rounded-2xl bg-black/5 dark:bg-white/10 p-4">
            ✅ Export shifts + totals anytime
          </div>
          <div className="rounded-2xl bg-black/5 dark:bg-white/10 p-4">
            ✅ Intelligent leave &amp; part-shift logic
>>>>>>> engine-isolation
          </div>
        </div>

        <Link
          href="/app"
          className="mt-8 inline-flex items-center justify-center w-full rounded-2xl bg-blue-600 hover:bg-blue-700 px-5 py-4 font-semibold text-white"
        >
          Enter App
        </Link>
      </div>

      {/* Footer */}
      <footer className="mt-10 flex flex-col items-center gap-2 text-xs text-gray-500 dark:text-white/60">
 <Link href="/privacy?from=landing" className="opacity-70 hover:opacity-100">
  Privacy Policy
</Link>

<Link href="/terms?from=landing" className="opacity-70 hover:opacity-100">
  Terms & Conditions
</Link>


        <div className="mt-2 text-[11px] opacity-70">
          ©️ {new Date().getFullYear()} PayCore
        </div>
      </footer>
    </main>
  );
}