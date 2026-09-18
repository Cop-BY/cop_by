import { getAddress, isAddress, type Address } from "viem";

import { getBrebConfig } from "./config";
import { BrebError } from "./errors";
import { createId } from "./ids";
import { atomicToDecimal, parseCopAmount, usdToAtomic } from "./money";
import {
  computeFixedOutputQuote,
  getBelowMinimumReason,
} from "./quote-math";
import type { BrebStore } from "./store";
import type { BridgeClient } from "./bridge-client";
import type { CopmQuoter } from "./copm-quote";
import type { BrebFromToken, QuoteRow } from "./types";

const FX_CACHE_KEY = "usd_cop_sell";
const PLACEHOLDER_DEPOSIT = getAddress(
  "0x0000000000000000000000000000000000000001"
);

export type BrebQuoteResult = {
  cached: boolean;
  destinationCop: string | null;
  display: string;
  effectiveUsdCop: string;
  expiresAt: string;
  fees: QuoteRow["fees"];
  fromToken: BrebFromToken;
  netUsdcToBridge: string | null;
  quoteId: string;
  sellRate: string;
  sourceAmount: string | null;
  sourceAmountUsd: string | null;
  swapProvider: string | null;
};

export type QuoteDeps = {
  bridge: BridgeClient;
  copmQuoter: CopmQuoter;
  now?: () => Date;
  store: BrebStore;
};

function parseFromToken(value?: string | null): BrebFromToken {
  if (!value || value === "USDC") return "USDC";
  if (value === "COPm") return "COPm";
  throw new BrebError("invalid_from_token", "fromToken must be USDC or COPm", 400);
}

async function getSellRate(deps: QuoteDeps, now: Date) {
  const cached = await deps.store.getFxCache(FX_CACHE_KEY);
  if (cached && Date.parse(cached.expiresAt) > now.getTime()) {
    return { cached: true, sellRate: Number(cached.sellRate) };
  }

  const rate = await deps.bridge.getExchangeRate();
  const sellRate = Number(rate.sellRate);
  if (!Number.isFinite(sellRate) || sellRate <= 0) {
    throw new BrebError("bridge_rate_unavailable", "Bridge sell rate unavailable", 502);
  }

  const ttlHours = getBrebConfig().fxTtlHours;
  const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000).toISOString();
  await deps.store.setFxCache({
    cacheKey: FX_CACHE_KEY,
    expiresAt,
    fetchedAt: now.toISOString(),
    sellRate: String(sellRate),
  });
  return { cached: false, sellRate };
}

