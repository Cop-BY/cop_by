import { formatRate, formatUsd, usdToAtomic } from "./money";

export type QuoteFeeLeg = {
  amountUsd: string;
  code: "swap" | "bridge_fx" | "bridge" | "copby";
  status: "quoted" | "verified" | "pending";
  to: string | null;
};

export type QuoteComputation = {
  copbyFeeUsd: number;
  developerFeeUsd: number;
  destinationCop: number;
  effectiveUsdCop: string;
  fees: QuoteFeeLeg[];
  fxPaddingUsd: number;
  netUsdcAtomic: bigint;
  netUsdcToBridge: string;
  sellRate: number;
  sourceAmountUsd: string;
  userPaysUsd: number;
};

export type QuoteMathInput = {
  copbyFeeBps: number;
  copbyFeeWallet?: string | null;
  destinationCop: number;
  developerFeeBps: number;
  fxPaddingBps: number;
  minCop: number;
  minUsdc: number;
  sellRateCopPerUsd: number;
  swapFeeUsd?: number;
};

export function computeFixedOutputQuote(input: QuoteMathInput): QuoteComputation {
  const { destinationCop, sellRateCopPerUsd } = input;
  if (sellRateCopPerUsd <= 0) {
    throw new Error("Invalid sell rate");
  }

  const usdForDestination = destinationCop / sellRateCopPerUsd;
  const paddedUsd = usdForDestination * (1 + input.fxPaddingBps / 10_000);
  const developerRate = 1 - input.developerFeeBps / 10_000;
  const netUsdcUsd = paddedUsd / developerRate;
  const copbyFeeUsd = netUsdcUsd * (input.copbyFeeBps / 10_000);
  const developerFeeUsd = netUsdcUsd * (input.developerFeeBps / 10_000);
  const fxPaddingUsd = usdForDestination * (input.fxPaddingBps / 10_000);
  const userPaysUsd = netUsdcUsd + copbyFeeUsd;
  const effectiveUsdCop = destinationCop / userPaysUsd;

  return {
    copbyFeeUsd,
    developerFeeUsd,
    destinationCop,
    effectiveUsdCop: formatRate(effectiveUsdCop),
    fees: [
      ...(input.swapFeeUsd
        ? [
            {
              amountUsd: formatUsd(input.swapFeeUsd),
              code: "swap" as const,
              status: "quoted" as const,
              to: null,
            },
          ]
        : []),
      {
        amountUsd: formatUsd(fxPaddingUsd),
        code: "bridge_fx",
        status: "quoted",
        to: null,
      },
      {
        amountUsd: formatUsd(developerFeeUsd),
        code: "bridge",
        status: "quoted",
        to: null,
      },
      {
        amountUsd: formatUsd(copbyFeeUsd),
        code: "copby",
        status: "quoted",
        to: input.copbyFeeWallet ?? null,
      },
    ],
    fxPaddingUsd,
    netUsdcAtomic: usdToAtomic(netUsdcUsd),
    netUsdcToBridge: formatUsd(netUsdcUsd, 6),
    sellRate: sellRateCopPerUsd,
    sourceAmountUsd: formatUsd(userPaysUsd, 6),
    userPaysUsd,
  };
}

export function getBelowMinimumReason(input: {
  destinationCop: number;
  minCop: number;
  minUsdc: number;
  netUsdcUsd: number;
}) {
  if (input.destinationCop < input.minCop) return "destination_cop";
  if (input.netUsdcUsd < input.minUsdc) return "net_usdc";
  return null;
}
