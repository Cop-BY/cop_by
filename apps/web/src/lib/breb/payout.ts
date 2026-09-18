import { getAddress, isAddress } from "viem";

import type { BridgeClient } from "./bridge-client";
import { getBrebConfig } from "./config";
import { createDefaultCopmQuoter, type CopmQuoter } from "./copm-quote";
import { BrebError } from "./errors";
import { createId } from "./ids";
import { requireApprovedCustomer, type KycDeps } from "./kyc";
import { usdToAtomic } from "./money";
import { getBrebQuote, type QuoteDeps } from "./quote";
import type { BrebStore } from "./store";
import { encodeUsdcTransfer, tagPreparedTx } from "./tx";
import type { BrebFromToken, PayoutRow, PreparedTx } from "./types";

export type PayoutDeps = QuoteDeps &
  KycDeps & {
    copmQuoter: CopmQuoter;
  };

function last4(value: string) {
  return value.replace(/\s/g, "").slice(-4);
}

function developerFeePercent(onchainFee: boolean) {
  const config = getBrebConfig();
  const bps = onchainFee ? config.developerFeeBps : config.developerFeeBps + config.copbyFeeBps;
  return (bps / 100).toFixed(1);
}

export function serializePayout(payout: PayoutRow, extra?: {
  destinationPreview?: {
    accountOwnerName: string;
    bankName?: string | null;
    documentLast4?: string | null;
  };
  feeTransaction?: PreparedTx | null;
  quote?: { display: string; effectiveUsdCop: string };
  transaction?: PreparedTx | null;
}) {
  return {
    deposit: payout.depositAddress
      ? {
          address: payout.depositAddress,
          amount: payout.depositAmount ?? payout.netUsdcToBridge,
          chain: "celo",
          currency: "usdc",
        }
      : null,
    destinationPreview: extra?.destinationPreview,
    feeTransaction: extra?.feeTransaction ?? undefined,
    fees: payout.fees,
    fromToken: payout.fromToken,
    payoutId: payout.payoutId,
    quote: extra?.quote ?? {
      display: payout.effectiveUsdCop ? `1 USD = ${payout.effectiveUsdCop} COP` : null,
      effectiveUsdCop: payout.effectiveUsdCop,
    },
    sourceAmount: payout.sourceAmount,
    status: payout.status,
    transaction: extra?.transaction ?? (payout.txTo && payout.txData
      ? {
          approvalTarget: payout.approvalTarget,
          data: payout.txData,
          to: payout.txTo,
          value: payout.txValue ?? "0",
        }
      : null),
  };
}

