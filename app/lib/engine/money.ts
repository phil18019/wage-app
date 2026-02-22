export function fmtGBP(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return `£${v.toFixed(2)}`;
}