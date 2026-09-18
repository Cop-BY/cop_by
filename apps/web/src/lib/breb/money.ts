export const USDC_DECIMALS = 6;
export const COPM_DECIMALS = 18;

export function parseCopAmount(value?: string | null) {
  if (value == null || value === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(value)) {
    throw new Error("Invalid destinationCop");
  }
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("Invalid destinationCop");
  }
  return amount;
}

export function usdToAtomic(usd: number, decimals = USDC_DECIMALS) {
  if (!Number.isFinite(usd) || usd < 0) {
    throw new Error("Invalid USD amount");
  }
  const factor = 10 ** decimals;
  return BigInt(Math.ceil(usd * factor - Number.EPSILON));
}

export function atomicToDecimal(amount: bigint, decimals: number, maxFrac = 6) {
  const negative = amount < 0n;
  const value = negative ? -amount : amount;
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const frac = value % base;
  const fracText = frac.toString().padStart(decimals, "0").slice(0, maxFrac);
  const trimmed = fracText.replace(/0+$/, "");
  const sign = negative ? "-" : "";
  return trimmed ? `${sign}${whole}.${trimmed}` : `${sign}${whole}`;
}

export function formatUsd(usd: number, digits = 2) {
  if (!Number.isFinite(usd)) return "0.00";
  return usd.toFixed(digits);
}

export function formatRate(copPerUsd: number) {
  if (!Number.isFinite(copPerUsd)) return "0";
  return Number.isInteger(copPerUsd)
    ? String(copPerUsd)
    : copPerUsd.toFixed(2).replace(/\.?0+$/, "");
}

export function applyBps(amount: bigint, bps: number) {
  return (amount * BigInt(bps)) / 10000n;
}

export function addBps(amount: bigint, bps: number) {
  return amount + applyBps(amount, bps);
}
