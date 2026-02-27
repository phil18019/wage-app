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

        <div className="perspective">
         
        </div>

        <p className="text-gray-600 text-center max-w-md mt-2 mb-6">
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
          </div>
        </div>

        <Link
          href="/app"
          className="mt-8 inline-flex items-center justify-center w-full rounded-2xl bg-blue-600 hover:bg-blue-700 px-5 py-4 font-semibold text-white"
        >
          Enter App
        </Link>
      </div>

      {/* Footer link (now forced underneath) */}
      <div className="mt-10 text-center">
        <Link href="/privacy" className="text-xs opacity-70 hover:opacity-100">
          Privacy Policy
        </Link>
      </div>
    </main>
  );
}