export async function createBrebPayout(
  deps: PayoutDeps,
  input: {
    accountOwnerName?: string;
    breBKey?: string;
    destinationCop?: string;
    fromToken?: string;
    hostname?: string;
    idempotencyKey?: string | null;
    integrationId: string;
    quoteId?: string;
    userAddress?: string;
  }
) {
  if (!input.userAddress || !isAddress(input.userAddress)) {
    throw new BrebError("invalid_user_address", "Invalid user address", 400);
  }
  if (!input.breBKey?.trim() || !input.accountOwnerName?.trim()) {
    throw new BrebError(
      "invalid_destination",
      "breBKey and accountOwnerName are required",
      400
    );
  }
  if (input.idempotencyKey) {
    const existing = await deps.store.getPayoutByIdempotency(
      input.integrationId,
      input.idempotencyKey
    );
    if (existing) return serializePayout(existing);
  }

  const customer = await requireApprovedCustomer(deps, input.userAddress);
  const fromToken = (input.fromToken === "COPm" ? "COPm" : "USDC") as BrebFromToken;
  const quote = await getBrebQuote(deps, {
    destinationCop: input.destinationCop,
    fromToken,
    hostname: input.hostname,
    integrationId: input.integrationId,
    userAddress: input.userAddress,
  });
  if (!quote.destinationCop || !quote.netUsdcToBridge || !quote.sourceAmount) {
    throw new BrebError("invalid_quote", "destinationCop is required to create a payout", 400);
  }

  if (input.quoteId) {
    const previous = await deps.store.getQuote(input.quoteId);
    if (previous?.netUsdcToBridge) {
      const quotedNet = Number(previous.netUsdcToBridge);
      const liveNet = Number(quote.netUsdcToBridge);
      if (liveNet > quotedNet * 1.001) {
        throw new BrebError("requote", "FX moved; request a new quote", 409, {
          quoteId: quote.quoteId,
        });
      }
    }
  }

  const account = await deps.bridge.createExternalAccount({
    accountOwnerName: input.accountOwnerName.trim(),
    breBKey: input.breBKey.trim(),
    customerId: customer.customerId,
  });
  const verification = await deps.bridge.verifyExternalAccount(account.id);
  const now = (deps.now?.() ?? new Date()).toISOString();
  await deps.store.saveExternalAccount({
    accountOwnerName: input.accountOwnerName.trim(),
    breBKeyLast4: last4(input.breBKey),
    createdAt: now,
    customerId: customer.customerId,
    id: account.id,
    updatedAt: now,
    validatedBankName: verification.validatedBankName ?? null,
    validatedDocumentLast4: verification.validatedDocumentLast4 ?? null,
    verificationStatus: verification.matched ? "matched" : "mismatched",
  });
  if (!verification.matched) {
    throw new BrebError(
      "destination_mismatch",
      "BRE-B key and account owner name did not match",
      409
    );
  }

  const config = getBrebConfig();
  const onchainFee = Boolean(config.copbyFeeWallet);
  const transfer = await deps.bridge.createTransfer({
    customerId: customer.customerId,
    destinationCop: quote.destinationCop,
    developerFeePercent: developerFeePercent(fromToken === "USDC" && onchainFee),
    externalAccountId: account.id,
    fromAddress: getAddress(input.userAddress),
    returnAddress: getAddress(input.userAddress),
  });

  const netUsdcAtomic = usdToAtomic(Number(quote.netUsdcToBridge));
  const copbyFeeAtomic = usdToAtomic(
    Number(quote.fees.find((fee) => fee.code === "copby")?.amountUsd ?? 0)
  );
  let transaction: PreparedTx;
  let feeTransaction: PreparedTx | null = null;
  let approvalTarget: string | null = null;
  let swapProvider = quote.swapProvider;

  if (fromToken === "USDC") {
    transaction = encodeUsdcTransfer(transfer.depositAddress, netUsdcAtomic);
    if (onchainFee && config.copbyFeeWallet) {
      feeTransaction = encodeUsdcTransfer(config.copbyFeeWallet, copbyFeeAtomic);
    }
  } else {
    const copm = await deps.copmQuoter.quote({
      copbyFeeAtomic,
      depositAddress: transfer.depositAddress,
      feeWallet: config.copbyFeeWallet,
      netUsdcAtomic,
      sellRateCopPerUsd: Number(quote.sellRate),
      userAddress: getAddress(input.userAddress),
    });
    swapProvider = copm.provider;
    if (!copm.transaction) {
      throw new BrebError(
        "mercado_cerrado",
        "mercado de pesos cerrado",
        503
      );
    }
    transaction = copm.transaction;
    approvalTarget = copm.approvalTarget ?? copm.transaction.approvalTarget ?? null;
  }

  transaction = tagPreparedTx(transaction, input.hostname);
  if (feeTransaction) feeTransaction = tagPreparedTx(feeTransaction, input.hostname);

  const payout: PayoutRow = {
    accountOwnerName: input.accountOwnerName.trim(),
    additionalFundingUsdc: null,
    approvalTarget,
    breBKeyLast4: last4(input.breBKey),
    bridgePayoutVerifiedAt: null,
    bridgeTransferId: transfer.id,
    createdAt: now,
    customerId: customer.customerId,
    depositAddress: transfer.depositAddress,
    depositAmount: quote.netUsdcToBridge,
    depositVerifiedAt: null,
    destinationCop: quote.destinationCop,
    effectiveUsdCop: quote.effectiveUsdCop,
    error: null,
    errorCode: null,
    externalAccountId: account.id,
    feeTxData: feeTransaction?.data ?? null,
    feeTxTo: feeTransaction?.to ?? null,
    fees: quote.fees,
    feesVerifiedAt: null,
    fromToken,
    idempotencyKey: input.idempotencyKey ?? null,
    integrationId: input.integrationId,
    netUsdcToBridge: quote.netUsdcToBridge,
    payoutId: createId("payout"),
    quoteId: quote.quoteId,
    sourceAmount: quote.sourceAmount,
    sourceAmountUsd: quote.sourceAmountUsd,
    sourceTxHash: null,
    status: "awaiting_deposit",
    swapProvider,
    swapTxHash: null,
    txData: transaction.data,
    txTo: transaction.to,
    txValue: transaction.value,
    updatedAt: now,
    userAddress: input.userAddress.toLowerCase(),
  };
  await deps.store.savePayout(payout);

  return serializePayout(payout, {
    destinationPreview: {
      accountOwnerName: input.accountOwnerName.trim(),
      bankName: verification.validatedBankName,
      documentLast4: verification.validatedDocumentLast4,
    },
    feeTransaction,
    quote: { display: quote.display, effectiveUsdCop: quote.effectiveUsdCop },
    transaction,
  });
}

export async function getBrebPayout(
  store: BrebStore,
  input: { integrationId: string; payoutId: string; userAddress?: string }
) {
  const payout = await store.getPayout(input.payoutId);
  if (
    !payout ||
    payout.integrationId !== input.integrationId ||
    (input.userAddress &&
      payout.userAddress !== input.userAddress.toLowerCase())
  ) {
    throw new BrebError("payout_not_found", "Payout not found", 404);
  }
  return serializePayout(payout);
}

export async function listBrebPayouts(
  store: BrebStore,
  input: {
    integrationId: string;
    limit?: number;
    since?: string;
    userAddress?: string;
  }
) {
  const items = await store.listPayouts(input.integrationId, {
    limit: input.limit,
    since: input.since,
    userAddress: input.userAddress,
  });
  return {
    integrationId: input.integrationId,
    items: items.map((payout) => serializePayout(payout)),
  };
}

export function createPayoutDeps(
  base: QuoteDeps & { bridge: BridgeClient; store: BrebStore }
): PayoutDeps {
  return {
    ...base,
    copmQuoter: base.copmQuoter ?? createDefaultCopmQuoter(),
  };
}
