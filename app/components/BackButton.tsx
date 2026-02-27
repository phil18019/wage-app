"use client";

import { useRouter, useSearchParams } from "next/navigation";

export default function BackButton() {
  const router = useRouter();
  const sp = useSearchParams();

  const from = sp.get("from"); // "landing" | "settings" | null

  const href =
    from === "settings" ? "/settings" :
    from === "landing" ? "/" :
    "/app"; // fallback

  const label =
    from === "settings" ? "← Back to Settings" :
    from === "landing" ? "← Back to Home" :
    "← Back";

  return (
    <button
      type="button"
      onClick={() => router.push(href)}
      className="inline-flex items-center rounded-xl bg-black/5 dark:bg-white/10 px-3 py-2 text-sm font-semibold hover:opacity-90"
    >
      {label}
    </button>
  );
}