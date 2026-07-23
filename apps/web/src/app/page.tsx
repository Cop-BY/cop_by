"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  PointerEvent as ReactPointerEvent,
  TouchEvent as ReactTouchEvent,
} from "react";
import {
  erc20Abi,
  formatUnits,
  isAddress,
  parseEventLogs,
  parseUnits,
  type Address,
  type TransactionReceipt,
} from "viem";
import { usePublicClient, useSendTransaction, useWriteContract } from "wagmi";
import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Bookmark,
  Clock,
  Copy,
  GripVertical,
  Menu,
  ShieldCheck,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  hasSeenOnboarding,
  markOnboardingSeen,
  OnboardingScreen,
  OPEN_ONBOARDING_EVENT,
} from "@/components/onboarding-screen";
import {
  useTokenPortfolio,
  type TokenUsdPrices,
} from "@/hooks/use-token-portfolio";
import {
  formatUsd,
  mockPortfolioTokens,
  PortfolioToken,
  purchasePreview,
} from "@/lib/mock-portfolio";
import { getTargetNetwork } from "@/lib/network-config";
import {
  formatSquidErrorForSupport,
  getSquidCopmRoute,
  getSquidRoute,
  getSquidServiceFeeUsd,
  getSquidStatus,
  SquidApiError,
  SQUID_INTEGRATOR_FEE_BPS,
  SQUID_INTEGRATOR_FEE_SPLIT,
  type SquidRouteResult,
} from "@/lib/squid-config";
import {
  createSwapIntent,
  createCopmTransfer,
  logSwapOnchain,
  updateCopmTransfer,
  updateSwapIntent,
} from "@/lib/swap-logging";
import {
  formatPesoAmountFromBigInt,
  formatPesoAmountFromString,
} from "@/lib/format-peso";
import { createReceiptImageBlob, createReceiptPdfBlob, shareReceiptFile, shouldUseReceiptPdf } from "@/lib/receipt-share";
import {
  getWalletActionErrorCopy,
  type WalletActionFlow,
} from "@/lib/wallet-action-errors";
import { useWalletAdapter } from "@/hooks/use-wallet-adapter";
import {
  ShareableReceipt,
  type ShareableReceiptData,
} from "@/components/shareable-receipt";
import {
  fetchUserActivity,
  formatActivityDate,
  getActivityStatusLabel,
  getActivityStatusTone,
  type ActivityItem,
} from "@/lib/activity";
import {
  getSavedRecipients,
  getRecipientAlias,
  MAX_SAVED_RECIPIENTS,
  removeSavedRecipient,
  saveSavedRecipient,
  type SaveRecipientResult,
  type SavedRecipient,
} from "@/lib/saved-recipients";

const steps = ["Preparar", "Activar", "Convertir"];
const stepColors = ["#D9CCF7", "#A98BE5", "#6D45B8"];
const FALLBACK_COP_PER_USD = 3400;
const MIN_PURCHASE_USD = 1;
const MIN_SWAP_LEG_USD = 0.01;
const MAX_COPM_AMOUNT = 10_000_000;
const USD_PLAN_TOLERANCE = 0.001;
const TOKEN_ORDER_STORAGE_KEY = "cop_by_token_order";
const ACTION_MODE_STORAGE_KEY = "cop_by_action_mode";
const COPM_ICON_URL = "https://app.mento.org/tokens/COPm.svg";
const SQUID_CELO_APPROVAL_TARGET =
  "0xce16F69375520ab01377ce7B88f5BA8C48F8D666" as Address;

type SwapStatus = "idle" | "quoting" | "buying" | "complete" | "error";
type SwapProgress = "idle" | "quoting" | "confirming" | "processing";
type ActionMode = "buy" | "sell" | "transfer";
type HomePanel = "activity" | "details" | "chart" | null;
type RateChartInterval = "1h" | "1d" | "1w" | "1m" | "1y" | "5y" | "max";
type RateChartPair = "usd-cop" | "cop-usd";
type RateChartPoint = {
  timestamp: number;
  copPerUsd: number;
};
type SwapResult = {
  amountLabel?: string;
  completedAt?: string;
  copmBalance: string;
  receivedCopm: string;
  recipientAddress?: string;
  recipientAlias?: string;
  shortfallMessage?: string;
  title?: string;
  txHash: string;
  txUrl: string;
  variant?: "sell" | "swap" | "transfer";
};
type ShortfallQuote = {
  copAmount: string;
  quotedCopm: string;
  quotedUsd: number;
  message: string;
};
type TransferStatus = "idle" | "confirming" | "sending" | "complete" | "error";
type SellStatus =
  | "idle"
  | "quoting"
  | "approving"
  | "confirming"
  | "processing"
  | "complete"
  | "error";
type SwapPlanLeg = {
  token: PortfolioToken;
  usdAmount: number;
  fromAmount: bigint;
};

function getDefaultApprovalTargets(targetNetwork: ReturnType<typeof getTargetNetwork>) {
  if (targetNetwork.key !== "celo") return {};

  return Object.fromEntries(
    Object.values(targetNetwork.tokens)
      .filter((token) => token.requiresApproval)
      .map((token) => [token.symbol, SQUID_CELO_APPROVAL_TARGET])
  ) as Partial<Record<string, Address>>;
}

function createIntentId() {
  return crypto.randomUUID();
}

function getFriendlyErrorMessage(error: unknown, context: WalletActionFlow = "buy") {
  const copy = getWalletActionErrorCopy(error, context);
  if (copy.isNoLiquidity && error instanceof SquidApiError) {
    console.error("[COP By Squid debug]", formatSquidErrorForSupport(error));
  }
  return copy.message;
}

function formatAddressPreview(address: string) {
  if (address.length <= 14) return address;
  return `${address.slice(0, 7)}...${address.slice(-4)}`;
}

function getTokenPrice(token: PortfolioToken, prices: TokenUsdPrices) {
  if (["USDC", "USDT"].includes(token.symbol)) return 1;
  return token.symbol === "ETH" || token.symbol === "WBTC"
    ? prices[token.symbol]
    : undefined;
}

function floorToDecimals(value: number, decimals: number) {
  const factor = 10 ** Math.min(decimals, 8);
  return Math.floor(value * factor) / factor;
}

function toUnitsDecimal(value: number, decimals: number) {
  if (!Number.isFinite(value) || value <= 0) return "0";
  const places = Math.min(decimals, 18);
  return (
    floorToDecimals(value, decimals)
    .toFixed(places)
      .replace(/\.?0+$/, "") || "0"
  );
}

function getApprovalCap(token: PortfolioToken, prices: TokenUsdPrices) {
  if (!token.decimals) return;
  const price = getTokenPrice(token, prices);
  if (!price) return;
  const tokenAmount = purchasePreview.activationCapUsd / price;
  return parseUnits(toUnitsDecimal(tokenAmount, token.decimals), token.decimals);
}

function tokenHasBalance(token: PortfolioToken) {
  return token.hasBalance ?? token.balanceUsd > 0;
}

function parseCopAmount(value: string) {
  return Number(value.replace(/[^\d.]/g, "")) || 0;
}

function cleanCopInput(value: string) {
  return value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
}

function parseCopmUnits(value: string, decimals: number) {
  return parseUnits(toUnitsDecimal(parseCopAmount(value), decimals), decimals);
}

function formatCopmUnits(value: bigint, decimals: number) {
  return formatPesoAmountFromBigInt(value, decimals);
}

function formatCopPerUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value);
}

function formatRateChange(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(Math.abs(value));
}

function formatUsdPerCop(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 6,
    minimumFractionDigits: 6,
  }).format(value);
}

function getRouteToAmount(routeResult: SquidRouteResult) {
  const toAmount = routeResult.route?.estimate?.toAmount;
  if (!toAmount) return;

  try {
    return BigInt(toAmount);
  } catch {
    return;
  }
}

function getRouteFeeUsd(routeResult: SquidRouteResult) {
  return getSquidServiceFeeUsd(routeResult.route);
}

function getPurchaseUsdAmount(copAmount: string, copPerUsd: number) {
  return parseCopAmount(copAmount) / copPerUsd;
}

function sortTokensBySavedOrder(tokens: PortfolioToken[]) {
  if (typeof window === "undefined") return tokens;
  const saved = window.localStorage.getItem(TOKEN_ORDER_STORAGE_KEY);
  if (!saved) return tokens;
  const order = new Map(saved.split(",").map((symbol, index) => [symbol, index]));
  return [...tokens].sort(
    (a, b) =>
      (order.get(a.symbol) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(b.symbol) ?? Number.MAX_SAFE_INTEGER)
  );
}

function saveTokenOrder(tokens: PortfolioToken[]) {
  window.localStorage.setItem(
    TOKEN_ORDER_STORAGE_KEY,
    tokens.map((token) => token.symbol).join(",")
  );
}

function hasSavedTokenOrder() {
  if (typeof window === "undefined") return false;
  return Boolean(window.localStorage.getItem(TOKEN_ORDER_STORAGE_KEY));
}

function getTokenAmountForUsd(
  token: PortfolioToken,
  prices: TokenUsdPrices,
  usdAmount: number
) {
  if (!token.decimals) return;
  const price = getTokenPrice(token, prices);
  if (!price) return;

  return parseUnits(toUnitsDecimal(usdAmount / price, token.decimals), token.decimals);
}

function getTokenAllowanceUsd(token: PortfolioToken, prices: TokenUsdPrices) {
  if (!token.allowance || !token.decimals) return 0;
  const price = getTokenPrice(token, prices);
  if (!price) return 0;
  return Number(formatUnits(token.allowance, token.decimals)) * price;
}

function getTokenSpendableUsd(token: PortfolioToken, prices: TokenUsdPrices) {
  if (!token.isLive) return token.balanceUsd;
  if (token.activation !== "active") return 0;
  return Math.min(token.balanceUsd, getTokenAllowanceUsd(token, prices));
}

function getSwapSourceToken(
  tokens: PortfolioToken[],
  prices: TokenUsdPrices,
  usdAmount: number
) {
  return tokens.find((token) => {
    const fromAmount = getTokenAmountForUsd(token, prices, usdAmount);
    const isApproved =
      !token.isLive ||
      (token.activation === "active" &&
        token.allowance !== undefined &&
        fromAmount !== undefined &&
        token.allowance >= fromAmount);

    return (
      isApproved &&
      Boolean(token.address) &&
      Boolean(fromAmount) &&
      token.balanceUsd >= usdAmount &&
      (!token.balance || !fromAmount || token.balance >= fromAmount)
    );
  });
}

function getApprovedSwapPlan(
  tokens: PortfolioToken[],
  prices: TokenUsdPrices,
  usdAmount: number
): SwapPlanLeg[] {
  const sourceToken = getSwapSourceToken(tokens, prices, usdAmount);
  const singleFromAmount = sourceToken
    ? getTokenAmountForUsd(sourceToken, prices, usdAmount)
    : undefined;

  if (sourceToken && singleFromAmount) {
    return [{ token: sourceToken, usdAmount, fromAmount: singleFromAmount }];
  }

  const plan: SwapPlanLeg[] = [];
  let remainingUsd = usdAmount;

  for (const token of tokens) {
    const spendUsd = Math.min(getTokenSpendableUsd(token, prices), remainingUsd);
    const fromAmount = getTokenAmountForUsd(token, prices, spendUsd);
    if (
      spendUsd < MIN_SWAP_LEG_USD ||
      !fromAmount ||
      !token.address
    ) {
      continue;
    }

    plan.push({ token, usdAmount: spendUsd, fromAmount });
    remainingUsd -= spendUsd;
    if (remainingUsd <= USD_PLAN_TOLERANCE) return plan;
  }

  return plan;
}

function getSwapApprovalCandidate(
  tokens: PortfolioToken[],
  prices: TokenUsdPrices,
  usdAmount: number
) {
  let remainingUsd = usdAmount;

  for (const token of tokens) {
    const neededUsd = Math.min(token.balanceUsd, remainingUsd);
    const fromAmount = getTokenAmountForUsd(token, prices, neededUsd);
    const hasEnoughBalance =
      Boolean(token.address) &&
      Boolean(fromAmount) &&
      (!token.balance || !fromAmount || token.balance >= fromAmount);

    if (
      neededUsd >= MIN_SWAP_LEG_USD &&
      hasEnoughBalance &&
      getTokenSpendableUsd(token, prices) < neededUsd
    ) {
      return { token, usdAmount: neededUsd, fromAmount };
    }

    const spendableUsd = Math.min(getTokenSpendableUsd(token, prices), neededUsd);
    remainingUsd -= spendableUsd >= MIN_SWAP_LEG_USD ? spendableUsd : 0;
    if (remainingUsd <= USD_PLAN_TOLERANCE) return;
  }
}

function getSwapPlanTokenSymbols(plan: SwapPlanLeg[]) {
  return plan.map((leg) => leg.token.symbol).join(" + ");
}

function getSwapPlanUsd(plan: SwapPlanLeg[]) {
  return plan.reduce((sum, leg) => sum + leg.usdAmount, 0);
}

