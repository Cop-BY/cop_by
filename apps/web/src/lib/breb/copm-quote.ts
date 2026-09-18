import { getAddress, isAddress, type Address } from "viem";

import {
  getSquidCopmRoute,
  getSquidServiceFeeUsd,
  SquidApiError,
} from "../squid-config";
import { getTargetNetwork } from "../network-config";

import { getBrebConfig, getBrebTokenAddresses, isBridgeMock } from "./config";
import { BrebError } from "./errors";
import { addBps, COPM_DECIMALS, usdToAtomic } from "./money";
import type { CopmQuoteResult } from "./types";
import { encodeUniswapV3CopmSwaps, getUniswapV3CopmQuote } from "./uniswap-v3-quote";

export type CopmQuoter = {
  quote(input: {
    copbyFeeAtomic?: bigint;
    depositAddress: Address;
    feeWallet?: Address;
    netUsdcAtomic: bigint;
    sellRateCopPerUsd: number;
    userAddress: Address;
  }): Promise<CopmQuoteResult>;
};

export function isNoRouteError(error: unknown) {
  if (error instanceof SquidApiError) {
    const message = error.message.toLowerCase();
    return (
      message.includes("no route") ||
      message.includes("low liquidity") ||
      message.includes("route unavailable") ||
      message.includes("insufficient liquidity")
    );
  }
  if (error instanceof BrebError) return error.code === "mercado_cerrado";
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes("no route") ||
      message.includes("low liquidity") ||
      message.includes("route unavailable") ||
      message.includes("insufficient liquidity")
    );
  }
  return false;
}

function mockCopmIn(usdcAtomic: bigint, sellRateCopPerUsd: number) {
  const copUnits = Number(usdcAtomic) * sellRateCopPerUsd;
  const copmAtomic = usdToAtomic(copUnits / 1e6, COPM_DECIMALS);
  return addBps(copmAtomic, getBrebConfig().swapSlippageBps);
}

export function createMockCopmQuoter(): CopmQuoter {
  return {
    async quote(input) {
      const config = getBrebConfig();
      const copmDeposit = mockCopmIn(input.netUsdcAtomic, input.sellRateCopPerUsd);
      const copmFee = input.copbyFeeAtomic
        ? mockCopmIn(input.copbyFeeAtomic, input.sellRateCopPerUsd)
        : 0n;
      return {
        approvalTarget: config.uniswapRouter,
        copmIn: copmDeposit + copmFee,
        provider: "mock",
        transaction: encodeUniswapV3CopmSwaps({
          copmInDeposit: copmDeposit,
          copmInFee: copmFee || undefined,
          depositAddress: input.depositAddress,
          fee: config.uniswapPoolFee || 3000,
          feeWallet: input.feeWallet,
          minUsdcDeposit: input.netUsdcAtomic,
          minUsdcFee: input.copbyFeeAtomic,
        }),
      };
    },
  };
}

async function quoteViaSquid(input: {
  copmIn: bigint;
  depositAddress: Address;
  netUsdcAtomic: bigint;
  userAddress: Address;
}): Promise<CopmQuoteResult | null> {
  const tokens = getBrebTokenAddresses();
  const network = getTargetNetwork();
  try {
    const route = await getSquidCopmRoute({
      fromAddress: input.userAddress,
      fromAmount: input.copmIn.toString(),
      fromChain: network.squidChainId,
      fromToken: tokens.copm,
      slippage: getBrebConfig().swapSlippageBps / 100,
      toAddress: input.depositAddress,
      toChain: network.squidChainId,
      toToken: tokens.usdc,
    });
    const minOut = BigInt(route.route?.estimate?.toAmountMin ?? "0");
    if (minOut < input.netUsdcAtomic) return null;
    const tx = route.route?.transactionRequest;
    if (!tx?.target || !isAddress(tx.target) || !tx.data) return null;
    return {
      approvalTarget: route.approvalTarget,
      copmIn: input.copmIn,
      provider: "squid",
      swapFeeUsd: getSquidServiceFeeUsd(route.route),
      transaction: {
        approvalTarget: route.approvalTarget,
        data: tx.data,
        to: getAddress(tx.target),
        value: "0",
      },
    };
  } catch (error) {
    if (isNoRouteError(error)) return null;
    throw error;
  }
}

export function createChainedCopmQuoter(options: {
  fallback: CopmQuoter;
  primary: CopmQuoter;
}): CopmQuoter {
  return {
    async quote(input) {
      try {
        return await options.primary.quote(input);
      } catch (error) {
        if (!isNoRouteError(error)) throw error;
        return options.fallback.quote(input);
      }
    },
  };
}

export function createDefaultCopmQuoter(): CopmQuoter {
  if (isBridgeMock()) return createMockCopmQuoter();

  return {
    async quote(input) {
      try {
        const uniswap = await getUniswapV3CopmQuote(input);
        const squid = await quoteViaSquid({
          copmIn: uniswap.copmIn,
          depositAddress: input.depositAddress,
          netUsdcAtomic: input.netUsdcAtomic,
          userAddress: input.userAddress,
        });
        return squid ?? uniswap;
      } catch (uniError) {
        if (!isNoRouteError(uniError) && !(uniError instanceof BrebError)) {
          throw uniError;
        }
        throw new BrebError("mercado_cerrado", "mercado de pesos cerrado", 503);
      }
    },
  };
}
