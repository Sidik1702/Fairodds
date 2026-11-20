/** format.ts — display helpers for FairOdds values. */

export function fmtBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

export function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function fmtBrier(n: number): string {
  return n.toFixed(4);
}

export function fmtTime(unixSeconds: number): string {
  if (!unixSeconds) return "—";
  return new Date(unixSeconds * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export function shortAddr(address: string): string {
  return address.length <= 12 ? address : `${address.slice(0, 4)}…${address.slice(-4)}`;
}
