"use client";

import { useRouter } from "next/navigation";

export default function BackButton({ to }: { to: string }) {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => router.push(to)}
      className="text-sm px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 border border-white/10 mb-4"
    >
      ← Back
    </button>
  );
}