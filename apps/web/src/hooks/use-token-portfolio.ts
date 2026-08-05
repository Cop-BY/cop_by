"use client";

import { useMemo } from "react";
import { erc20Abi, formatUnits, type Address } from "viem";
import { useReadContracts } from "wagmi";

import { useWalletAdapter } from "@/hooks/use-wallet-adapter";
import type { SupportedTokenKey, TokenConfig } from "@/lib/network-config";
import {
  formatUsd,
  mockPortfolioTokens,
  type PortfolioToken,
  type TokenActivation,
} from "@/lib/mock-portfolio";

const TOKEN_COLORS: Record<SupportedTokenKey, string> = {
  copm: "#0E7C4F",
  usdc: "#2775CA",
  usdm: "#35D07F",
  usdt: "#26A17B",
  wbtc: "#F7931A",
  weth: "#627EEA",
};

const STABLE_SYMBOLS = new Set(["USDC", "USDm", "USDT", "COPm"]);

export type TokenUsdPrices = Partial<
  Record<"COP_PER_USD" | "COP_PER_USD_24H_CHANGE" | "ETH" | "WBTC", number>
>;

export type PortfolioTokenWithOnchain = PortfolioToken & {
  address?: Address;
  allowance?: bigint;
  allowanceDisplay?: string;
  balance?: bigint;
  balanceDisplay: string;
  decimals: number;
  enabled: boolean;
  isLive: boolean;
  requiresApproval: boolean;
};

export type TokenPortfolioState = {
  address?: Address;
  approvalTargets?: Partial<Record<string, Address>>;
  isAllowanceLoading: boolean;
  isBalanceLoading: boolean;
  isConnected: boolean;
  isCorrectNetwork: boolean;
  isLoading: boolean;
  refetchAllowances: () => Promise<unknown>;
  tokens: PortfolioTokenWithOnchain[];
  totalUsd: number;
};

function formatTokenAmount(value: bigint | undefined, token: TokenConfig) {
  if (value === undefined) return "0";

  const formatted = formatUnits(value, token.decimals);
  const numeric = Number(formatted);

  if (!Number.isFinite(numeric)) return formatted;
  if (numeric === 0) return "0";
  if (numeric < 0.0001) return "<0.0001";

  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: token.decimals > 8 ? 4 : 6,
  }).format(numeric);
}

function getTokenPrice(token: TokenConfig, prices: TokenUsdPrices) {
  if (STABLE_SYMBOLS.has(token.symbol)) return 1;
  return token.symbol === "ETH" || token.symbol === "WBTC"
    ? prices[token.symbol]
    : undefined;
}

function estimateUsdValue(
  value: bigint | undefined,
  token: TokenConfig,
  prices: TokenUsdPrices
) {
  if (value === undefined) return 0;
  const price = getTokenPrice(token, prices);
  if (!price) return 0;
  return Number(formatUnits(value, token.decimals)) * price;
}

function getActivation(
  token: TokenConfig,
  allowance: bigint | undefined,
  approvalTarget?: Address
): TokenActivation {
  if (!token.requiresApproval) return "active";
  if (!approvalTarget) return "ready";
  return allowance !== undefined && allowance > 0n ? "active" : "ready";
}

export function useTokenPortfolio(
  approvalTargets: Partial<Record<string, Address>> = {},
  prices: TokenUsdPrices = {}
): TokenPortfolioState {
  const { address, currentNetwork, isConnected, isCorrectNetwork } =
    useWalletAdapter();

  const configuredTokens = useMemo(
    () =>
      Object.values(currentNetwork?.tokens ?? {}).filter(
        (token) => token.enabled && token.key !== "copm" && token.address
      ),
    [currentNetwork]
  );

  const balanceContracts = configuredTokens.map((token) => ({
    address: token.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
  }));

  const allowanceContracts = configuredTokens
    .filter((token) => token.requiresApproval && approvalTargets[token.symbol])
    .map((token) => ({
      address: token.address,
      abi: erc20Abi,
      functionName: "allowance",
      args: [address, approvalTargets[token.symbol]],
    }));
  const allowanceSymbols = configuredTokens
    .filter((token) => token.requiresApproval && approvalTargets[token.symbol])
    .map((token) => token.symbol);

  const shouldRead = Boolean(
    isConnected && isCorrectNetwork && address && currentNetwork
  );

  const balances = useReadContracts({
    contracts: balanceContracts,
    query: {
      enabled: shouldRead && balanceContracts.length > 0,
    },
  });

  const allowances = useReadContracts({
    contracts: allowanceContracts,
    query: {
      enabled:
        shouldRead && allowanceContracts.length > 0,
    },
  });

  const liveTokens = useMemo(() => {
    if (!shouldRead) {
      return mockPortfolioTokens.map((token) => ({
        ...token,
        balanceDisplay: formatUsd(token.balanceUsd),
        decimals: 18,
        enabled: true,
        hasBalance: token.balanceUsd > 0,
        isLive: false,
        requiresApproval: token.activation !== "active",
      }));
    }

    return configuredTokens.map((token, index) => {
      const balance = balances.data?.[index]?.result as bigint | undefined;
      const allowanceDataIndex = allowanceSymbols.indexOf(token.symbol);
      const allowance =
        allowanceDataIndex >= 0
          ? (allowances.data?.[allowanceDataIndex]?.result as bigint | undefined)
          : undefined;
      const balanceUsd = estimateUsdValue(balance, token, prices);

      return {
        symbol: token.symbol,
        label: token.name,
        balanceUsd,
        activation: getActivation(
          token,
          allowance,
          approvalTargets[token.symbol]
        ),
        color: TOKEN_COLORS[token.key],
        address: token.address,
        allowance,
        allowanceDisplay:
          allowance !== undefined ? formatTokenAmount(allowance, token) : undefined,
        balance,
        balanceDisplay: `${formatTokenAmount(balance, token)} ${token.symbol}`,
        decimals: token.decimals,
        enabled: token.enabled,
        hasBalance: balance !== undefined && balance > 0n,
        isLive: true,
        requiresApproval: token.requiresApproval,
      };
    });
  }, [
    allowances.data,
    balances.data,
    configuredTokens,
    approvalTargets,
    allowanceSymbols,
    prices,
    shouldRead,
  ]);

  const totalUsd = useMemo(
    () => liveTokens.reduce((sum, token) => sum + token.balanceUsd, 0),
    [liveTokens]
  );

  return {
    address,
    approvalTargets,
    isAllowanceLoading: allowances.isLoading,
    isBalanceLoading: balances.isLoading,
    isConnected,
    isCorrectNetwork,
    isLoading: balances.isLoading || allowances.isLoading,
    refetchAllowances: allowances.refetch,
    tokens: liveTokens,
    totalUsd,
  };
}