async function waitForSquidStatus(
  routeResult: SquidRouteResult,
  transactionId: string,
  chainId: string
) {
  if (!routeResult.requestId) return;

  const completedStatuses = new Set([
    "success",
    "partial_success",
  ]);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      const status = await getSquidStatus({
        transactionId,
        requestId: routeResult.requestId,
        fromChainId: chainId,
        toChainId: chainId,
        quoteId: routeResult.route?.quoteId,
      });

      if (
        status.squidTransactionStatus &&
        completedStatuses.has(status.squidTransactionStatus)
      ) {
        return status.squidTransactionStatus;
      }
    } catch {
      // keep polling briefly; Squid status can lag the receipt
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getTokenReceivedFromReceipts(
  receipts: TransactionReceipt[],
  tokenAddress: Address,
  userAddress: Address
) {
  const normalizedTokenAddress = tokenAddress.toLowerCase();
  const normalizedUserAddress = userAddress.toLowerCase();

  return receipts.reduce((total, receipt) => {
    const logs = parseEventLogs({
      abi: erc20Abi,
      eventName: "Transfer",
      logs: receipt.logs.filter(
        (log) => log.address.toLowerCase() === normalizedTokenAddress
      ),
    });

    return logs.reduce((sum, log) => {
      const to = log.args.to?.toLowerCase();
      return to === normalizedUserAddress ? sum + log.args.value : sum;
    }, total);
  }, 0n);
}

function getCopmReceivedFromReceipts(
  receipts: TransactionReceipt[],
  copmAddress: Address,
  userAddress: Address
) {
  return getTokenReceivedFromReceipts(receipts, copmAddress, userAddress);
}

export default function Home() {
  const targetNetwork = getTargetNetwork();
  const copmToken = targetNetwork.tokens.copm;
  const usdtToken = targetNetwork.tokens.usdt;
  const { isMiniPay } = useWalletAdapter();
  const approvalRouteKeyRef = useRef<string | null>(null);
  const [approvalTargets, setApprovalTargets] = useState<
    Partial<Record<string, Address>>
  >(() => getDefaultApprovalTargets(targetNetwork));
  const [routeError, setRouteError] = useState<string | null>(null);
  const [tokenPrices, setTokenPrices] = useState<TokenUsdPrices>({});
  const portfolio = useTokenPortfolio(approvalTargets, tokenPrices);
  const publicClient = usePublicClient();
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();
  const [step, setStep] = useState(2);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [actionMode, setActionMode] = useState<ActionMode>("buy");
  const [homePanel, setHomePanel] = useState<HomePanel>(null);
  const [tokens, setTokens] = useState(mockPortfolioTokens);
  const [copAmount, setCopAmount] = useState(purchasePreview.copAmount);
  const [recipientMode, setRecipientMode] = useState<"self" | "other">("self");
  const [recipientAddress, setRecipientAddress] = useState("");
  const [savedRecipients, setSavedRecipients] = useState<SavedRecipient[]>([]);
  const [transferAmount, setTransferAmount] = useState("");
  const [transferConfirming, setTransferConfirming] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferStatus, setTransferStatus] = useState<TransferStatus>("idle");
  const [sellAmount, setSellAmount] = useState("");
  const [sellError, setSellError] = useState<string | null>(null);
  const [sellRecipientMode, setSellRecipientMode] = useState<"self" | "other">("self");
  const [sellRecipientAddress, setSellRecipientAddress] = useState("");
  const [sellReceivedUsdt, setSellReceivedUsdt] = useState<string | null>(null);
  const [sellStatus, setSellStatus] = useState<SellStatus>("idle");
  const [sellTxHash, setSellTxHash] = useState<string | null>(null);
  const [copmBalance, setCopmBalance] = useState<bigint | undefined>();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [activating, setActivating] = useState<string | null>(null);
  const [swapStatus, setSwapStatus] = useState<SwapStatus>("idle");
  const [swapProgress, setSwapProgress] = useState<SwapProgress>("idle");
  const [swapError, setSwapError] = useState<string | null>(null);
  const [swapFeeUsd, setSwapFeeUsd] = useState<number | null>(null);
  const [swapResult, setSwapResult] = useState<SwapResult | null>(null);
  const [shortfallQuote, setShortfallQuote] = useState<ShortfallQuote | null>(
    null
  );
  const copPerUsd = tokenPrices.COP_PER_USD ?? FALLBACK_COP_PER_USD;

  const totalUsd = useMemo(
    () => tokens.reduce((sum, token) => sum + token.balanceUsd, 0),
    [tokens]
  );
  const isLivePortfolio = portfolio.isConnected && portfolio.isCorrectNetwork;
  const isLoadingPortfolio = isLivePortfolio && portfolio.isBalanceLoading;
  const effectiveTotalUsd = portfolio.isConnected ? portfolio.totalUsd : totalUsd;
  const hasCompatibleTokens = tokens.some(
    (token) => tokenHasBalance(token)
  );

  const pendingTokens = tokens.filter(
    (token) =>
      tokenHasBalance(token) &&
      token.activation !== "active" &&
      getApprovalCap(token, tokenPrices)
  );
  const allActive = pendingTokens.length === 0;

  const refreshCopmBalance = async () => {
    if (!publicClient || !portfolio.address || !copmToken.address) {
      setCopmBalance(undefined);
      return;
    }
    const balance = (await publicClient.readContract({
      address: copmToken.address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [portfolio.address],
    })) as bigint;
    setCopmBalance(balance);
  };

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [homePanel, step]);

  useEffect(() => {
    setShowOnboarding(!hasSeenOnboarding());

    const savedMode = window.sessionStorage.getItem(ACTION_MODE_STORAGE_KEY);
    if (savedMode === "buy" || savedMode === "sell" || savedMode === "transfer") {
      setActionMode(savedMode);
    }

    const openOnboarding = () => setShowOnboarding(true);
    window.addEventListener(OPEN_ONBOARDING_EVENT, openOnboarding);
    return () => window.removeEventListener(OPEN_ONBOARDING_EVENT, openOnboarding);
  }, []);

  useEffect(() => {
    setTokens((currentTokens) => sortTokensBySavedOrder(currentTokens));
  }, []);

  useEffect(() => {
    setSavedRecipients(getSavedRecipients());
  }, []);

  useEffect(() => {
    if (!isLivePortfolio || isLoadingPortfolio || !hasCompatibleTokens) return;

    if (allActive) {
      setStep(2);
      return;
    }

    if (hasSavedTokenOrder()) {
      setStep(1);
    }
  }, [allActive, hasCompatibleTokens, isLivePortfolio, isLoadingPortfolio]);

  const handleActionModeChange = (mode: ActionMode) => {
    setActionMode(mode);
    setHomePanel(null);
    window.sessionStorage.setItem(ACTION_MODE_STORAGE_KEY, mode);
    if (mode === "transfer") {
      setStep(2);
    }
  };

  const refreshSavedRecipients = () => {
    setSavedRecipients(getSavedRecipients());
  };

  const handleSaveRecipient = (address: string, alias: string) => {
    return saveSavedRecipient({ address, alias });
  };

  const handleRemoveRecipient = (address: string) => {
    removeSavedRecipient(address);
    refreshSavedRecipients();
  };

  useEffect(() => {
    void refreshCopmBalance();
  }, [portfolio.address, publicClient, copmToken.address]);

  useEffect(() => {
    fetch("/api/token-prices")
      .then((response) => (response.ok ? response.json() : undefined))
      .then((prices: TokenUsdPrices | undefined) => {
        if (prices) setTokenPrices(prices);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    setTokens((currentTokens) => {
      const nextBySymbol = new Map(
        portfolio.tokens.map((token) => [token.symbol, token])
      );
      const orderedTokens: PortfolioToken[] = [];

      currentTokens.forEach((token) => {
        const nextToken = nextBySymbol.get(token.symbol);
        if (nextToken) {
          orderedTokens.push(nextToken);
        }
      });

      const missingTokens = portfolio.tokens.filter(
        (token) =>
          !orderedTokens.some(
            (orderedToken) => orderedToken.symbol === token.symbol
          )
      );
      const nextTokens = sortTokensBySavedOrder([...orderedTokens, ...missingTokens]);

      if (
        nextTokens.length === currentTokens.length &&
        nextTokens.every(
          (token, index) =>
            token.symbol === currentTokens[index].symbol &&
            token.balanceDisplay === currentTokens[index].balanceDisplay &&
            token.balanceUsd === currentTokens[index].balanceUsd &&
            token.activation === currentTokens[index].activation &&
            token.allowanceDisplay === currentTokens[index].allowanceDisplay &&
            token.requiresApproval === currentTokens[index].requiresApproval
        )
      ) {
        return currentTokens;
      }

      return nextTokens;
    });
  }, [portfolio.tokens]);

  useEffect(() => {
    const sourceToken = tokens.find(
      (token) =>
        tokenHasBalance(token) &&
        token.address &&
        token.requiresApproval &&
        !approvalTargets[token.symbol] &&
        getApprovalCap(token, tokenPrices)
    );

    if (
      !isLivePortfolio ||
      isLoadingPortfolio ||
      !portfolio.address ||
      !copmToken.address ||
      !sourceToken?.address
    ) {
      return;
    }

    const sourceCap = getApprovalCap(sourceToken, tokenPrices);
    if (!sourceCap) return;
    const fromAmount =
      sourceToken.balance && sourceCap > sourceToken.balance
        ? sourceToken.balance
        : sourceCap;
    const routeKey = [
      portfolio.address,
      sourceToken.address,
      fromAmount.toString(),
      copmToken.address,
      targetNetwork.squidChainId,
    ].join(":");

    if (approvalRouteKeyRef.current === routeKey) return;

    let cancelled = false;
    approvalRouteKeyRef.current = routeKey;
    setRouteError(null);

    getSquidCopmRoute({
      fromAddress: portfolio.address,
      fromAmount: fromAmount.toString(),
      fromChain: targetNetwork.squidChainId,
      fromToken: sourceToken.address,
      toAddress: portfolio.address,
      toChain: targetNetwork.squidChainId,
      toToken: copmToken.address,
    })
      .then(({ approvalTarget: nextTarget }) => {
        if (cancelled) return;
        if (nextTarget) {
          setApprovalTargets((current) => ({
            ...current,
            [sourceToken.symbol]: nextTarget,
          }));
        }
        if (!nextTarget) setRouteError("Squid no devolvio approval target.");
      })
      .catch(() => {
        if (cancelled) return;
        approvalRouteKeyRef.current = null;
        setRouteError("No pudimos obtener una route de Squid.");
      });

    return () => {
      cancelled = true;
    };
  }, [
    copmToken.address,
    approvalTargets,
    isLivePortfolio,
    isLoadingPortfolio,
    portfolio.address,
    targetNetwork.squidChainId,
    tokenPrices,
    tokens,
  ]);

  const reorderToken = (fromIndex: number, toIndex: number) => {
    if (
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= tokens.length ||
      toIndex >= tokens.length
    ) {
      return;
    }

    const updated = [...tokens];
    const [item] = updated.splice(fromIndex, 1);
    updated.splice(toIndex, 0, item);
    setTokens(updated);
    saveTokenOrder(updated);
  };

  const waitForTokenAllowance = async (
    token: PortfolioToken,
    spender: Address,
    minimum: bigint
  ) => {
    if (!publicClient || !portfolio.address || !token.address) return minimum;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const allowance = (await publicClient.readContract({
        address: token.address as Address,
        abi: erc20Abi,
        functionName: "allowance",
        args: [portfolio.address, spender],
      })) as bigint;

      if (allowance >= minimum) return allowance;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    return (await publicClient.readContract({
      address: token.address as Address,
      abi: erc20Abi,
      functionName: "allowance",
      args: [portfolio.address, spender],
    })) as bigint;
  };

  const waitForErc20Allowance = async (
    tokenAddress: Address,
    spender: Address,
    minimum: bigint
  ) => {
    if (!publicClient || !portfolio.address) return minimum;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const allowance = (await publicClient.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: "allowance",
        args: [portfolio.address, spender],
      })) as bigint;

      if (allowance >= minimum) return allowance;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }

    return (await publicClient.readContract({
      address: tokenAddress,
      abi: erc20Abi,
      functionName: "allowance",
      args: [portfolio.address, spender],
    })) as bigint;
  };

  const activateNextToken = async () => {
    const nextToken = tokens.find(
      (token) =>
        tokenHasBalance(token) &&
        token.activation !== "active" &&
        getApprovalCap(token, tokenPrices)
    );
    if (!nextToken) {
      setStep(2);
      return;
    }

    const approvalCap = getApprovalCap(nextToken, tokenPrices);
    const approvalTarget = approvalTargets[nextToken.symbol];
    const ownerAddress = portfolio.address;
    setActivating(nextToken.symbol);

    try {
      if (!ownerAddress) return;

      if (
        nextToken.requiresApproval &&
        (!nextToken.address || !approvalTarget || !approvalCap)
      ) {
        return;
      }

      let confirmedAllowance = nextToken.allowance;

      if (nextToken.address && approvalTarget && approvalCap) {
        let allowance = await waitForTokenAllowance(nextToken, approvalTarget, 1n);

        if (allowance <= 0n) {
          const hash = await writeContractAsync({
            address: nextToken.address as Address,
            abi: erc20Abi,
            functionName: "approve",
            args: [approvalTarget, approvalCap],
          });
          await publicClient?.waitForTransactionReceipt({ hash });
          allowance = await waitForTokenAllowance(nextToken, approvalTarget, 1n);
        }

        if (allowance <= 0n) {
          throw new Error("No pudimos confirmar el permiso onchain.");
        }

        confirmedAllowance = allowance;
      }

      await portfolio.refetchAllowances();
      setTokens((currentTokens) =>
        currentTokens.map((token) =>
          token.symbol === nextToken.symbol
            ? { ...token, activation: "active", allowance: confirmedAllowance }
            : token
        )
      );
    } finally {
      setActivating(null);
    }
  };

  const updateCopAmount = (value: string) => {
    setCopAmount(cleanCopInput(value));
    setSwapStatus("idle");
    setSwapProgress("idle");
    setSwapError(null);
    setSwapFeeUsd(null);
    setShortfallQuote(null);
  };

  const updateRecipientAddress = (value: string) => {
    setRecipientAddress(value.trim());
    setSwapError(null);
  };

  const approvePurchaseToken = async () => {
    setSwapError(null);

    try {
      if (!portfolio.address) throw new Error("Wallet not ready");

      const usdAmount = getPurchaseUsdAmount(copAmount, copPerUsd);
      const approvalCandidate = getSwapApprovalCandidate(
        tokens,
        tokenPrices,
        usdAmount
      );
      const token = approvalCandidate?.token;
      const fromAmount = approvalCandidate?.fromAmount;
      const approvalTarget = token ? approvalTargets[token.symbol] : undefined;

      if (!token?.address || !fromAmount || !approvalTarget) {
        throw new Error("No pudimos preparar el permiso para este token.");
      }

      setActivating(token.symbol);

      const hash = await writeContractAsync({
        address: token.address as Address,
        abi: erc20Abi,
        functionName: "approve",
        args: [approvalTarget, fromAmount],
      });
      await publicClient?.waitForTransactionReceipt({ hash });

      const allowance = await waitForTokenAllowance(
        token,
        approvalTarget,
        fromAmount
      );

      if (allowance < fromAmount) {
        throw new Error("El permiso aprobado no alcanza para esta compra.");
      }

      await portfolio.refetchAllowances();
      setTokens((currentTokens) =>
        currentTokens.map((currentToken) =>
          currentToken.symbol === token.symbol
            ? { ...currentToken, activation: "active", allowance }
            : currentToken
        )
      );
    } catch (error) {
      setSwapError(getFriendlyErrorMessage(error));
    } finally {
      setActivating(null);
    }
  };

  const buyCopm = async () => {
    setSwapError(null);
    setSwapFeeUsd(null);
    setSwapResult(null);
    setSwapProgress("idle");

    try {
      if (!portfolio.address || !copmToken.address) {
        throw new Error("Wallet not ready");
      }

      const usdAmount = getPurchaseUsdAmount(copAmount, copPerUsd);
      if (usdAmount < MIN_PURCHASE_USD) {
        throw new Error("Minimum purchase amount");
      }
      if (parseCopAmount(copAmount) > MAX_COPM_AMOUNT) {
        throw new Error("El monto maximo es 10,000,000 COPm.");
      }

      const requestedRecipient =
        recipientMode === "other" ? recipientAddress.trim() : portfolio.address;
      if (!isAddress(requestedRecipient)) {
        throw new Error("Ingresa una wallet destino valida.");
      }
      const usesMiniPayRecipientFallback =
        isMiniPay &&
        requestedRecipient.toLowerCase() !== portfolio.address.toLowerCase();
      const swapRecipient = usesMiniPayRecipientFallback
        ? portfolio.address
        : requestedRecipient;
      if (!isAddress(swapRecipient)) {
        throw new Error("Ingresa una wallet destino valida.");
      }

      const swapPlan = getApprovedSwapPlan(tokens, tokenPrices, usdAmount);
      const requestedCopm = parseCopmUnits(copAmount, copmToken.decimals);
      const intentId = createIntentId();

      if (getSwapPlanUsd(swapPlan) + 0.01 < usdAmount) {
        throw new Error("No approved source token");
      }

      await createSwapIntent({
        chainId: targetNetwork.chainId,
        intentId,
        recipientAddress: requestedRecipient,
        requestedCopm: copAmount,
        userAddress: portfolio.address,
      });
      setSwapStatus("quoting");
      setSwapProgress("quoting");
      const initialCopmBalance = publicClient
        ? ((await publicClient.readContract({
            address: copmToken.address,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [swapRecipient],
          })) as bigint)
        : undefined;
      let lastHash: string | undefined;
      let quotedCopmTotal = 0n;
      let totalFeeUsd = 0;
      const squidRequestIds: string[] = [];
      const swapTxHashes: string[] = [];
      const swapReceipts: TransactionReceipt[] = [];
      const tokensSpent: Array<{
        amount: string;
        amountUsd: number;
        symbol: string;
      }> = [];
      let shortfallMessage: string | undefined;
      const quotedLegs: Array<{
        leg: SwapPlanLeg;
        legFromAmount: bigint;
        routeResult: SquidRouteResult;
        transactionRequest: {
          data: `0x${string}`;
          target: Address;
          value?: string;
        };
      }> = [];

      for (const leg of swapPlan) {
        let routeResult: SquidRouteResult | undefined;
        let quotedCopm: bigint | undefined;
        let legFromAmount = leg.fromAmount;

        for (let attempt = 0; attempt < 2; attempt += 1) {
          routeResult = await getSquidCopmRoute({
            fromAddress: portfolio.address,
            fromAmount: legFromAmount.toString(),
            fromChain: targetNetwork.squidChainId,
            fromToken: leg.token.address!,
            slippage: 0.3,
            toAddress: swapRecipient,
            toChain: targetNetwork.squidChainId,
            toToken: copmToken.address,
          });
          quotedCopm = getRouteToAmount(routeResult);

          if (swapPlan.length > 1 || !quotedCopm || quotedCopm >= requestedCopm) {
            break;
          }

          const nextFromAmount =
            (legFromAmount * requestedCopm * 1005n) / (quotedCopm * 1000n) + 1n;

          if (
            (leg.token.balance && nextFromAmount > leg.token.balance) ||
            (leg.token.allowance && nextFromAmount > leg.token.allowance)
          ) {
            break;
          }

          legFromAmount = nextFromAmount;
        }

        if (!routeResult) throw new Error("Squid route unavailable");
        if (routeResult.requestId) squidRequestIds.push(routeResult.requestId);
        totalFeeUsd += getRouteFeeUsd(routeResult);
        setSwapFeeUsd(totalFeeUsd);

        quotedCopmTotal += quotedCopm ?? 0n;

        const transactionRequest = routeResult.route?.transactionRequest;
        if (
          !transactionRequest?.target ||
          !isAddress(transactionRequest.target) ||
          !transactionRequest.data
        ) {
          throw new Error("Invalid Squid transaction");
        }

        quotedLegs.push({
          leg,
          legFromAmount,
          routeResult,
          transactionRequest: {
            data: transactionRequest.data,
            target: transactionRequest.target,
            value: transactionRequest.value,
          },
        });
      }

      if (quotedCopmTotal < requestedCopm) {
        const quotedCopm = formatCopmUnits(quotedCopmTotal, copmToken.decimals);
        const quotedUsd = Number(formatUnits(quotedCopmTotal, copmToken.decimals)) / copPerUsd;

        shortfallMessage = `No pudimos completar el monto exacto. La mejor cotizacion disponible entrega ${quotedCopm} COPm.`;

        if (
          shortfallQuote?.copAmount !== copAmount ||
          shortfallQuote.quotedCopm !== quotedCopm
        ) {
          setShortfallQuote({
            copAmount,
            quotedCopm,
            quotedUsd,
            message: shortfallMessage,
          });
          setSwapStatus("idle");
          setSwapProgress("idle");
          return;
        }
      }

      setShortfallQuote(null);

      for (const [index, quotedLeg] of quotedLegs.entries()) {
        const { leg, legFromAmount, routeResult, transactionRequest } = quotedLeg;
        const isLastLeg = index === quotedLegs.length - 1;

        setSwapStatus("buying");
        setSwapProgress("confirming");
        const hash = await sendTransactionAsync({
          to: transactionRequest.target,
          data: transactionRequest.data,
          value: BigInt(transactionRequest.value ?? "0"),
        });
        lastHash = hash;
        swapTxHashes.push(hash);
        const tokenPrice = getTokenPrice(leg.token, tokenPrices) ?? 0;
        tokensSpent.push({
          amount: formatUnits(legFromAmount, leg.token.decimals ?? 18),
          amountUsd:
            Number(formatUnits(legFromAmount, leg.token.decimals ?? 18)) *
            tokenPrice,
          symbol: leg.token.symbol,
        });
        await updateSwapIntent(intentId, {
          squidRequestIds,
          status: "submitted",
          swapTxHashes,
          tokensSpent,
        });

        setSwapProgress("processing");
        const receipt = await publicClient?.waitForTransactionReceipt({ hash });
        if (receipt) swapReceipts.push(receipt);
        await waitForSquidStatus(routeResult, hash, targetNetwork.squidChainId);
        if (!isLastLeg) setSwapProgress("quoting");
      }
      let finalCopmBalance = publicClient
        ? ((await publicClient.readContract({
            address: copmToken.address,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [swapRecipient],
          })) as bigint)
        : undefined;

      if (
        publicClient &&
        initialCopmBalance !== undefined &&
        finalCopmBalance !== undefined &&
        finalCopmBalance <= initialCopmBalance &&
        quotedCopmTotal > 0n
      ) {
        for (let attempt = 0; attempt < 6; attempt += 1) {
          await wait(2000);
          finalCopmBalance = (await publicClient.readContract({
            address: copmToken.address,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [swapRecipient],
          })) as bigint;
          if (finalCopmBalance > initialCopmBalance) break;
        }
      }

      const receiptCopm =
        copmToken.address && swapRecipient
          ? getCopmReceivedFromReceipts(
              swapReceipts,
              copmToken.address,
              swapRecipient
            )
          : 0n;
      const balanceDeltaCopm =
        initialCopmBalance !== undefined &&
        finalCopmBalance !== undefined &&
        finalCopmBalance > initialCopmBalance
          ? finalCopmBalance - initialCopmBalance
          : undefined;
      const receivedCopm =
        receiptCopm > 0n ? receiptCopm : balanceDeltaCopm ?? quotedCopmTotal;
      const displayedCopmBalance =
        initialCopmBalance !== undefined &&
        finalCopmBalance !== undefined &&
        finalCopmBalance <= initialCopmBalance &&
        quotedCopmTotal > 0n
          ? initialCopmBalance + quotedCopmTotal
          : finalCopmBalance;
      let transferHash: `0x${string}` | undefined;

      if (usesMiniPayRecipientFallback) {
        if (receivedCopm <= 0n) {
          throw new Error("No pudimos confirmar los COPm recibidos para enviarlos.");
        }

        setSwapProgress("confirming");
        transferHash = await writeContractAsync({
          address: copmToken.address,
          abi: erc20Abi,
          functionName: "transfer",
          args: [requestedRecipient, receivedCopm],
        });
        lastHash = transferHash;
        swapTxHashes.push(transferHash);
        await updateSwapIntent(intentId, {
          squidRequestIds,
          status: "submitted",
          swapTxHashes,
          tokensSpent,
        });
        setSwapProgress("processing");
        await publicClient?.waitForTransactionReceipt({ hash: transferHash });
      }

      setSwapResult({
        completedAt: new Date().toISOString(),
        copmBalance:
          requestedRecipient.toLowerCase() !== portfolio.address.toLowerCase()
            ? "No disponible"
            : displayedCopmBalance !== undefined
            ? formatCopmUnits(displayedCopmBalance, copmToken.decimals)
            : "No disponible",
        receivedCopm:
          receivedCopm !== undefined
            ? formatCopmUnits(receivedCopm, copmToken.decimals)
            : formatCopmUnits(requestedCopm, copmToken.decimals),
        recipientAddress:
          requestedRecipient.toLowerCase() !== portfolio.address.toLowerCase()
            ? requestedRecipient
            : undefined,
        shortfallMessage,
        title: "Conversión completada",
        txHash: lastHash ?? "",
        txUrl: `${targetNetwork.blockExplorerUrl}/tx/${lastHash}`,
        variant: "swap",
      });
      if (receivedCopm !== undefined) {
        void updateSwapIntent(intentId, {
          copmReceived: formatUnits(receivedCopm, copmToken.decimals),
          feeUsd: totalFeeUsd.toFixed(6),
          squidRequestIds,
          status: "confirmed",
          swapTxHashes,
          tokensSpent,
        }).then(() => logSwapOnchain(intentId));
      }
      setSwapStatus("complete");
      setSwapProgress("idle");
    } catch (error) {
      setSwapStatus("error");
      setSwapProgress("idle");
      const copy = getWalletActionErrorCopy(error, "buy");
      setSwapError(copy.message);
    }
  };

  const sellCopm = async () => {
    setSellError(null);
    setSellReceivedUsdt(null);
    setSellTxHash(null);
    let intentId: string | undefined;

    try {
      if (!portfolio.address || !copmToken.address || !usdtToken.address) {
        throw new Error("Wallet not ready");
      }

      const amountNumber = parseCopAmount(sellAmount);
      if (amountNumber <= 0) throw new Error("Ingresa un monto mayor a 0.");
      if (copmBalance !== undefined && parseCopmUnits(sellAmount, copmToken.decimals) > copmBalance) {
        throw new Error("Saldo COPm insuficiente.");
      }

      const fromAmount = parseCopmUnits(sellAmount, copmToken.decimals);
      const requestedSellRecipient =
        sellRecipientMode === "other"
          ? sellRecipientAddress.trim()
          : portfolio.address;
      if (!isAddress(requestedSellRecipient)) {
        throw new Error("Ingresa una wallet destino valida.");
      }
      const usesMiniPaySellRecipientFallback =
        isMiniPay &&
        requestedSellRecipient.toLowerCase() !== portfolio.address.toLowerCase();
      const sellRecipient = usesMiniPaySellRecipientFallback
        ? portfolio.address
        : requestedSellRecipient;
      intentId = createIntentId();
      await createSwapIntent({
        chainId: targetNetwork.chainId,
        intentId,
        outputToken: "USDT",
        recipientAddress: requestedSellRecipient,
        requestedCopm: sellAmount,
        swapType: "sell",
        userAddress: portfolio.address,
      });
      setSellStatus("quoting");

      const initialUsdtBalance = publicClient
        ? ((await publicClient.readContract({
            address: usdtToken.address,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [sellRecipient],
          })) as bigint)
        : undefined;

      const routeResult = await getSquidRoute({
        fromAddress: portfolio.address,
        fromAmount: fromAmount.toString(),
        fromChain: targetNetwork.squidChainId,
        fromToken: copmToken.address,
        slippage: 0.3,
        toAddress: sellRecipient,
        toChain: targetNetwork.squidChainId,
        toToken: usdtToken.address,
      });
      const quotedUsdt = getRouteToAmount(routeResult);
      const feeUsd = getRouteFeeUsd(routeResult);
      const approvalTarget = routeResult.approvalTarget;

      if (!approvalTarget) {
        throw new Error("No pudimos preparar el permiso para vender COPm.");
      }

      let allowance = await waitForErc20Allowance(
        copmToken.address,
        approvalTarget,
        fromAmount
      );

      if (allowance < fromAmount) {
        setSellStatus("approving");
        const approveHash = await writeContractAsync({
          address: copmToken.address,
          abi: erc20Abi,
          functionName: "approve",
          args: [approvalTarget, fromAmount],
        });
        await publicClient?.waitForTransactionReceipt({ hash: approveHash });
        allowance = await waitForErc20Allowance(
          copmToken.address,
          approvalTarget,
          fromAmount
        );
      }

      if (allowance < fromAmount) {
        throw new Error("El permiso aprobado no alcanza para esta venta.");
      }

      const transactionRequest = routeResult.route?.transactionRequest;
      if (
        !transactionRequest?.target ||
        !isAddress(transactionRequest.target) ||
        !transactionRequest.data
      ) {
        throw new Error("Invalid Squid transaction");
      }

      setSellStatus("confirming");
      const hash = await sendTransactionAsync({
        to: transactionRequest.target,
        data: transactionRequest.data,
        value: BigInt(transactionRequest.value ?? "0"),
      });
      setSellTxHash(hash);
      const sellTxHashes = [hash];
      await updateSwapIntent(intentId, {
        feeUsd: feeUsd.toFixed(6),
        squidRequestIds: routeResult.requestId ? [routeResult.requestId] : [],
        status: "submitted",
        swapTxHashes: sellTxHashes,
        tokensSpent: [
          {
            amount: formatUnits(fromAmount, copmToken.decimals),
            amountUsd: Number(formatUnits(fromAmount, copmToken.decimals)) / copPerUsd,
            symbol: "COPm",
          },
        ],
      });
      setSellStatus("processing");
      await publicClient?.waitForTransactionReceipt({ hash });
      await waitForSquidStatus(routeResult, hash, targetNetwork.squidChainId);

      const finalUsdtBalance = publicClient
        ? ((await publicClient.readContract({
            address: usdtToken.address,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [sellRecipient],
          })) as bigint)
        : undefined;
      const receivedUsdt =
        initialUsdtBalance !== undefined &&
        finalUsdtBalance !== undefined &&
        finalUsdtBalance > initialUsdtBalance
          ? finalUsdtBalance - initialUsdtBalance
          : quotedUsdt;
      let finalHash = hash;

      if (usesMiniPaySellRecipientFallback) {
        if (!receivedUsdt || receivedUsdt <= 0n) {
          throw new Error("No pudimos confirmar los USDT recibidos para enviarlos.");
        }

        setSellStatus("confirming");
        const transferHash = await writeContractAsync({
          address: usdtToken.address,
          abi: erc20Abi,
          functionName: "transfer",
          args: [requestedSellRecipient, receivedUsdt],
        });
        finalHash = transferHash;
        setSellTxHash(transferHash);
        sellTxHashes.push(transferHash);
        await updateSwapIntent(intentId, {
          status: "submitted",
          swapTxHashes: sellTxHashes,
        });
        setSellStatus("processing");
        await publicClient?.waitForTransactionReceipt({ hash: transferHash });
      }

      setSellReceivedUsdt(
        receivedUsdt !== undefined
          ? formatUnits(receivedUsdt, usdtToken.decimals)
          : "No disponible"
      );
      const sellIntentId = intentId;
      await updateSwapIntent(sellIntentId, {
        outputAmount:
          receivedUsdt !== undefined
            ? formatUnits(receivedUsdt, usdtToken.decimals)
            : undefined,
        status: "confirmed",
      }).then(() => logSwapOnchain(sellIntentId));
      setSwapResult({
        amountLabel:
          requestedSellRecipient.toLowerCase() !== portfolio.address.toLowerCase()
            ? "Enviaste"
            : "Recibiste",
        completedAt: new Date().toISOString(),
        copmBalance: "Actualizando",
        receivedCopm:
          receivedUsdt !== undefined
            ? formatUnits(receivedUsdt, usdtToken.decimals)
            : "No disponible",
        title: "Venta completada",
        recipientAddress:
          requestedSellRecipient.toLowerCase() !== portfolio.address.toLowerCase()
            ? requestedSellRecipient
            : undefined,
        txHash: finalHash,
        txUrl: `${targetNetwork.blockExplorerUrl}/tx/${finalHash}`,
        variant: "sell",
      });
      setSellStatus("complete");
      await refreshCopmBalance();
    } catch (error) {
      setSellStatus("error");
      const copy = getWalletActionErrorCopy(error, "sell");
      const friendlyError = copy.message;
      setSellError(friendlyError);
      if (intentId) {
        void updateSwapIntent(intentId, {
          error: friendlyError,
          status: "failed",
        });
      }
    }
  };

  const sendCopmTransfer = async () => {
    setTransferError(null);

    try {
      if (!portfolio.address || !copmToken.address) throw new Error("Wallet not ready");
      if (!isAddress(recipientAddress)) throw new Error("Ingresa una wallet destino valida.");

      const amountNumber = parseCopAmount(transferAmount);
      if (amountNumber <= 0) throw new Error("Ingresa un monto mayor a 0.");
      if (amountNumber > MAX_COPM_AMOUNT) {
        throw new Error("El monto maximo es 10,000,000 COPm.");
      }

      const amount = parseCopmUnits(transferAmount, copmToken.decimals);
      if (copmBalance !== undefined && amount > copmBalance) {
        throw new Error("Saldo COPm insuficiente.");
      }

      if (!transferConfirming) {
        setTransferConfirming(true);
        return;
      }

      const transferId = createIntentId();
      setTransferStatus("confirming");
      await createCopmTransfer({
        chainId: targetNetwork.chainId,
        copmAmount: transferAmount,
        recipientAddress,
        senderAddress: portfolio.address,
        transferId,
      });

      const hash = await writeContractAsync({
        address: copmToken.address,
        abi: erc20Abi,
        functionName: "transfer",
        args: [recipientAddress, amount],
      });
      setTransferStatus("sending");
      await updateCopmTransfer(transferId, { status: "submitted", txHash: hash });
      await publicClient?.waitForTransactionReceipt({ hash });
      await updateCopmTransfer(transferId, { status: "confirmed", txHash: hash });

      setTransferConfirming(false);
      setTransferStatus("complete");
      setSwapResult({
        amountLabel: "Enviaste",
        completedAt: new Date().toISOString(),
        copmBalance: "Actualizando",
        receivedCopm: formatPesoAmountFromString(transferAmount),
        recipientAddress,
        recipientAlias: getSavedRecipients().find(
          (item) => item.address === recipientAddress.toLowerCase()
        )?.alias,
        title: "Envío completado",
        txHash: hash,
        txUrl: `${targetNetwork.blockExplorerUrl}/tx/${hash}`,
        variant: "transfer",
      });
      await refreshCopmBalance();
    } catch (error) {
      setTransferStatus("error");
      setTransferError(getFriendlyErrorMessage(error, "transfer"));
    }
  };

  const hasCopmBalance = copmBalance !== undefined && copmBalance > 0n;
  const copmBalanceLabel =
    copmBalance === undefined
      ? "0"
      : formatPesoAmountFromBigInt(copmBalance, copmToken.decimals);
  const copmBalanceUsd = parseCopAmount(copmBalanceLabel) / copPerUsd;

  return (
    <main className="min-h-[calc(100vh-3rem)] bg-[#F7F8F5] text-[#17211B]">
      {showOnboarding && (
        <OnboardingScreen
          onStart={() => {
            markOnboardingSeen();
            setShowOnboarding(false);
          }}
        />
      )}
      <section className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-md flex-col px-4 py-3 sm:max-w-lg sm:py-5 md:max-w-2xl">
        <HomeHeader
          title={
            actionMode === "transfer"
              ? "Enviar pesos"
              : actionMode === "sell"
                ? "Vender pesos"
                : "COPm"
          }
          onActivity={() => setHomePanel("activity")}
          onDetails={() =>
            setHomePanel((currentPanel) =>
              currentPanel === "details" ? null : "details"
            )
          }
        />

        {homePanel === "activity" ? (
          <ActivityPanel
            explorerUrl={targetNetwork.blockExplorerUrl}
            userAddress={portfolio.address}
            onClose={() => setHomePanel(null)}
          />
        ) : homePanel === "details" ? (
          <DetailsPanel
            approvalUsd={purchasePreview.activationCapUsd}
            balanceCopm={copmBalanceLabel}
            balanceUsd={copmBalanceUsd}
            tokens={tokens}
            onClose={() => setHomePanel(null)}
            onReorder={reorderToken}
            onSpend={() => undefined}
            onTransfer={() => handleActionModeChange("transfer")}
          />
        ) : homePanel === "chart" ? (
          <CopmChartPanel
            balanceCopm={copmBalanceLabel}
            balanceUsd={copmBalanceUsd}
            copPerUsd={copPerUsd}
            copVsUsdChange={
              typeof tokenPrices.COP_PER_USD_24H_CHANGE === "number" &&
              Number.isFinite(tokenPrices.COP_PER_USD_24H_CHANGE)
                ? -tokenPrices.COP_PER_USD_24H_CHANGE
                : null
            }
            onClose={() => setHomePanel(null)}
          />
        ) : actionMode === "transfer" ? (
          <>
            <button
              type="button"
              onClick={() => handleActionModeChange("buy")}
              className="mb-3 inline-flex w-fit items-center gap-1 rounded-full bg-white px-3 py-2 text-sm font-semibold text-[#66736B] shadow-sm"
            >
              <ChevronRight className="h-4 w-4 rotate-180" />
              Volver
            </button>
            <TransferCopmScreen
              amount={transferAmount}
              balance={copmBalance}
              confirming={transferConfirming}
              error={transferError}
              hasCopmBalance={hasCopmBalance}
              recipientAddress={recipientAddress}
              savedRecipients={savedRecipients}
              status={transferStatus}
              tokenDecimals={copmToken.decimals}
              onAmountChange={(value) => {
                setTransferAmount(cleanCopInput(value));
                setTransferConfirming(false);
                setTransferError(null);
              }}
              onGetPesos={() => handleActionModeChange("buy")}
              onMax={() => {
                if (copmBalance !== undefined) {
                  setTransferAmount(
                    formatPesoAmountFromBigInt(copmBalance, copmToken.decimals)
                  );
                  setTransferConfirming(false);
                }
              }}
              onRecipientAddressChange={(value) => {
                updateRecipientAddress(value);
                setTransferConfirming(false);
              }}
              onRecipientSaved={() => refreshSavedRecipients()}
              onRemoveRecipient={handleRemoveRecipient}
              onSaveRecipient={handleSaveRecipient}
              onSend={sendCopmTransfer}
            />
          </>
        ) : (
          <>
            <BuySellTabs
              mode={actionMode === "sell" ? "sell" : "buy"}
              onChange={(mode) => handleActionModeChange(mode)}
            />
            {actionMode === "sell" ? (
              <SellCopmScreen
                amount={sellAmount}
                balance={copmBalance}
                copPerUsd={copPerUsd}
                copRateChange={tokenPrices.COP_PER_USD_24H_CHANGE}
                error={sellError}
                isLive={isLivePortfolio}
                isMiniPay={isMiniPay}
                recipientAddress={sellRecipientAddress}
                recipientMode={sellRecipientMode}
                receivedUsdt={sellReceivedUsdt}
                savedRecipients={savedRecipients}
                status={sellStatus}
                tokenDecimals={copmToken.decimals}
                txHash={sellTxHash}
                txUrl={
                  sellTxHash
                    ? `${targetNetwork.blockExplorerUrl}/tx/${sellTxHash}`
                    : undefined
                }
                onAmountChange={(value) => {
                  setSellAmount(cleanCopInput(value));
                  setSellError(null);
                  setSellReceivedUsdt(null);
                  setSellStatus("idle");
                  setSellTxHash(null);
                }}
                onMax={() => {
                  if (copmBalance !== undefined) {
                    setSellAmount(
                      formatPesoAmountFromBigInt(copmBalance, copmToken.decimals)
                    );
                    setSellError(null);
                    setSellReceivedUsdt(null);
                    setSellStatus("idle");
                    setSellTxHash(null);
                  }
                }}
                onRecipientAddressChange={setSellRecipientAddress}
                onRecipientModeChange={setSellRecipientMode}
                onRecipientSaved={() => refreshSavedRecipients()}
                onRemoveRecipient={handleRemoveRecipient}
                onSaveRecipient={handleSaveRecipient}
                onSell={sellCopm}
              />
            ) : step === 0 ? (
              <TokenOrderScreen
                tokens={tokens}
                canContinue={
                  !isLivePortfolio || (!isLoadingPortfolio && hasCompatibleTokens)
                }
                hasCompatibleTokens={hasCompatibleTokens}
                isMiniPay={isMiniPay}
                isLive={isLivePortfolio}
                isLoading={isLoadingPortfolio}
                userAddress={portfolio.address}
                onReorder={reorderToken}
                onContinue={() => setStep(1)}
              />
            ) : step === 1 ? (
              <TokenActivationScreen
                tokens={tokens}
                allActive={allActive}
                approvalTargets={approvalTargets}
                activating={activating}
                routeError={routeError}
                tokenPrices={tokenPrices}
                onActivate={activateNextToken}
                onSkip={() => setStep(2)}
              />
            ) : (
              <BuyCopmScreen
                copAmount={copAmount}
                copRateChange={tokenPrices.COP_PER_USD_24H_CHANGE}
                copPerUsd={copPerUsd}
                hasCompatibleTokens={hasCompatibleTokens}
                isMiniPay={isMiniPay}
                isLive={isLivePortfolio}
                totalUsd={effectiveTotalUsd}
                detailsOpen={detailsOpen}
                swapError={swapError}
                swapProgress={swapProgress}
                swapStatus={swapStatus}
                swapFeeUsd={swapFeeUsd}
                shortfallQuote={shortfallQuote}
                tokenPrices={tokenPrices}
                tokens={tokens}
                activating={activating}
                approvalTargets={approvalTargets}
                recipientAddress={recipientAddress}
                recipientMode={recipientMode}
                savedRecipients={savedRecipients}
                onAmountChange={updateCopAmount}
                onApprovePurchase={approvePurchaseToken}
                onBuy={buyCopm}
                onChangeTokenOrder={() => setStep(0)}
                onDetailsToggle={() => setDetailsOpen((open) => !open)}
                onRecipientAddressChange={updateRecipientAddress}
                onRecipientSaved={() => refreshSavedRecipients()}
                onRemoveRecipient={handleRemoveRecipient}
                onSaveRecipient={handleSaveRecipient}
                onRecipientModeChange={setRecipientMode}
              />
            )}
          </>
        )}
        <footer className="mt-auto flex justify-center gap-4 py-5">
          <Link
            href="/activity"
            className="text-xs font-semibold text-[#66736B] underline-offset-4 hover:text-[#0E7C4F] hover:underline"
          >
            Mi actividad
          </Link>
          <Link
            href="/analytics"
            className="text-xs font-semibold text-[#66736B] underline-offset-4 hover:text-[#0E7C4F] hover:underline"
          >
            Stats
          </Link>
        </footer>
        {swapResult && (
          <SwapSuccessModal
            result={swapResult}
            onClose={() => setSwapResult(null)}
          />
        )}
      </section>
    </main>
  );
}

