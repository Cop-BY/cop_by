import {
  createPublicClient,
  http,
  parseEventLogs,
  type Hex,
} from "viem";

import { getTargetNetwork } from "../network-config";

import { getBrebConfig, getBrebTokenAddresses, isBridgeMock } from "./config";
import { BrebError } from "./errors";
import { usdToAtomic } from "./money";
import { serializePayout } from "./payout";
import type { BrebStore } from "./store";
import type { PayoutRow } from "./types";

const erc20TransferAbi = [
  {
    anonymous: true,
    inputs: [
      { indexed: true, name: "from", type: "address" },
      { indexed: true, name: "to", type: "address" },
      { indexed: false, name: "value", type: "uint256" },
    ],
    name: "Transfer",
    type: "event",
  },
] as const;

function isTxHash(value?: string): value is Hex {
  return /^0x[0-9a-fA-F]{64}$/.test(value ?? "");
}

async function verifyOnchain(payout: PayoutRow, txHash: Hex) {
  const network = getTargetNetwork();
  const tokens = getBrebTokenAddresses();
  const client = createPublicClient({
    chain: network.chain,
    transport: http(network.rpcUrl),
  });
  const [transaction, receipt] = await Promise.all([
    client.getTransaction({ hash: txHash }),
    client.waitForTransactionReceipt({ hash: txHash }),
  ]);

  if (transaction.from.toLowerCase() !== payout.userAddress.toLowerCase()) {
    throw new BrebError("tx_sender_mismatch", "Transaction sender does not match payout", 400);
  }
  if (receipt.status !== "success") {
    throw new BrebError("tx_reverted", "Transaction reverted", 409);
  }
  if (payout.txTo && transaction.to?.toLowerCase() !== payout.txTo.toLowerCase()) {
    throw new BrebError("tx_target_mismatch", "Transaction target does not match payout", 400);
  }

  const usdcLogs = parseEventLogs({
    abi: erc20TransferAbi,
    eventName: "Transfer",
    logs: receipt.logs.filter(
      (log) => log.address.toLowerCase() === tokens.usdc.toLowerCase()
    ),
  });
  const depositAmount = usdcLogs.reduce((sum, log) => {
    if (log.args.to?.toLowerCase() !== payout.depositAddress?.toLowerCase()) return sum;
    return sum + (log.args.value ?? 0n);
  }, 0n);
  const minDeposit = usdToAtomic(Number(payout.netUsdcToBridge));
  if (depositAmount < minDeposit) {
    throw new BrebError(
      "deposit_short",
      "USDC received is below netUsdcToBridge",
      409,
      { received: depositAmount.toString() }
    );
  }

  const config = getBrebConfig();
  let feesVerified = true;
  if (payout.fromToken === "USDC" && config.copbyFeeWallet) {
    const feeAmount = usdcLogs.reduce((sum, log) => {
      if (log.args.to?.toLowerCase() !== config.copbyFeeWallet?.toLowerCase()) return sum;
      return sum + (log.args.value ?? 0n);
    }, 0n);
    const expectedFee = usdToAtomic(
      Number(payout.fees.find((fee) => fee.code === "copby")?.amountUsd ?? 0)
    );
    feesVerified = expectedFee === 0n || feeAmount >= (expectedFee * 99n) / 100n;
  }

  return { feesVerified };
}

export async function confirmBrebPayout(
  store: BrebStore,
  input: {
    integrationId: string;
    payoutId: string;
    txHash?: string;
  }
) {
  if (!isTxHash(input.txHash)) {
    throw new BrebError("invalid_tx_hash", "Invalid tx hash", 400);
  }
  const payout = await store.getPayout(input.payoutId);
  if (!payout || payout.integrationId !== input.integrationId) {
    throw new BrebError("payout_not_found", "Payout not found", 404);
  }
  if (payout.sourceTxHash?.toLowerCase() === input.txHash.toLowerCase()) {
    return serializePayout(payout);
  }
  if (
    payout.status !== "awaiting_deposit" &&
    payout.status !== "awaiting_topup"
  ) {
    throw new BrebError("payout_not_confirmable", "Payout cannot accept this confirm", 409);
  }

  const existing = await store.getPayoutByTxHash(input.txHash);
  if (existing && existing.payoutId !== payout.payoutId) {
    throw new BrebError(
      "tx_hash_reused",
      "This transaction was already used for another payout",
      409
    );
  }

  let feesVerified = isBridgeMock();
  if (!isBridgeMock()) {
    const verified = await verifyOnchain(payout, input.txHash);
    feesVerified = verified.feesVerified;
  }

  const now = new Date().toISOString();
  payout.sourceTxHash = input.txHash.toLowerCase();
  payout.depositVerifiedAt = now;
  payout.updatedAt = now;
  payout.status = feesVerified ? "deposit_verified" : "deposit_verified";
  payout.feesVerifiedAt = feesVerified ? now : null;
  payout.fees = payout.fees.map((fee) =>
    fee.code === "copby" && feesVerified ? { ...fee, status: "verified" } : fee
  );
  await store.updatePayout(payout);
  return serializePayout(payout);
}
