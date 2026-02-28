"use client";

import { useSearchParams, useRouter } from "next/navigation";

export default function BackButton() {
  const router = useRouter();
  const params = useSearchParams();

  const from = params.get("from");

  const target =
    from === "landing"
      ? "/"
      : from === "settings"
      ? "/settings"
      : "/app";

  return (
    <button
      onClick={() => router.push(target)}
      className="text-sm px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 border border-white/10 mb-4"
    >
      ← Back
    </button>
  );
}