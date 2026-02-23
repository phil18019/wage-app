// app/lib/pro.ts

export const PRO_STORAGE_KEY = "wagecheck_pro_v1";

// Change this to your universal code when ready
export const PRO_CODE = "PRO-1234";

export function isProEnabled(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(PRO_STORAGE_KEY) === "1";
}

export function tryUnlockPro(code: string): { ok: true } | { ok: false; error: string } {
  const trimmed = (code ?? "").trim();

  if (!trimmed) return { ok: false, error: "Enter your code." };

  if (trimmed !== PRO_CODE) {
    return { ok: false, error: "Code not recognised." };
  }

  if (typeof window !== "undefined") {
    localStorage.setItem(PRO_STORAGE_KEY, "1");
  }

  return { ok: true };
}

export function lockPro(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(PRO_STORAGE_KEY);
}