function TokenOrderScreen({
  tokens,
  canContinue,
  hasCompatibleTokens,
  isMiniPay,
  isLive,
  isLoading,
  userAddress,
  onReorder,
  onContinue,
}: {
  tokens: PortfolioToken[];
  canContinue: boolean;
  hasCompatibleTokens: boolean;
  isMiniPay: boolean;
  isLive: boolean;
  isLoading: boolean;
  userAddress?: string;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onContinue: () => void;
}) {
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const draggingSymbolRef = useRef<string | null>(null);
  const [draggingSymbol, setDraggingSymbol] = useState<string | null>(null);
  const orderableTokenCount = isLive
    ? tokens.filter((token) => token.hasBalance).length
    : tokens.length;
  const isOrderableToken = (token: PortfolioToken) =>
    !isLive || Boolean(token.hasBalance);

  const getTargetIndex = (clientY: number) => {
    for (let index = 0; index < tokens.length; index += 1) {
      if (!isOrderableToken(tokens[index])) continue;
      const row = rowRefs.current[tokens[index].symbol];
      if (!row) continue;

      const rect = row.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) {
        return index;
      }
    }

    for (let index = tokens.length - 1; index >= 0; index -= 1) {
      if (isOrderableToken(tokens[index])) return index;
    }

    return -1;
  };

  const getNextOrderableIndex = (index: number, direction: -1 | 1) => {
    for (
      let nextIndex = index + direction;
      nextIndex >= 0 && nextIndex < tokens.length;
      nextIndex += direction
    ) {
      if (isOrderableToken(tokens[nextIndex])) return nextIndex;
    }

    return -1;
  };

  const startDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    symbol: string
  ) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingSymbolRef.current = symbol;
    setDraggingSymbol(symbol);
  };

  const startTouchDrag = (
    event: ReactTouchEvent<HTMLButtonElement>,
    symbol: string
  ) => {
    event.preventDefault();
    draggingSymbolRef.current = symbol;
    setDraggingSymbol(symbol);
  };

  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    draggingSymbolRef.current = null;
    setDraggingSymbol(null);
  };

  const endTouchDrag = () => {
    draggingSymbolRef.current = null;
    setDraggingSymbol(null);
  };

  useEffect(() => {
    if (!draggingSymbol) return;

    const moveDragTo = (clientY: number) => {
      const symbol = draggingSymbolRef.current;
      if (!symbol) return;

      const fromIndex = tokens.findIndex((token) => token.symbol === symbol);
      const toIndex = getTargetIndex(clientY);
      if (toIndex === -1) return;
      onReorder(fromIndex, toIndex);
    };

    const movePointerDrag = (event: PointerEvent) => {
      moveDragTo(event.clientY);
    };

    const moveTouchDrag = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      event.preventDefault();
      moveDragTo(touch.clientY);
    };

    const cancelDrag = () => {
      draggingSymbolRef.current = null;
      setDraggingSymbol(null);
    };

    window.addEventListener("pointermove", movePointerDrag);
    window.addEventListener("pointerup", cancelDrag);
    window.addEventListener("pointercancel", cancelDrag);
    window.addEventListener("touchmove", moveTouchDrag, { passive: false });
    window.addEventListener("touchend", cancelDrag);
    window.addEventListener("touchcancel", cancelDrag);

    return () => {
      window.removeEventListener("pointermove", movePointerDrag);
      window.removeEventListener("pointerup", cancelDrag);
      window.removeEventListener("pointercancel", cancelDrag);
      window.removeEventListener("touchmove", moveTouchDrag);
      window.removeEventListener("touchend", cancelDrag);
      window.removeEventListener("touchcancel", cancelDrag);
    };
  }, [draggingSymbol, onReorder, tokens]);

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-3 rounded-[8px] border border-[#DDE4DC] bg-white p-4">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-[8px] bg-[#E6F4EE] text-[#0E7C4F]">
          <ArrowLeftRight className="h-5 w-5" />
        </div>
        <h2 className="text-xl font-semibold leading-tight">
          Convierte tus dólares de MiniPay en pesos
        </h2>
        <p className="mt-2 text-sm leading-5 text-[#66736B]">
          Elige qué saldo usar primero. Puedes cambiarlo después.
        </p>
        {isLive && (
          <p className="mt-2 text-xs font-medium text-[#0E7C4F]">
            Saldos leidos desde tu wallet.
          </p>
        )}
      </div>

      {isLoading ? (
        <TokenListSkeleton />
      ) : isLive && !hasCompatibleTokens ? (
        <TokenEmptyStateMessage userAddress={userAddress} />
      ) : (
        <div className="space-y-2.5 pb-16">
        {tokens.map((token, index) => {
            const hasBalance = tokenHasBalance(token);
            const isMuted = isLive && !hasBalance;
            const canReorder = !isMuted && orderableTokenCount > 1;
            const previousOrderableIndex = getNextOrderableIndex(index, -1);
            const nextOrderableIndex = getNextOrderableIndex(index, 1);

            return (
              <div
                key={token.symbol}
                ref={(element) => {
                  rowRefs.current[token.symbol] = element;
                }}
                className={`flex min-h-[62px] items-center gap-3 rounded-[8px] border bg-white p-3 transition ${
                  draggingSymbol === token.symbol
                    ? "scale-[0.99] border-[#0E7C4F] shadow-sm"
                    : "border-[#DDE4DC]"
                } ${isMuted ? "opacity-45" : ""}`}
              >
                <button
                  type="button"
                  aria-label={`Arrastrar ${token.symbol}`}
                  disabled={!canReorder}
                  className="touch-none rounded-full p-1 text-[#9AA69D] enabled:cursor-grab enabled:active:cursor-grabbing enabled:active:text-[#0E7C4F] disabled:cursor-not-allowed disabled:opacity-40"
                  onPointerDown={(event) => startDrag(event, token.symbol)}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onTouchStart={(event) => startTouchDrag(event, token.symbol)}
                  onTouchEnd={endTouchDrag}
                  onTouchCancel={endTouchDrag}
                >
                  <GripVertical className="h-5 w-5 shrink-0" />
                </button>
                <TokenMark token={token} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{token.symbol}</p>
                  <p className="truncate text-xs text-[#66736B]">
                    {token.label}
                  </p>
                  {isMuted ? (
                    <p className="text-[11px] text-[#9AA69D]">Sin saldo</p>
                  ) : null}
                </div>
                <p className="text-sm font-semibold">
                  {token.balanceDisplay ?? formatUsd(token.balanceUsd)}
                </p>
                <div className="flex flex-col gap-1">
                  <MoveButton
                    label={`Subir ${token.symbol}`}
                    disabled={!canReorder || previousOrderableIndex === -1}
                    onClick={() => onReorder(index, previousOrderableIndex)}
                    direction="up"
                  />
                  <MoveButton
                    label={`Bajar ${token.symbol}`}
                    disabled={!canReorder || nextOrderableIndex === -1}
                    onClick={() => onReorder(index, nextOrderableIndex)}
                    direction="down"
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="sticky bottom-0 -mx-4 mt-auto bg-[#F7F8F5]/95 px-4 py-3 backdrop-blur">
        <Button
          className="h-12 w-full rounded-[8px] bg-[#6D45B8] text-base font-semibold text-white hover:bg-[#56359A] disabled:bg-[#C8B9E8]"
          disabled={!canContinue}
          onClick={onContinue}
        >
          Continuar
        </Button>
      </div>
    </div>
  );
}

function TokenActivationScreen({
  tokens,
  allActive,
  approvalTargets,
  activating,
  routeError,
  tokenPrices,
  onActivate,
  onSkip,
}: {
  tokens: PortfolioToken[];
  allActive: boolean;
  approvalTargets: Partial<Record<string, Address>>;
  activating: string | null;
  routeError: string | null;
  tokenPrices: TokenUsdPrices;
  onActivate: () => void;
  onSkip: () => void;
}) {
  const nextToken = tokens.find(
    (token) =>
      tokenHasBalance(token) &&
      token.activation !== "active" &&
      getApprovalCap(token, tokenPrices)
  );
  const canApprove = !nextToken || Boolean(approvalTargets[nextToken.symbol]);

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-3 rounded-[8px] border border-[#DDE4DC] bg-white p-4">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-[8px] bg-[#E6F4EE] text-[#0E7C4F]">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <h2 className="text-xl font-semibold leading-tight">
          Activa tus saldos
        </h2>
        <p className="mt-2 text-sm leading-5 text-[#66736B]">
          Autoriza una vez para convertir a pesos con un toque después.
        </p>
        <div className="mt-3 rounded-[8px] bg-[#FFF6D8] px-3 py-2 text-sm font-medium text-[#17211B]">
          {canApprove
            ? `Permiso por token: hasta ${formatUsd(
                purchasePreview.activationCapUsd
              )}`
            : (routeError ??
              "Buscando route de Squid para saber a que contrato aprobar.")}
        </div>
      </div>

      <div className="space-y-2.5 pb-16">
        {tokens.map((token) => {
          const hasBalance = tokenHasBalance(token);
          const isActive = token.activation === "active";
          const isActivating = activating === token.symbol;
          const canTokenApprove =
            hasBalance && Boolean(getApprovalCap(token, tokenPrices));
          const isMuted = !hasBalance;

          return (
            <div
              key={token.symbol}
              className={`flex min-h-[62px] items-center gap-3 rounded-[8px] border border-[#DDE4DC] bg-white p-3 ${
                isMuted ? "opacity-45" : ""
              }`}
            >
              <TokenMark token={token} />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{token.symbol}</p>
                <p className="text-xs text-[#66736B]">
                  {token.balanceDisplay ?? formatUsd(token.balanceUsd)}
                </p>
              </div>
              <span
                className={`inline-flex h-8 min-w-[86px] items-center justify-center rounded-full px-3 text-xs font-semibold ${
                  isActive
                    ? "bg-[#E6F4EE] text-[#0E7C4F]"
                    : isActivating
                      ? "bg-[#FFF6D8] text-[#B7791F]"
                      : !canTokenApprove
                        ? "bg-[#F7F8F5] text-[#9AA69D]"
                      : "bg-[#F7F8F5] text-[#66736B]"
                }`}
              >
                {isMuted ? (
                  "Sin saldo"
                ) : isActive ? (
                  <>
                    <Check className="mr-1 h-3.5 w-3.5" />
                    Activo
                  </>
                ) : isActivating ? (
                  "Activando"
                ) : !canTokenApprove ? (
                  "Luego"
                ) : (
                  "Activar"
                )}
              </span>
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-center text-xs text-[#66736B]">
        Esto no mueve tu saldo. Solo deja listo cada token.
      </p>

      <div className="sticky bottom-0 -mx-4 mt-auto space-y-2 bg-[#F7F8F5]/95 px-4 py-3 backdrop-blur">
        <Button
          className="h-12 w-full rounded-[8px] bg-[#6D45B8] text-base font-semibold text-white hover:bg-[#56359A] disabled:bg-[#C8B9E8]"
          onClick={allActive ? onSkip : onActivate}
          disabled={activating !== null || (!allActive && !canApprove)}
        >
          {allActive ? "Continuar" : "Activar saldo"}
        </Button>
        <button
          type="button"
          onClick={onSkip}
          className="h-11 w-full text-sm font-semibold text-[#66736B]"
        >
          Saltar por ahora
        </button>
      </div>
    </div>
  );
}

function TokenListSkeleton() {
  return (
    <div className="space-y-2.5 pb-16">
      {[0, 1, 2].map((item) => (
        <div
          key={item}
          className="flex min-h-[62px] items-center gap-3 rounded-[8px] border border-dashed border-[#DDE4DC] bg-white/70 p-3"
          aria-hidden="true"
        >
          <div className="h-5 w-5 rounded-full bg-[#DDE4DC]" />
          <div className="h-10 w-10 shrink-0 rounded-full bg-[#E8EDE7]" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3 w-24 rounded-full bg-[#DDE4DC]" />
            <div className="h-2.5 w-36 rounded-full bg-[#E8EDE7]" />
          </div>
          <div className="h-4 w-14 rounded-full bg-[#DDE4DC]" />
        </div>
      ))}
    </div>
  );
}

function TokenEmptyStateMessage({ userAddress }: { userAddress?: string }) {
  const copyAddress = () => {
    if (!userAddress) return;
    void navigator.clipboard.writeText(userAddress);
  };
  const addressPreview = userAddress
    ? formatAddressPreview(userAddress)
    : undefined;

  return (
    <div className="pb-16">
      <div className="rounded-[8px] border border-[#DDE4DC] bg-white p-4">
        <p className="text-sm font-semibold text-[#17211B]">
          No encontramos tokens compatibles
        </p>
        <p className="mt-1 text-sm leading-5 text-[#66736B]">
          Puedes recibir USDC, USDT o ETH en Celo para comprar COPm.
        </p>
        {userAddress && (
          <div className="mt-4 border-t border-[#DDE4DC] pt-3">
            <p className="text-xs font-medium text-[#66736B]">
              Tu address para recibir tokens:
            </p>
            <div className="mt-2 flex items-center gap-2 rounded-[8px] bg-[#F7F8F5] p-2">
              <p className="min-w-0 flex-1 font-mono text-xs text-[#17211B]">
                {addressPreview}
              </p>
              <button
                type="button"
                aria-label="Copiar address"
                onClick={copyAddress}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-[8px] bg-white text-[#0E7C4F] shadow-sm"
              >
                <Copy className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function HomeHeader({
  onActivity,
  onDetails,
  title,
}: {
  onActivity: () => void;
  onDetails: () => void;
  title: string;
}) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <button
        type="button"
        onClick={onDetails}
        aria-label="Detalles"
        className="grid h-10 w-10 place-items-center rounded-full bg-white text-[#66736B] shadow-sm"
      >
        <Menu className="h-5 w-5" />
      </button>
      <p className="text-base font-semibold">{title}</p>
      <button
        type="button"
        onClick={onActivity}
        aria-label="Actividad"
        className="grid h-10 w-10 place-items-center rounded-full bg-white text-[#66736B] shadow-sm"
      >
        <Clock className="h-5 w-5" />
      </button>
    </div>
  );
}

function BuySellTabs({
  mode,
  onChange,
}: {
  mode: "buy" | "sell";
  onChange: (mode: "buy" | "sell") => void;
}) {
  return (
    <div className="mb-3 grid grid-cols-2 gap-1 rounded-full bg-white p-1 shadow-sm">
      <button
        type="button"
        onClick={() => onChange("buy")}
        className={`h-10 rounded-full text-sm font-semibold ${
          mode === "buy"
            ? "bg-[#6D45B8] text-white"
            : "text-[#9AA69D]"
        }`}
      >
        Comprar COPm
      </button>
      <button
        type="button"
        onClick={() => onChange("sell")}
        className={`h-10 rounded-full text-sm font-semibold ${
          mode === "sell"
            ? "bg-[#6D45B8] text-white"
            : "text-[#9AA69D]"
        }`}
      >
        Vender COPm
      </button>
    </div>
  );
}

function PanelShell({
  children,
  onClose,
  title,
}: {
  children: React.ReactNode;
  onClose: () => void;
  title: string;
}) {
  return (
    <div className="rounded-[8px] border border-[#DDE4DC] bg-white p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-semibold">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="grid h-8 w-8 place-items-center rounded-full bg-[#F7F8F5] text-[#66736B]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {children}
    </div>
  );
}

function formatActivityRecipient(address: string | null) {
  if (!address) return "tu wallet";
  const alias = getRecipientAlias(address);
  if (alias) return `${alias} (${formatAddressPreview(address)})`;
  return formatAddressPreview(address);
}

function ActivityPanel({
  explorerUrl,
  onClose,
  userAddress,
}: {
  explorerUrl: string;
  onClose: () => void;
  userAddress?: Address;
}) {
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userAddress) {
      setItems([]);
      return;
    }

    let cancelled = false;
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    setLoading(true);
    setError(null);

    fetchUserActivity(userAddress, 30)
      .then((nextItems) => {
        if (cancelled) return;
        setItems(
          nextItems.filter(
            (item) => new Date(item.createdAt).getTime() >= sevenDaysAgo
          )
        );
      })
      .catch(() => {
        if (cancelled) return;
        setError("No pudimos cargar tu actividad.");
        setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [userAddress]);

  return (
    <PanelShell title="Actividad" onClose={onClose}>
      {!userAddress ? (
        <p className="py-12 text-center text-sm font-medium text-[#66736B]">
          Conecta tu wallet para ver tu actividad.
        </p>
      ) : loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((item) => (
            <div
              key={item}
              className="h-24 animate-pulse rounded-[8px] bg-[#F7F8F5]"
            />
          ))}
        </div>
      ) : error ? (
        <p className="py-12 text-center text-sm font-medium text-[#8A1F1F]">
          {error}
        </p>
      ) : items.length === 0 ? (
        <p className="py-12 text-center text-sm font-medium text-[#66736B]">
          No hay actividad en los últimos 7 días.
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((item) => {
            const isSwap = item.type === "swap";
            const isSell = item.swapType === "sell";
            const title = isSwap
              ? isSell
                ? "Vendiste pesos"
                : "Obtuviste pesos"
              : "Enviaste pesos";
            const statusLabel = getActivityStatusLabel(item.status, item.error);
            const statusTone = getActivityStatusTone(item.status, item.error);

            return (
              <div
                key={`${item.type}-${item.id}`}
                className="rounded-[8px] border border-[#DDE4DC] bg-[#F7F8F5] p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[#17211B]">
                      {title}
                    </p>
                    <p className="mt-1 text-xs text-[#66736B]">
                  {isSwap ? (isSell ? "Desde" : "Destino") : "A"}{" "}
                      {formatActivityRecipient(item.recipientAddress)}
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusTone}`}
                  >
                    {statusLabel}
                  </span>
                </div>
                <p className="mt-3 text-lg font-semibold text-[#0E7C4F]">
                  {isSwap && !isSell ? "+" : "-"}
                  {formatPesoAmountFromString(item.amount)} pesos
                </p>
                <div className="mt-1 flex items-center justify-between gap-3 text-xs text-[#66736B]">
                  <span>{formatActivityDate(item.createdAt)}</span>
                  {item.txHash ? (
                    <a
                      href={`${explorerUrl}/tx/${item.txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="font-semibold text-[#6D45B8] underline-offset-2 hover:underline"
                    >
                      Ver tx
                    </a>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <Link
        href="/activity"
        className="mt-4 block h-11 rounded-[8px] bg-[#6D45B8] pt-3 text-center text-sm font-semibold text-white"
      >
        Ver historial completo
      </Link>
    </PanelShell>
  );
}

function DetailsPanel({
  approvalUsd,
  balanceCopm,
  balanceUsd,
  onClose,
  onReorder,
  onSpend,
  onTransfer,
  tokens,
}: {
  approvalUsd: number;
  balanceCopm: string;
  balanceUsd: number;
  onClose: () => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onSpend: () => void;
  onTransfer: () => void;
  tokens: PortfolioToken[];
}) {
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const draggingSymbolRef = useRef<string | null>(null);
  const [draggingSymbol, setDraggingSymbol] = useState<string | null>(null);
  const orderableTokenCount = tokens.filter((token) => tokenHasBalance(token)).length;
  const isOrderableToken = (token: PortfolioToken) => tokenHasBalance(token);

  const getTargetIndex = (clientY: number) => {
    for (let index = 0; index < tokens.length; index += 1) {
      if (!isOrderableToken(tokens[index])) continue;
      const row = rowRefs.current[tokens[index].symbol];
      if (!row) continue;

      const rect = row.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) return index;
    }

    for (let index = tokens.length - 1; index >= 0; index -= 1) {
      if (isOrderableToken(tokens[index])) return index;
    }

    return -1;
  };

  const getNextOrderableIndex = (index: number, direction: -1 | 1) => {
    for (
      let nextIndex = index + direction;
      nextIndex >= 0 && nextIndex < tokens.length;
      nextIndex += direction
    ) {
      if (isOrderableToken(tokens[nextIndex])) return nextIndex;
    }

    return -1;
  };

  const startDrag = (
    event: ReactPointerEvent<HTMLButtonElement>,
    symbol: string
  ) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    draggingSymbolRef.current = symbol;
    setDraggingSymbol(symbol);
  };

  const startTouchDrag = (
    event: ReactTouchEvent<HTMLButtonElement>,
    symbol: string
  ) => {
    event.preventDefault();
    draggingSymbolRef.current = symbol;
    setDraggingSymbol(symbol);
  };

  const endDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    draggingSymbolRef.current = null;
    setDraggingSymbol(null);
  };

  const endTouchDrag = () => {
    draggingSymbolRef.current = null;
    setDraggingSymbol(null);
  };

  useEffect(() => {
    if (!draggingSymbol) return;

    const moveDragTo = (clientY: number) => {
      const symbol = draggingSymbolRef.current;
      if (!symbol) return;

      const fromIndex = tokens.findIndex((token) => token.symbol === symbol);
      const toIndex = getTargetIndex(clientY);
      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return;
      onReorder(fromIndex, toIndex);
    };

    const movePointerDrag = (event: PointerEvent) => {
      moveDragTo(event.clientY);
    };

    const moveTouchDrag = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      event.preventDefault();
      moveDragTo(touch.clientY);
    };

    const cancelDrag = () => {
      draggingSymbolRef.current = null;
      setDraggingSymbol(null);
    };

    window.addEventListener("pointermove", movePointerDrag);
    window.addEventListener("pointerup", cancelDrag);
    window.addEventListener("pointercancel", cancelDrag);
    window.addEventListener("touchmove", moveTouchDrag, { passive: false });
    window.addEventListener("touchend", cancelDrag);
    window.addEventListener("touchcancel", cancelDrag);

    return () => {
      window.removeEventListener("pointermove", movePointerDrag);
      window.removeEventListener("pointerup", cancelDrag);
      window.removeEventListener("pointercancel", cancelDrag);
      window.removeEventListener("touchmove", moveTouchDrag);
      window.removeEventListener("touchend", cancelDrag);
      window.removeEventListener("touchcancel", cancelDrag);
    };
  }, [draggingSymbol, onReorder, tokens]);

  return (
    <PanelShell title="Detalles" onClose={onClose}>
      <div className="flex items-center gap-3 rounded-[8px] border border-[#DDD2F3] bg-[#F2ECFF] p-3 text-[#6D45B8]">
        <img
          src={COPM_ICON_URL}
          alt="COPm"
          className="h-10 w-10 shrink-0 rounded-full"
        />
        <div className="min-w-0">
          <p className="text-xs font-semibold">Balance COPm</p>
          <p className="mt-1 text-xl font-semibold text-[#17211B]">
            {balanceCopm} pesos
          </p>
          <p className="text-sm font-medium text-[#6D45B8]">
            {formatUsd(balanceUsd)} USD aprox.
          </p>
        </div>
      </div>

      <div className="mt-4">
        <p className="mb-2 text-xs font-semibold uppercase text-[#66736B]">
          Prioridad de gasto
        </p>
        <div className="space-y-2">
          {tokens.map((token, index) => {
            const hasBalance = tokenHasBalance(token);
            const canReorder = hasBalance && orderableTokenCount > 1;
            const previousOrderableIndex = getNextOrderableIndex(index, -1);
            const nextOrderableIndex = getNextOrderableIndex(index, 1);

            return (
              <div
                key={token.symbol}
                ref={(element) => {
                  rowRefs.current[token.symbol] = element;
                }}
                className={`flex min-h-[58px] items-center gap-2 rounded-[8px] bg-[#F7F8F5] px-3 py-2 text-sm transition ${
                  draggingSymbol === token.symbol ? "scale-[0.99] shadow-sm" : ""
                } ${hasBalance ? "" : "opacity-45"}`}
              >
                <button
                  type="button"
                  aria-label={`Arrastrar ${token.symbol}`}
                  disabled={!canReorder}
                  className="touch-none rounded-full p-1 text-[#9AA69D] enabled:cursor-grab enabled:active:cursor-grabbing enabled:active:text-[#6D45B8] disabled:cursor-not-allowed disabled:opacity-40"
                  onPointerDown={(event) => startDrag(event, token.symbol)}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onTouchStart={(event) => startTouchDrag(event, token.symbol)}
                  onTouchEnd={endTouchDrag}
                  onTouchCancel={endTouchDrag}
                >
                  <GripVertical className="h-5 w-5" />
                </button>
                <TokenMark token={token} />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">{token.symbol}</p>
                  <p className="truncate text-xs text-[#66736B]">
                    {token.balanceDisplay ?? formatUsd(token.balanceUsd)}
                  </p>
                </div>
                <div className="flex flex-col gap-1">
                  <MoveButton
                    label={`Subir ${token.symbol}`}
                    disabled={!canReorder || previousOrderableIndex === -1}
                    onClick={() => onReorder(index, previousOrderableIndex)}
                    direction="up"
                  />
                  <MoveButton
                    label={`Bajar ${token.symbol}`}
                    disabled={!canReorder || nextOrderableIndex === -1}
                    onClick={() => onReorder(index, nextOrderableIndex)}
                    direction="down"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-4 rounded-[8px] bg-[#FFF6D8] p-3 text-sm font-semibold">
        Monto de permiso por token: hasta {formatUsd(approvalUsd)}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onTransfer}
          className="h-11 rounded-[8px] bg-[#6D45B8] text-sm font-semibold text-white"
        >
          Transferir
        </button>
        <button
          type="button"
          onClick={onSpend}
          disabled
          className="h-11 rounded-[8px] bg-[#E9DFFC] text-sm font-semibold text-[#6D45B8] opacity-60"
        >
          Gastar
        </button>
      </div>
    </PanelShell>
  );
}

function CopmChartPanel({
  balanceCopm,
  balanceUsd,
  copPerUsd,
  copVsUsdChange,
  onClose,
}: {
  balanceCopm: string;
  balanceUsd: number;
  copPerUsd: number;
  copVsUsdChange: number | null;
  onClose: () => void;
}) {
  return (
    <PanelShell title="USD/COP" onClose={onClose}>
      <CompactCopmRateChart
        copPerUsd={copPerUsd}
        copVsUsdChange={copVsUsdChange}
      />
      <div className="mt-4 rounded-[8px] bg-[#F7F8F5] p-3">
        <p className="text-xs font-medium text-[#66736B]">Mi balance</p>
        <p className="mt-1 text-xl font-semibold">{balanceCopm} COPm</p>
        <p className="text-sm font-medium text-[#66736B]">
          {formatUsd(balanceUsd)} USD aprox.
        </p>
      </div>
    </PanelShell>
  );
}

function ActionModeTabs({
  mode,
  onChange,
}: {
  mode: ActionMode;
  onChange: (mode: ActionMode) => void;
}) {
  return (
    <div className="mb-3 grid grid-cols-2 gap-2 rounded-[8px] bg-white p-1">
      {(["buy", "transfer"] as const).map((item) => (
        <button
          key={item}
          type="button"
          onClick={() => onChange(item)}
          className={`h-10 rounded-[8px] text-sm font-semibold ${
            mode === item
              ? "bg-[#6D45B8] text-white"
              : "bg-[#F7F8F5] text-[#66736B]"
          }`}
        >
          {item === "buy" ? "Obtener pesos" : "Enviar pesos"}
        </button>
      ))}
    </div>
  );
}

function ButtonSpinner() {
  return (
    <span
      className="h-4 w-4 animate-spin rounded-full border-2 border-white/45 border-t-white"
      aria-hidden="true"
    />
  );
}

const rateChartIntervals: RateChartInterval[] = ["1w", "1m", "1y", "5y", "max"];

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getSparklineY(value: number, min: number, max: number, height = 132) {
  const range = max - min || 1;
  return 4 + height - ((value - min) / range) * height;
}

function getSparklinePoints(
  values: number[],
  width = 720,
  height = 132,
  minValue = Math.min(...values),
  maxValue = Math.max(...values)
) {
  const range = maxValue - minValue || 1;

  return values.map((value, index) => {
    const x = 2 + (index / Math.max(values.length - 1, 1)) * (width - 4);
    const y = 4 + height - ((value - minValue) / range) * height;
    return { x, y };
  });
}

function buildSmoothSparklinePath(points: { x: number; y: number }[]) {
  if (points.length < 2) return "";

  return points.reduce((path, point, index) => {
    if (index === 0) return `M ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;

    const previous = points[index - 1];
    const controlX = previous.x + (point.x - previous.x) / 2;
    return `${path} C ${controlX.toFixed(2)} ${previous.y.toFixed(2)}, ${controlX.toFixed(2)} ${point.y.toFixed(2)}, ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
  }, "");
}

function getFallbackRateChartValues(copPerUsd: number) {
  return Array.from({ length: 8 }, () => copPerUsd);
}

function getPairRateValues(copPerUsdValues: number[], pair: RateChartPair) {
  if (pair === "usd-cop") return copPerUsdValues;
  return copPerUsdValues.map((value) => (value > 0 ? 1 / value : 0));
}

function getRateChange(values: number[]) {
  const first = values[0];
  const last = values[values.length - 1];
  if (!first || !last) return 0;

  return ((last - first) / first) * 100;
}

function getProjectedRateValue(values: number[]) {
  if (values.length < 2) return values[0] ?? 0;

  const last = values[values.length - 1];
  const lookbackSize = Math.max(2, Math.ceil(values.length * 0.35));
  const recent = values.slice(-lookbackSize);
  const recentDelta = last - recent[0];
  const maxProjectedMove = Math.abs(last) * 0.04;

  return last + clamp(recentDelta * 0.4, -maxProjectedMove, maxProjectedMove);
}

function CompactCopmRateChart({
  copPerUsd,
  copVsUsdChange,
  defaultPair = "cop-usd",
}: {
  copPerUsd: number;
  copVsUsdChange: number | null;
  defaultPair?: RateChartPair;
}) {
  const [interval, setInterval] = useState<RateChartInterval>("1w");
  const [pair, setPair] = useState<RateChartPair>(defaultPair);
  const [historyByInterval, setHistoryByInterval] = useState<
    Partial<Record<RateChartInterval, RateChartPoint[]>>
  >({});
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState(false);
  const historyPoints = historyByInterval[interval];
  const rawCopPerUsdValues = historyPoints?.length
    ? historyPoints.map((point) => point.copPerUsd)
    : getFallbackRateChartValues(copPerUsd);
  const copPerUsdValues =
    rawCopPerUsdValues.length >= 2
      ? rawCopPerUsdValues
      : getFallbackRateChartValues(copPerUsd);
  const values = getPairRateValues(copPerUsdValues, pair);
  const projectedValue = getProjectedRateValue(values);
  const chartMin = Math.min(...values, projectedValue);
  const chartMax = Math.max(...values, projectedValue);
  const points = getSparklinePoints(values, 600, 132, chartMin, chartMax);
  const linePath = buildSmoothSparklinePath(points);
  const lastPoint = points[points.length - 1];
  const projectedPoint = lastPoint
    ? {
        x: 718,
        y: getSparklineY(projectedValue, chartMin, chartMax),
      }
    : undefined;
  const projectionPath =
    lastPoint && projectedPoint
      ? buildSmoothSparklinePath([lastPoint, projectedPoint])
      : "";
  const areaPath = linePath ? `${linePath} L 600 140 L 0 140 Z` : "";
  const fallbackChange =
    pair === "usd-cop" ? -(copVsUsdChange ?? 0) : (copVsUsdChange ?? 0);
  const intervalChange =
    historyPoints && historyPoints.length >= 2
      ? getRateChange(values)
      : fallbackChange;
  const isUp = intervalChange >= 0;
  const strokeColor = isUp ? "#0E7C4F" : "#B42318";
  const pairLabel = pair === "usd-cop" ? "USD/COP" : "COP/USD";
  const visibleRatePair = pair === "usd-cop" ? "cop-usd" : "usd-cop";
  const pairRate =
    visibleRatePair === "usd-cop"
      ? `1 USD = ${formatCopPerUsd(copPerUsd)} COP`
      : `1 COP = ${formatUsdPerCop(1 / copPerUsd)} USD`;

  useEffect(() => {
    if (historyByInterval[interval]) return;

    let cancelled = false;
    setIsLoadingHistory(true);
    setHistoryError(false);

    fetch(`/api/copm-rate-history?interval=${interval}`)
      .then((response) => (response.ok ? response.json() : undefined))
      .then(
        (
          data:
            | {
                points?: RateChartPoint[];
              }
            | undefined
        ) => {
          if (cancelled) return;
          const nextPoints = (data?.points ?? []).filter(
            (point) =>
              Number.isFinite(point.timestamp) &&
              Number.isFinite(point.copPerUsd)
          );
          if (!nextPoints.length) {
            setHistoryError(true);
            return;
          }
          setHistoryByInterval((current) => ({
            ...current,
            [interval]: nextPoints,
          }));
        }
      )
      .catch(() => {
        if (!cancelled) setHistoryError(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingHistory(false);
      });

    return () => {
      cancelled = true;
    };
  }, [historyByInterval, interval]);

  return (
    <div className="mb-3 rounded-[8px] border border-[#DDE4DC] bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="inline-grid grid-cols-2 gap-1 rounded-full bg-[#F7F8F5] p-1">
            {([
              ["cop-usd", "COP/USD"],
              ["usd-cop", "USD/COP"],
            ] as const).map(([item, label]) => (
              <button
                key={item}
                type="button"
                onClick={() => setPair(item)}
                className={`h-7 rounded-full px-2.5 text-[11px] font-semibold ${
                  pair === item
                    ? "bg-[#E9DFFC] text-[#56359A]"
                    : "text-[#66736B]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="mt-1 text-xs font-medium text-[#66736B]">
            {pairRate}
          </p>
        </div>
        {Math.abs(intervalChange) > 0.001 ? (
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
              isUp ? "bg-[#E6F4EE] text-[#0E7C4F]" : "bg-[#FDECEC] text-[#B42318]"
            }`}
          >
            {isUp ? "▲" : "▼"} {formatRateChange(intervalChange)}%{" "}
            {interval.toUpperCase()}
          </span>
        ) : isLoadingHistory ? (
          <span className="rounded-full bg-[#F7F8F5] px-2.5 py-1 text-xs font-semibold text-[#66736B]">
            Cargando
          </span>
        ) : null}
      </div>

      <svg
        viewBox="0 0 720 140"
        className="mt-3 h-36 w-full overflow-visible"
        role="img"
        aria-label={`Movimiento ${pairLabel}`}
      >
        <defs>
          <linearGradient id="copm-rate-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={strokeColor} stopOpacity="0.2" />
            <stop offset="100%" stopColor={strokeColor} stopOpacity="0" />
          </linearGradient>
          <filter id="copm-rate-glow" x="-10%" y="-40%" width="120%" height="180%">
            <feGaussianBlur stdDeviation="1.4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {areaPath ? <path d={areaPath} fill="url(#copm-rate-fill)" /> : null}
        {linePath ? (
          <path
            d={linePath}
            fill="none"
            stroke={strokeColor}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2.25"
            filter="url(#copm-rate-glow)"
          />
        ) : null}
        {projectionPath ? (
          <path
            d={projectionPath}
            fill="none"
            stroke={strokeColor}
            strokeDasharray="7 8"
            strokeLinecap="round"
            strokeWidth="2"
            opacity="0.55"
          />
        ) : null}
      </svg>

      <div className="mt-3 grid grid-cols-5 gap-1 rounded-full bg-[#F7F8F5] p-1">
        {rateChartIntervals.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setInterval(item)}
            className={`h-8 rounded-full text-xs font-semibold ${
              interval === item
                ? "bg-[#E9DFFC] text-[#56359A]"
                : "text-[#66736B]"
            }`}
          >
            {item.toUpperCase()}
          </button>
        ))}
      </div>
      {historyError ? (
        <p className="mt-2 text-xs font-medium text-[#66736B]">
          No pudimos actualizar el histórico. Mostramos el tipo de cambio actual.
        </p>
      ) : null}
    </div>
  );
}

function BuyCopmScreen({
  copAmount,
  copRateChange,
  copPerUsd,
  hasCompatibleTokens,
  isMiniPay,
  isLive,
  totalUsd,
  detailsOpen,
  swapError,
  swapProgress,
  swapStatus,
  swapFeeUsd,
  shortfallQuote,
  tokenPrices,
  tokens,
  activating,
  approvalTargets,
  recipientAddress,
  recipientMode,
  savedRecipients,
  onAmountChange,
  onApprovePurchase,
  onBuy,
  onChangeTokenOrder,
  onDetailsToggle,
  onRecipientAddressChange,
  onRecipientSaved,
  onRemoveRecipient,
  onSaveRecipient,
  onRecipientModeChange,
}: {
  copAmount: string;
  copRateChange?: number;
  copPerUsd: number;
  hasCompatibleTokens: boolean;
  isMiniPay: boolean;
  isLive: boolean;
  totalUsd: number;
  detailsOpen: boolean;
  swapError: string | null;
  swapProgress: SwapProgress;
  swapStatus: SwapStatus;
  swapFeeUsd: number | null;
  shortfallQuote: ShortfallQuote | null;
  tokenPrices: TokenUsdPrices;
  tokens: PortfolioToken[];
  activating: string | null;
  approvalTargets: Partial<Record<string, Address>>;
  recipientAddress: string;
  recipientMode: "self" | "other";
  savedRecipients: SavedRecipient[];
  onAmountChange: (value: string) => void;
  onApprovePurchase: () => void;
  onBuy: () => void;
  onChangeTokenOrder: () => void;
  onDetailsToggle: () => void;
  onRecipientAddressChange: (value: string) => void;
  onRecipientSaved: () => void;
  onRemoveRecipient: (address: string) => void;
  onSaveRecipient: (address: string, alias: string) => SaveRecipientResult;
  onRecipientModeChange: (mode: "self" | "other") => void;
}) {
  const hasNoFunds = isLive && !hasCompatibleTokens;
  const requestedUsd = getPurchaseUsdAmount(copAmount, copPerUsd);
  const isBelowMinimum = requestedUsd > 0 && requestedUsd < MIN_PURCHASE_USD;
  const missingUsd = Math.max(requestedUsd - totalUsd, 0);
  const hasInsufficientFunds =
    !hasNoFunds && missingUsd > USD_PLAN_TOLERANCE;
  const selectedToken = getSwapSourceToken(tokens, tokenPrices, requestedUsd);
  const approvedPlan = getApprovedSwapPlan(tokens, tokenPrices, requestedUsd);
  const approvedPlanUsd = getSwapPlanUsd(approvedPlan);
  const hasApprovedPlan =
    approvedPlanUsd + USD_PLAN_TOLERANCE >= requestedUsd;
  const detailPlan = approvedPlan.length
    ? approvedPlan
    : getApprovedSwapPlan(tokens, tokenPrices, Math.min(requestedUsd, totalUsd));
  const approvalToken =
    selectedToken ??
    getSwapApprovalCandidate(tokens, tokenPrices, requestedUsd)?.token;
  const needsApprovedToken =
    isLive &&
    !hasNoFunds &&
    !isBelowMinimum &&
    !hasInsufficientFunds &&
    !hasApprovedPlan;
  const isPreparingApproval =
    needsApprovedToken &&
    (approvalToken ? !approvalTargets[approvalToken.symbol] : false);
  const canApprovePurchase =
    Boolean(approvalToken && approvalTargets[approvalToken.symbol]) &&
    needsApprovedToken &&
    requestedUsd > 0;
  const normalizedRecipientAddress = recipientAddress.trim();
  const hasValidRecipient =
    recipientMode === "self" || isAddress(normalizedRecipientAddress);
  const usesMiniPayRecipientFallback =
    isMiniPay && recipientMode === "other" && hasValidRecipient;
  const canBuy =
    !hasNoFunds &&
    !isBelowMinimum &&
    !hasInsufficientFunds &&
    !needsApprovedToken &&
    hasValidRecipient &&
    requestedUsd > 0;
  const liquidityError = swapError
    ? getWalletActionErrorCopy(new Error(swapError), "buy").isNoLiquidity
    : false;
  const isBusy = swapStatus === "quoting" || swapStatus === "buying";
  const isApproving = Boolean(activating && approvalToken?.symbol === activating);
  const showButtonSpinner = isBusy || isApproving;
  const buttonLabel =
    isApproving
      ? "Confirma en tu wallet"
      : needsApprovedToken
        ? isPreparingApproval
          ? "Preparando permiso"
          : "Activar token"
        : swapProgress === "quoting"
          ? "Cotizando"
          : swapProgress === "confirming"
            ? "Confirma en tu wallet"
            : swapProgress === "processing"
              ? "Procesando compra"
              : swapStatus === "complete"
                ? "Completado"
                : shortfallQuote?.copAmount === copAmount
                  ? `Obtener ${shortfallQuote.quotedCopm} pesos`
                  : "Obtener pesos";
  const progressMessage =
    swapProgress === "confirming"
      ? "Confirma la transaccion en tu wallet para iniciar la compra."
      : swapProgress === "processing"
        ? "Tu transaccion fue enviada. Estamos esperando confirmacion y actualizando tu balance."
      : swapProgress === "quoting"
        ? "Estamos buscando la mejor ruta disponible."
        : null;
  const copVsUsdChange =
    typeof copRateChange === "number" && Number.isFinite(copRateChange)
      ? -copRateChange
      : null;

  return (
    <div className="flex flex-1 flex-col">
      {isLive ? (
        <CompactCopmRateChart
          copPerUsd={copPerUsd}
          copVsUsdChange={copVsUsdChange}
        />
      ) : null}

      <div className="rounded-[8px] border border-[#DDE4DC] bg-white p-4">
        <p className="text-sm font-medium text-[#66736B]">Disponible para convertir</p>
        <p className="mt-1 text-2xl font-semibold leading-none">
          {formatUsd(totalUsd)}{" "}
          <span className="text-sm font-medium text-[#66736B]">aprox.</span>
        </p>
        <div className="mt-3 flex items-center justify-between gap-3 text-xs font-semibold text-[#66736B]">
          <span>Tipo de cambio</span>
          <span className="flex items-center gap-2">
            1 USD = {formatCopPerUsd(copPerUsd)} COPm
            {copVsUsdChange !== null && Math.abs(copVsUsdChange) > 0.001 ? (
              <span
                className={
                  copVsUsdChange > 0 ? "text-[#0E7C4F]" : "text-[#B42318]"
                }
              >
                {copVsUsdChange > 0 ? "▲" : "▼"}{" "}
                {formatRateChange(copVsUsdChange)}% 24h
              </span>
            ) : null}
          </span>
        </div>
      </div>

      <div className="mt-3 rounded-[8px] border border-[#DDE4DC] bg-white p-4">
        <label
          htmlFor="cop-amount"
          className="block text-sm font-semibold text-[#17211B]"
        >
          ¿Cuántos pesos necesitas?
        </label>
        <input
          id="cop-amount"
          inputMode="numeric"
          value={copAmount}
          onChange={(event) => onAmountChange(event.target.value)}
          className="mt-2 h-[52px] w-full rounded-[8px] border border-[#DDE4DC] bg-[#F7F8F5] px-4 text-2xl font-semibold outline-none ring-[#0E7C4F] focus:ring-2"
        />
        <p className="mt-2 text-xs font-medium text-[#66736B]">
          Equivale a {formatUsd(requestedUsd)} USD aprox.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onRecipientModeChange("self")}
            className={`h-10 rounded-[8px] text-sm font-semibold ${
              recipientMode === "self"
                ? "bg-[#E9DFFC] text-[#56359A]"
                : "bg-[#F7F8F5] text-[#66736B]"
            }`}
          >
            Para mí
          </button>
          <button
            type="button"
            onClick={() => onRecipientModeChange("other")}
            className={`h-10 rounded-[8px] text-sm font-semibold ${
              recipientMode === "other"
                ? "bg-[#E9DFFC] text-[#56359A]"
                : "bg-[#F7F8F5] text-[#66736B]"
            }`}
          >
            Enviar a alguien
          </button>
        </div>
        {recipientMode === "other" && (
          <RecipientAddressInput
            address={recipientAddress}
            savedRecipients={savedRecipients}
            warning="Verifica esta wallet. Si envías pesos a una wallet equivocada, no podremos revertirlo."
            onChange={onRecipientAddressChange}
            onRemoveRecipient={onRemoveRecipient}
            onSaveRecipient={onSaveRecipient}
            onRecipientSaved={onRecipientSaved}
          />
        )}
        {(hasNoFunds || hasInsufficientFunds) && (
          <div className="mt-3 rounded-[8px] bg-[#FFF6D8] px-3 py-2 text-sm font-medium leading-5 text-[#17211B]">
            {hasNoFunds
              ? "No encontramos tokens compatibles para comprar COPm."
              : `Te faltan ${formatUsd(missingUsd)} aprox. para comprar esta cantidad de COPm.`}
          </div>
        )}
        {isBelowMinimum && (
          <div className="mt-3 rounded-[8px] bg-[#FFF6D8] px-3 py-2 text-sm font-medium leading-5 text-[#17211B]">
            La compra minima es de {formatUsd(MIN_PURCHASE_USD)} USD aprox.
          </div>
        )}
        {needsApprovedToken && (
          <div className="mt-3 rounded-[8px] bg-[#FFF6D8] px-3 py-2 text-sm font-medium leading-5 text-[#17211B]">
            Activa permiso suficiente para comprar este monto de COPm.
          </div>
        )}
        {approvedPlan.length > 1 && canBuy && (
          <div className="mt-3 rounded-[8px] bg-[#FFF6D8] px-3 py-2 text-sm font-medium leading-5 text-[#17211B]">
            Esta compra usará {getSwapPlanTokenSymbols(approvedPlan)} y requiere{" "}
            {approvedPlan.length} confirmaciones.
          </div>
        )}
        {usesMiniPayRecipientFallback && canBuy && (
          <div className="mt-3 rounded-[8px] bg-[#FFF6D8] px-3 py-2 text-sm font-medium leading-5 text-[#17211B]">
            En MiniPay esta compra requiere {approvedPlan.length + 1}{" "}
            confirmaciones: primero recibes los pesos y luego los enviamos a la
            wallet destino.
          </div>
        )}
        {swapError && (
          <div className="mt-3 rounded-[8px] bg-[#FDECEC] px-3 py-2 text-sm font-medium leading-5 text-[#8A1F1F]">
            {swapError}
          </div>
        )}
        {shortfallQuote?.copAmount === copAmount && (
          <div className="mt-3 rounded-[8px] bg-[#FFF6D8] px-3 py-2 text-sm font-medium leading-5 text-[#17211B]">
            {shortfallQuote.message} Ajusta el monto a{" "}
            {formatUsd(shortfallQuote.quotedUsd)} USD aprox. o continua con esta
            cotizacion.
          </div>
        )}

        <div
          className={`mt-3 rounded-[8px] p-4 ${
            canBuy ? "bg-[#E6F4EE]" : "bg-[#F2F5F1]"
          }`}
        >
          <p className="text-sm font-medium text-[#66736B]">Recibirás</p>
          <p
            className={`mt-1 text-[28px] font-semibold leading-tight ${
              canBuy ? "text-[#0E7C4F]" : "text-[#66736B]"
            }`}
          >
            {formatPesoAmountFromString(copAmount || "0")} pesos
          </p>
          <p className="mt-1 text-xs text-[#66736B]">
            Equivalente en COPm onchain
          </p>
        </div>

        {!liquidityError ? (
          <Button
            className="mt-4 h-12 w-full gap-2 rounded-[8px] bg-[#6D45B8] text-base font-semibold text-white hover:bg-[#56359A] disabled:bg-[#C8B9E8]"
            disabled={isBusy || isApproving || (!canBuy && !canApprovePurchase)}
            onClick={needsApprovedToken ? onApprovePurchase : onBuy}
          >
            {showButtonSpinner ? <ButtonSpinner /> : null}
            {buttonLabel}
          </Button>
        ) : (
          <div className="mt-4 rounded-[8px] border border-[#DDE4DC] bg-[#F7F8F5] px-3 py-3 text-sm font-medium text-[#66736B]">
            Espera un momento y vuelve a intentar cuando haya más liquidez disponible.
          </div>
        )}
        {progressMessage && (
          <p className="mt-3 text-center text-sm font-medium text-[#66736B]">
            {progressMessage}
          </p>
        )}
      </div>

      <div className="mt-3 overflow-hidden rounded-[8px] border border-[#DDE4DC] bg-white">
        <button
          type="button"
          className="flex h-14 w-full items-center justify-between px-4 text-sm font-semibold"
          onClick={onDetailsToggle}
        >
          Detalles avanzados
          {detailsOpen ? (
            <ChevronUp className="h-5 w-5 text-[#66736B]" />
          ) : (
            <ChevronDown className="h-5 w-5 text-[#66736B]" />
          )}
        </button>

        {detailsOpen && (
          <div className="border-t border-[#DDE4DC] px-4 py-4">
            <button
              type="button"
              onClick={onChangeTokenOrder}
              className="mb-4 text-sm font-semibold text-[#6D45B8] underline-offset-2 hover:underline"
            >
              Cambiar orden de pago
            </button>
            <p className="mb-3 text-xs font-medium text-[#66736B]">
              Tipo de cambio: 1 USD = {formatCopPerUsd(copPerUsd)} pesos
            </p>
            <p className="mb-3 text-xs font-semibold uppercase text-[#66736B]">
              Usaremos
            </p>
            <div className="space-y-2">
              {(detailPlan.length ? detailPlan : approvedPlan).map((leg) => (
                <div
                  key={leg.token.symbol}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: leg.token.color }}
                    />
                    {leg.token.symbol}
                  </span>
                  <span className="font-medium">
                    {formatUsd(leg.usdAmount)}
                  </span>
                </div>
              ))}
              {!detailPlan.length && !approvedPlan.length && (
                <p className="text-sm font-medium text-[#66736B]">
                  Activa un token para ver el detalle.
                </p>
              )}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-[8px] bg-[#F7F8F5] p-3">
                <p className="text-xs text-[#66736B]">
                  Fee Squid {(SQUID_INTEGRATOR_FEE_BPS / 100).toFixed(2)}%
                </p>
                <p className="mt-1 font-semibold">
                  {swapFeeUsd === null ? "Por cotizar" : formatUsd(swapFeeUsd)}
                </p>
                <p className="mt-1 text-[11px] font-medium text-[#66736B]">
                  Split {SQUID_INTEGRATOR_FEE_SPLIT}
                </p>
              </div>
              <div className="rounded-[8px] bg-[#F7F8F5] p-3">
                <p className="text-xs text-[#66736B]">Slippage max</p>
                <p className="mt-1 font-semibold">
                  {purchasePreview.slippageLabel}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TokenMark({ token }: { token: PortfolioToken }) {
  return (
    <div
      className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-xs font-bold text-white"
      style={{ backgroundColor: token.color }}
    >
      {token.symbol.slice(0, 2)}
    </div>
  );
}

function RecipientAddressInput({
  address,
  savedRecipients,
  warning,
  onChange,
  onSaveRecipient,
  onRemoveRecipient,
  onRecipientSaved,
}: {
  address: string;
  savedRecipients: SavedRecipient[];
  warning: string;
  onChange: (value: string) => void;
  onSaveRecipient?: (address: string, alias: string) => SaveRecipientResult;
  onRemoveRecipient?: (address: string) => void;
  onRecipientSaved?: () => void;
}) {
  const [aliasDraft, setAliasDraft] = useState("");
  const [saveFeedback, setSaveFeedback] = useState<string | null>(null);
  const selectedRecipient = savedRecipients.find(
    (item) => item.address === address.toLowerCase()
  );
  const isSaved = Boolean(selectedRecipient);
  const atLimit = savedRecipients.length >= MAX_SAVED_RECIPIENTS && !isSaved;

  useEffect(() => {
    setAliasDraft(selectedRecipient?.alias ?? "");
    setSaveFeedback(null);
  }, [address, selectedRecipient?.alias]);

  const handleSave = () => {
    if (!isAddress(address) || !onSaveRecipient) return;

    const result = onSaveRecipient(address, aliasDraft);
    if (result.ok) {
      onRecipientSaved?.();
      setSaveFeedback(isSaved ? "Destinatario actualizado" : "Destinatario guardado");
      window.setTimeout(() => setSaveFeedback(null), 1800);
      return;
    }

    if (result.reason === "limit") {
      setSaveFeedback(`Máximo ${MAX_SAVED_RECIPIENTS} destinatarios. Elimina uno para agregar otro.`);
    }
  };

  return (
    <div className="mt-3 space-y-2">
      <input
        inputMode="text"
        placeholder="0x..."
        value={address}
        onChange={(event) => onChange(event.target.value)}
        className="h-11 w-full rounded-[8px] border border-[#DDE4DC] bg-[#F7F8F5] px-3 font-mono text-sm outline-none ring-[#6D45B8] focus:ring-2"
      />
      {isAddress(address) && onSaveRecipient && (
        <div className="flex gap-2">
          <input
            inputMode="text"
            placeholder="Nombre (opcional), ej. Mamá"
            value={aliasDraft}
            onChange={(event) => setAliasDraft(event.target.value)}
            className="h-10 min-w-0 flex-1 rounded-[8px] border border-[#DDE4DC] bg-white px-3 text-sm outline-none ring-[#6D45B8] focus:ring-2"
          />
          <button
            type="button"
            onClick={handleSave}
            disabled={atLimit}
            aria-label={isSaved ? "Actualizar destinatario guardado" : "Guardar destinatario"}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-[8px] border border-[#DDE4DC] bg-white text-[#6D45B8] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Bookmark className={`h-4 w-4 ${isSaved ? "fill-current" : ""}`} />
          </button>
        </div>
      )}
      {saveFeedback && (
        <p className="text-xs font-medium text-[#66736B]">{saveFeedback}</p>
      )}
      {savedRecipients.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {savedRecipients.map((recipient) => (
            <div
              key={recipient.address}
              className="inline-flex max-w-full items-center gap-0.5 rounded-full bg-[#F7F8F5] pl-3 pr-1 py-1"
            >
              <button
                type="button"
                onClick={() => onChange(recipient.address)}
                className="min-w-0 truncate text-left text-xs font-semibold text-[#66736B]"
              >
                {recipient.alias
                  ? `${recipient.alias} · ${formatAddressPreview(recipient.address)}`
                  : formatAddressPreview(recipient.address)}
              </button>
              <button
                type="button"
                aria-label="Eliminar destinatario"
                onClick={() => onRemoveRecipient?.(recipient.address)}
                className="grid h-5 w-5 shrink-0 place-items-center rounded-full text-[#66736B] hover:bg-[#DDE4DC]"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="rounded-[8px] bg-[#FFF6D8] px-3 py-2 text-xs font-semibold leading-5 text-[#17211B]">
        {warning}
      </p>
    </div>
  );
}

function SellCopmScreen({
  amount,
  balance,
  copPerUsd,
  copRateChange,
  error,
  isLive,
  isMiniPay,
  recipientAddress,
  recipientMode,
  receivedUsdt,
  savedRecipients,
  status,
  tokenDecimals,
  txHash,
  txUrl,
  onAmountChange,
  onMax,
  onRecipientAddressChange,
  onRecipientModeChange,
  onRecipientSaved,
  onRemoveRecipient,
  onSaveRecipient,
  onSell,
}: {
  amount: string;
  balance?: bigint;
  copPerUsd: number;
  copRateChange?: number;
  error: string | null;
  isLive: boolean;
  isMiniPay: boolean;
  recipientAddress: string;
  recipientMode: "self" | "other";
  receivedUsdt: string | null;
  savedRecipients: SavedRecipient[];
  status: SellStatus;
  tokenDecimals: number;
  txHash: string | null;
  txUrl?: string;
  onAmountChange: (value: string) => void;
  onMax: () => void;
  onRecipientAddressChange: (value: string) => void;
  onRecipientModeChange: (mode: "self" | "other") => void;
  onRecipientSaved: () => void;
  onRemoveRecipient: (address: string) => void;
  onSaveRecipient: (address: string, alias: string) => SaveRecipientResult;
  onSell: () => void;
}) {
  const balanceDisplay =
    balance === undefined ? "0" : formatCopmUnits(balance, tokenDecimals);
  const balanceUsd =
    balance === undefined
      ? 0
      : Number(formatUnits(balance, tokenDecimals)) / copPerUsd;
  const amountNumber = parseCopAmount(amount);
  const amountUnits =
    amountNumber > 0 ? parseCopmUnits(amount, tokenDecimals) : 0n;
  const estimatedUsdt = amountNumber > 0 ? amountNumber / copPerUsd : 0;
  const hasInsufficientBalance =
    balance !== undefined && amountUnits > balance;
  const isBusy = ["quoting", "approving", "confirming", "processing"].includes(status);
  const normalizedRecipientAddress = recipientAddress.trim();
  const hasValidRecipient =
    recipientMode === "self" || isAddress(normalizedRecipientAddress);
  const usesMiniPayRecipientFallback =
    isMiniPay && recipientMode === "other" && hasValidRecipient;
  const buttonLabel =
    status === "quoting"
      ? "Cotizando"
      : status === "approving"
        ? "Aprobando COPm"
        : status === "confirming"
        ? "Confirma en tu wallet"
        : status === "processing"
          ? "Vendiendo COPm"
          : "Vender COPm";
  const canSell =
    amountNumber > 0 && !hasInsufficientBalance && hasValidRecipient && !isBusy;
  const liquidityError = error
    ? getWalletActionErrorCopy(new Error(error), "sell").isNoLiquidity
    : false;
  const copVsUsdChange =
    typeof copRateChange === "number" && Number.isFinite(copRateChange)
      ? -copRateChange
      : null;

  return (
    <div className="flex flex-1 flex-col">
      {isLive ? (
        <CompactCopmRateChart
          copPerUsd={copPerUsd}
          copVsUsdChange={copVsUsdChange}
          defaultPair="usd-cop"
        />
      ) : null}

      <div className="rounded-[8px] border border-[#DDE4DC] bg-white p-4">
        <p className="text-sm font-medium text-[#66736B]">
          Disponible para vender
        </p>
        <p className="mt-1 text-2xl font-semibold leading-none">
          {balanceDisplay}{" "}
          <span className="text-sm font-medium text-[#66736B]">COPm</span>
        </p>
        <div className="mt-3 flex items-center justify-between gap-3 text-xs font-semibold text-[#66736B]">
          <span>Equivale</span>
          <span>{formatUsd(balanceUsd)} USD aprox.</span>
        </div>
      </div>

      <div className="mt-3 rounded-[8px] border border-[#DDE4DC] bg-white p-4">
        <label className="block text-sm font-semibold text-[#17211B]">
          ¿Cuántos COPm quieres vender?
        </label>
        <div className="mt-2 flex gap-2">
          <input
            inputMode="numeric"
            value={amount}
            onChange={(event) => onAmountChange(event.target.value)}
            className="h-[52px] min-w-0 flex-1 rounded-[8px] border border-[#DDE4DC] bg-[#F7F8F5] px-4 text-2xl font-semibold outline-none ring-[#6D45B8] focus:ring-2"
          />
          <button
            type="button"
            onClick={onMax}
            className="h-[52px] rounded-[8px] bg-[#E9DFFC] px-4 text-sm font-semibold text-[#56359A]"
          >
            Max
          </button>
        </div>
        <p className="mt-2 text-xs font-medium text-[#66736B]">
          Equivale a {formatUsd(estimatedUsdt)} USD aprox.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onRecipientModeChange("self")}
            className={`h-10 rounded-[8px] text-sm font-semibold ${
              recipientMode === "self"
                ? "bg-[#E9DFFC] text-[#56359A]"
                : "bg-[#F7F8F5] text-[#66736B]"
            }`}
          >
            Para mí
          </button>
          <button
            type="button"
            onClick={() => onRecipientModeChange("other")}
            className={`h-10 rounded-[8px] text-sm font-semibold ${
              recipientMode === "other"
                ? "bg-[#E9DFFC] text-[#56359A]"
                : "bg-[#F7F8F5] text-[#66736B]"
            }`}
          >
            Enviar USDT
          </button>
        </div>
        {recipientMode === "other" && (
          <RecipientAddressInput
            address={recipientAddress}
            savedRecipients={savedRecipients}
            warning="Verifica esta wallet. Si envías USDT a una wallet equivocada, no podremos revertirlo."
            onChange={onRecipientAddressChange}
            onRemoveRecipient={onRemoveRecipient}
            onSaveRecipient={onSaveRecipient}
            onRecipientSaved={onRecipientSaved}
          />
        )}

        {hasInsufficientBalance && (
          <div className="mt-3 rounded-[8px] bg-[#FFF6D8] px-3 py-2 text-sm font-medium leading-5 text-[#17211B]">
            Saldo COPm insuficiente para vender esta cantidad.
          </div>
        )}
        {usesMiniPayRecipientFallback && canSell && (
          <div className="mt-3 rounded-[8px] bg-[#FFF6D8] px-3 py-2 text-sm font-medium leading-5 text-[#17211B]">
            En MiniPay esta venta requiere 2 confirmaciones: primero recibes USDT
            y luego lo enviamos a la wallet destino.
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-[8px] bg-[#FDECEC] px-3 py-2 text-sm font-medium leading-5 text-[#8A1F1F]">
            {error}
          </div>
        )}

        <div
          className={`mt-3 rounded-[8px] p-4 ${
            canSell ? "bg-[#E6F4EE]" : "bg-[#F2F5F1]"
          }`}
        >
          <p className="text-sm font-medium text-[#66736B]">Recibirás</p>
          <p
            className={`mt-1 text-[28px] font-semibold leading-tight ${
              canSell ? "text-[#0E7C4F]" : "text-[#66736B]"
            }`}
          >
            {receivedUsdt ?? formatUsd(estimatedUsdt).replace("$", "")} USDT
          </p>
          <p className="mt-1 text-xs text-[#66736B]">
            Equivalente en USD onchain
          </p>
        </div>

        {status === "complete" && (
          <div className="mt-3 rounded-[8px] bg-[#E6F4EE] px-3 py-2 text-sm font-medium leading-5 text-[#0E7C4F]">
            Venta completada. Recibiste {receivedUsdt ?? "USDT"} USDT.
            {txHash && txUrl ? (
              <a
                href={txUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 block font-semibold underline-offset-2 hover:underline"
              >
                Ver transacción {formatAddressPreview(txHash)}
              </a>
            ) : null}
          </div>
        )}

        {!liquidityError ? (
          <Button
            className="mt-4 h-12 w-full gap-2 rounded-[8px] bg-[#6D45B8] text-base font-semibold text-white hover:bg-[#56359A] disabled:bg-[#C8B9E8]"
            disabled={!canSell}
            onClick={onSell}
          >
            {isBusy ? <ButtonSpinner /> : null}
            {buttonLabel}
          </Button>
        ) : (
          <div className="mt-4 rounded-[8px] border border-[#DDE4DC] bg-[#F7F8F5] px-3 py-3 text-sm font-medium text-[#66736B]">
            Espera un momento y vuelve a intentar cuando haya más liquidez disponible.
          </div>
        )}
      </div>
    </div>
  );
}

function TransferCopmScreen({
  amount,
  balance,
  confirming,
  error,
  hasCopmBalance,
  recipientAddress,
  savedRecipients,
  status,
  tokenDecimals,
  onAmountChange,
  onGetPesos,
  onMax,
  onRecipientAddressChange,
  onRecipientSaved,
  onRemoveRecipient,
  onSaveRecipient,
  onSend,
}: {
  amount: string;
  balance?: bigint;
  confirming: boolean;
  error: string | null;
  hasCopmBalance: boolean;
  recipientAddress: string;
  savedRecipients: SavedRecipient[];
  status: TransferStatus;
  tokenDecimals: number;
  onAmountChange: (value: string) => void;
  onGetPesos: () => void;
  onMax: () => void;
  onRecipientAddressChange: (value: string) => void;
  onRecipientSaved: () => void;
  onRemoveRecipient: (address: string) => void;
  onSaveRecipient: (address: string, alias: string) => SaveRecipientResult;
  onSend: () => void;
}) {
  const balanceDisplay =
    balance === undefined ? "0" : formatCopmUnits(balance, tokenDecimals);
  const isBusy = status === "confirming" || status === "sending";
  const buttonLabel =
    status === "confirming"
      ? "Confirma en tu wallet"
      : status === "sending"
        ? "Enviando"
        : confirming
          ? "Enviar pesos"
          : "Continuar";

  if (!hasCopmBalance) {
    return (
      <div className="flex flex-1 flex-col">
        <div className="rounded-[8px] border border-[#DDE4DC] bg-white p-5">
          <h2 className="text-lg font-semibold">Aún no tienes pesos para enviar</h2>
          <p className="mt-2 text-sm text-[#66736B]">
            Primero convierte tus dólares de MiniPay en pesos y luego podrás enviarlos.
          </p>
          <Button
            className="mt-4 h-12 w-full rounded-[8px] bg-[#6D45B8] text-base font-semibold text-white hover:bg-[#56359A]"
            onClick={onGetPesos}
          >
            Obtener pesos
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="rounded-[8px] border border-[#DDE4DC] bg-white p-4">
        <p className="text-sm font-medium text-[#66736B]">Pesos disponibles</p>
        <p className="mt-1 text-2xl font-semibold leading-none">
          {balanceDisplay} <span className="text-sm font-medium text-[#66736B]">pesos</span>
        </p>
      </div>

      <div className="mt-3 rounded-[8px] border border-[#DDE4DC] bg-white p-4">
        <label className="block text-sm font-semibold text-[#17211B]">
          ¿A qué wallet?
        </label>
        <RecipientAddressInput
          address={recipientAddress}
          savedRecipients={savedRecipients}
          warning="Verifica esta wallet. Los envíos de pesos no se pueden revertir."
          onChange={onRecipientAddressChange}
          onRemoveRecipient={onRemoveRecipient}
          onSaveRecipient={onSaveRecipient}
          onRecipientSaved={onRecipientSaved}
        />

        <label className="mt-4 block text-sm font-semibold text-[#17211B]">
          Monto en pesos
        </label>
        <div className="mt-2 flex gap-2">
          <input
            inputMode="numeric"
            value={amount}
            onChange={(event) => onAmountChange(event.target.value)}
            className="h-[52px] min-w-0 flex-1 rounded-[8px] border border-[#DDE4DC] bg-[#F7F8F5] px-4 text-2xl font-semibold outline-none ring-[#6D45B8] focus:ring-2"
          />
          <button
            type="button"
            onClick={onMax}
            className="h-[52px] rounded-[8px] bg-[#E9DFFC] px-4 text-sm font-semibold text-[#56359A]"
          >
            Max
          </button>
        </div>

        {confirming && (
          <div className="mt-3 rounded-[8px] bg-[#FFF6D8] px-3 py-2 text-sm font-medium leading-5 text-[#17211B]">
            Enviarás {formatPesoAmountFromString(amount || "0")} pesos a{" "}
            {formatAddressPreview(recipientAddress)}. Verifica la wallet antes
            de confirmar.
          </div>
        )}
        {error && (
          <div className="mt-3 rounded-[8px] bg-[#FDECEC] px-3 py-2 text-sm font-medium leading-5 text-[#8A1F1F]">
            {error}
          </div>
        )}

        <Button
          className="mt-4 h-12 w-full rounded-[8px] bg-[#6D45B8] text-base font-semibold text-white hover:bg-[#56359A] disabled:bg-[#C8B9E8]"
          disabled={isBusy}
          onClick={onSend}
        >
          {buttonLabel}
        </Button>
      </div>
    </div>
  );
}

function toShareableReceiptData(result: SwapResult): ShareableReceiptData {
  return {
    amountLabel: result.amountLabel ?? (result.variant === "transfer" ? "Enviaste" : "Recibiste"),
    completedAt: result.completedAt,
    copmBalance: result.copmBalance,
    receivedCopm: result.receivedCopm,
    recipientAddress: result.recipientAddress,
    recipientAlias: result.recipientAlias,
    title: result.title ?? (result.variant === "transfer" ? "Envío completado" : "Conversión completada"),
    txHash: result.txHash,
    variant: result.variant === "transfer" ? "transfer" : "swap",
  };
}

function SwapSuccessModal({
  result,
  onClose,
}: {
  result: SwapResult;
  onClose: () => void;
}) {
  const { isMiniPay } = useWalletAdapter();
  const receiptRef = useRef<HTMLDivElement>(null);
  const [txIdCopied, setTxIdCopied] = useState(false);
  const [addressCopied, setAddressCopied] = useState(false);
  const [sharingReceipt, setSharingReceipt] = useState(false);
  const [receiptFeedback, setReceiptFeedback] = useState<string | null>(null);
  const useReceiptPdf = shouldUseReceiptPdf(isMiniPay);
  const isSell = result.variant === "sell";
  const isTransfer = result.variant === "transfer";
  const shareableReceipt = toShareableReceiptData(result);

  const shareTransactionId = async () => {
    const text = result.txUrl || result.txHash;
    if (!text) return;

    try {
      if (navigator.share) {
        await navigator.share({ text: `Transacción COP By: ${text}` });
        return;
      }
    } catch {
      // fall through to clipboard
    }

    await navigator.clipboard?.writeText(text);
    setTxIdCopied(true);
    window.setTimeout(() => setTxIdCopied(false), 1500);
  };

  const copyAddress = async () => {
    if (!result.recipientAddress) return;
    await navigator.clipboard?.writeText(result.recipientAddress);
    setAddressCopied(true);
    window.setTimeout(() => setAddressCopied(false), 1500);
  };

  const sendReceipt = async () => {
    setSharingReceipt(true);
    setReceiptFeedback(null);

    try {
      const blob = useReceiptPdf
        ? await createReceiptPdfBlob(shareableReceipt, result.txUrl)
        : await (async () => {
            if (!receiptRef.current) {
              throw new Error("Receipt element unavailable");
            }
            return createReceiptImageBlob(receiptRef.current);
          })();

      const outcome = await shareReceiptFile(blob, useReceiptPdf ? "pdf" : "png");
      setReceiptFeedback(
        outcome === "shared" ? "Comprobante enviado" : "Comprobante descargado"
      );
      window.setTimeout(() => setReceiptFeedback(null), 1800);
    } catch {
      setReceiptFeedback("No pudimos generar el comprobante");
      window.setTimeout(() => setReceiptFeedback(null), 1800);
    } finally {
      setSharingReceipt(false);
    }
  };

  const formattedDate = result.completedAt
    ? new Intl.DateTimeFormat("es-CO", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(result.completedAt))
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/35 px-4 pb-4 sm:items-center sm:justify-center sm:pb-0">
      {!isSell && (
        <div
          ref={receiptRef}
          className="pointer-events-none fixed left-[-9999px] top-0"
          aria-hidden
        >
          <ShareableReceipt data={shareableReceipt} />
        </div>
      )}
      <div className="w-full max-w-md rounded-[8px] bg-white p-4 shadow-xl">
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-[#E6F4EE] text-[#0E7C4F]">
          <Check className="h-5 w-5" />
        </div>
        <h2 className="text-xl font-semibold">
          {result.title ??
            (isTransfer
              ? "Envío completado"
              : isSell
                ? "Venta completada"
                : "Conversión completada")}
        </h2>
        <p className="mt-2 text-sm text-[#66736B]">
          {result.amountLabel ?? (isTransfer ? "Enviaste" : "Recibiste")}
        </p>
        <p className="mt-1 text-3xl font-semibold text-[#0E7C4F]">
          {result.receivedCopm} {isSell ? "USDT" : "pesos"}
        </p>
        <p className="mt-1 text-xs text-[#66736B]">
          {isSell ? "USDT recibido en tu wallet" : "Equivalente en COPm onchain"}
        </p>
        {result.shortfallMessage && (
          <div className="mt-3 rounded-[8px] bg-[#FFF6D8] px-3 py-2 text-sm font-medium leading-5 text-[#17211B]">
            {result.shortfallMessage}
          </div>
        )}
        {result.recipientAddress && (
          <div className="mt-3 rounded-[8px] bg-[#F7F8F5] p-3 text-sm">
            <p className="text-xs text-[#66736B]">Destino</p>
            <p className="font-semibold">
              {result.recipientAlias ? `${result.recipientAlias} · ` : ""}
              {formatAddressPreview(result.recipientAddress)}
            </p>
            <button
              type="button"
              onClick={() => void copyAddress()}
              className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#6D45B8]"
            >
              <Copy className="h-3.5 w-3.5" />
              {addressCopied ? "Copiado" : "Copiar address"}
            </button>
          </div>
        )}

        <div className="mt-4 space-y-3 rounded-[8px] bg-[#F7F8F5] p-3 text-sm">
          {formattedDate && (
            <div>
              <p className="text-xs text-[#66736B]">Fecha</p>
              <p className="font-semibold">{formattedDate}</p>
            </div>
          )}
          {!isTransfer && !isSell && (
            <div>
              <p className="text-xs text-[#66736B]">Balance final</p>
              <p className="font-semibold">
                {result.copmBalance === "No disponible" || result.copmBalance === "Actualizando"
                  ? result.copmBalance
                  : `${formatPesoAmountFromString(result.copmBalance)} pesos`}
              </p>
            </div>
          )}
          <div>
            <p className="text-xs text-[#66736B]">Transacción</p>
            <a
              href={result.txUrl}
              target="_blank"
              rel="noreferrer"
              className="break-all font-semibold text-[#0E7C4F]"
            >
              {formatAddressPreview(result.txHash)}
            </a>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          {!isSell && (
            <Button
              className="col-span-2 h-11 rounded-[8px] bg-[#6D45B8] text-white hover:bg-[#56359A]"
              disabled={sharingReceipt}
              onClick={() => void sendReceipt()}
            >
              {sharingReceipt ? "Generando comprobante..." : "Enviar comprobante"}
            </Button>
          )}
          <Button
            variant="outline"
            className="col-span-2 h-11 rounded-[8px] border-[#DDE4DC]"
            onClick={() => void shareTransactionId()}
          >
            {txIdCopied ? "Copiado" : "Comparte id de la transacción"}
          </Button>
        </div>
        {receiptFeedback && (
          <p className="mt-2 text-center text-xs font-semibold text-[#0E7C4F]">
            {receiptFeedback}
          </p>
        )}

        <Button
          className="mt-3 h-12 w-full rounded-[8px] bg-[#6D45B8] text-base font-semibold text-white hover:bg-[#56359A] disabled:bg-[#C8B9E8]"
          onClick={onClose}
        >
          Listo
        </Button>
      </div>
    </div>
  );
}

function MoveButton({
  direction,
  label,
  disabled,
  onClick,
}: {
  direction: "up" | "down";
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid h-6 w-6 place-items-center rounded-full bg-[#F7F8F5] text-[#66736B] disabled:opacity-30"
    >
      <ChevronRight
        className={`h-4 w-4 ${direction === "up" ? "-rotate-90" : "rotate-90"}`}
      />
    </button>
  );
}
