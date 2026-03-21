// app/components/AnalyticsUserId.tsx
"use client";

import { useEffect } from "react";
import { getOrCreateUserId } from "../lib/userId";

declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
  }
}

export default function AnalyticsUserId() {
  useEffect(() => {
    const userId = getOrCreateUserId();

    if (!userId) return;
    if (typeof window.gtag !== "function") return;

    window.gtag("config", "G-DN4FPV087M", {
      user_id: userId,
    });
  }, []);

  return null;
}