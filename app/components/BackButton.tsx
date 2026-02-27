"use client";

import { useRouter } from "next/navigation";

export default function BackButton({ href = "/app" }: { href?: string }) {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => router.push(href)}
      className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm bg-white/10 hover:bg-white/15 border border-white/10"
      aria-label="Go back"
    >
      ← Back
    </button>
  );
}