export async function getBrebQuote(
  deps: QuoteDeps,
  input: {
    destinationCop?: string | null;
    fromToken?: string | null;
    hostname?: string;
    integrationId: string;
    userAddress?: string;
  }
): Promise<BrebQuoteResult> {
  const config = getBrebConfig();
  const now = deps.now?.() ?? new Date();
  const fromToken = parseFromToken(input.fromToken);
  let destinationCop: number | null;
  try {
    destinationCop = parseCopAmount(input.destinationCop ?? null);
  } catch {
    throw new BrebError("invalid_destination_cop", "Invalid destinationCop", 400);
  }
  const { cached, sellRate } = await getSellRate(deps, now);
  const expiresAt = new Date(
    now.getTime() + config.fxTtlHours * 60 * 60 * 1000
  ).toISOString();

  if (destinationCop == null) {
    const quoteId = createId("q");
    const effectiveUsdCop = String(Math.round(sellRate));
    const row: QuoteRow = {
      createdAt: now.toISOString(),
      destinationCop: null,
      effectiveUsdCop,
      expiresAt,
      fees: [],
      fromToken,
      integrationId: input.integrationId,
      netUsdcToBridge: null,
      payload: { cached, sellRate },
      quoteId,
      sellRate: String(sellRate),
      sourceAmount: null,
      sourceAmountUsd: null,
      swapProvider: fromToken === "USDC" ? "none" : null,
    };
    await deps.store.saveQuote(row);
    return {
      cached,
      destinationCop: null,
      display: `1 USD = ${effectiveUsdCop} COP`,
      effectiveUsdCop,
      expiresAt,
      fees: [],
      fromToken,
      netUsdcToBridge: null,
      quoteId,
      sellRate: String(sellRate),
      sourceAmount: null,
      sourceAmountUsd: null,
      swapProvider: row.swapProvider,
    };
  }

  const computed = computeFixedOutputQuote({
    copbyFeeBps: config.copbyFeeBps,
    copbyFeeWallet: config.copbyFeeWallet,
    destinationCop,
    developerFeeBps: config.developerFeeBps,
    fxPaddingBps: config.fxPaddingBps,
    minCop: config.minCop,
    minUsdc: config.minUsdc,
    sellRateCopPerUsd: sellRate,
  });
  const minimumReason = getBelowMinimumReason({
    destinationCop,
    minCop: config.minCop,
    minUsdc: config.minUsdc,
    netUsdcUsd: Number(computed.netUsdcToBridge),
  });
  if (minimumReason) {
    throw new BrebError(
      "below_minimum",
      "Amount is below the BRE-B minimum",
      400,
      {
        minCop: config.minCop,
        minUsdc: config.minUsdc,
        reason: minimumReason,
      }
    );
  }

  let sourceAmount = usdToAtomic(computed.userPaysUsd).toString();
  let swapProvider: string | null = "none";
  let swapFeeUsd = 0;
  if (fromToken === "COPm") {
    if (input.userAddress && !isAddress(input.userAddress)) {
      throw new BrebError("invalid_user_address", "Invalid user address", 400);
    }
    const copm = await deps.copmQuoter.quote({
      copbyFeeAtomic: usdToAtomic(computed.copbyFeeUsd),
      depositAddress: PLACEHOLDER_DEPOSIT,
      feeWallet: config.copbyFeeWallet,
      netUsdcAtomic: computed.netUsdcAtomic,
      sellRateCopPerUsd: sellRate,
      userAddress: (input.userAddress && isAddress(input.userAddress)
        ? getAddress(input.userAddress)
        : PLACEHOLDER_DEPOSIT) as Address,
    });
    sourceAmount = copm.copmIn.toString();
    swapProvider = copm.provider;
    swapFeeUsd = copm.swapFeeUsd ?? 0;
  }

  const fees = swapFeeUsd
    ? [
        {
          amountUsd: swapFeeUsd.toFixed(2),
          code: "swap" as const,
          status: "quoted" as const,
          to: null,
        },
        ...computed.fees.filter((fee) => fee.code !== "swap"),
      ]
    : computed.fees;

  const quoteId = createId("q");
  const row: QuoteRow = {
    createdAt: now.toISOString(),
    destinationCop: String(destinationCop),
    effectiveUsdCop: computed.effectiveUsdCop,
    expiresAt,
    fees,
    fromToken,
    integrationId: input.integrationId,
    netUsdcToBridge: computed.netUsdcToBridge,
    payload: { cached, sellRate },
    quoteId,
    sellRate: String(sellRate),
    sourceAmount,
    sourceAmountUsd: computed.sourceAmountUsd,
    swapProvider,
  };
  await deps.store.saveQuote(row);

  return {
    cached,
    destinationCop: row.destinationCop,
    display: `1 USD = ${computed.effectiveUsdCop} COP`,
    effectiveUsdCop: computed.effectiveUsdCop,
    expiresAt,
    fees,
    fromToken,
    netUsdcToBridge: computed.netUsdcToBridge,
    quoteId,
    sellRate: String(sellRate),
    sourceAmount,
    sourceAmountUsd: computed.sourceAmountUsd,
    swapProvider,
  };
}

export function quoteSourceAmountDisplay(quote: BrebQuoteResult) {
  if (!quote.sourceAmount) return null;
  const decimals = quote.fromToken === "COPm" ? 18 : 6;
  return atomicToDecimal(BigInt(quote.sourceAmount), decimals);
}
