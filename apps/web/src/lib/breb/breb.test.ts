import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { createMockBridgeClient } from "./bridge-client";
import { confirmBrebPayout } from "./confirm";
import {
  createChainedCopmQuoter,
  createMockCopmQuoter,
  type CopmQuoter,
} from "./copm-quote";
import { isBrebError } from "./errors";
import { sendKycOtp, startKyc, verifyKycOtp } from "./kyc";
import { createMemoryBrebStore } from "./memory-store";
import { createBrebPayout, listBrebPayouts } from "./payout";
import {
  computeFixedOutputQuote,
  getBelowMinimumReason,
} from "./quote-math";
import { getBrebQuote } from "./quote";
import { handleBridgeWebhook } from "./webhook";
import type { PayoutDeps } from "./payout";

process.env.BRIDGE_MOCK = "true";
process.env.COPBY_API_KEY_PEPPER = process.env.COPBY_API_KEY_PEPPER ?? "test-pepper";

const USER_A = "0x2222222222222222222222222222222222222222";
const USER_B = "0x3333333333333333333333333333333333333333";
const TX_A = `0x${"11".repeat(32)}`;
const TX_B = `0x${"22".repeat(32)}`;

function throwingNoRouteQuoter(): CopmQuoter {
  return {
    async quote() {
      throw new Error("no route");
    },
  };
}

function createHarness() {
  const store = createMemoryBrebStore();
  let rateCalls = 0;
  const bridge = createMockBridgeClient({
    onGetExchangeRate: () => {
      rateCalls += 1;
    },
    sellRate: 4000,
  });
  const copmQuoter = createMockCopmQuoter();
  const ctx: PayoutDeps = {
    bridge,
    copmQuoter,
    generateOtp: () => "123456",
    store,
  };
  return {
    ctx,
    rateCalls: () => rateCalls,
  };
}

async function approveWallet(ctx: PayoutDeps, userAddress: string, email: string) {
  await sendKycOtp(ctx, { email, userAddress });
  return verifyKycOtp(ctx, {
    code: "123456",
    email,
    fullName: "Ana Perez",
    userAddress,
  });
}

beforeEach(() => {
  process.env.BRIDGE_MOCK = "true";
});

test("quote math flags COP and USDC minima", () => {
  const underCop = computeFixedOutputQuote({
    copbyFeeBps: 100,
    destinationCop: 3999,
    developerFeeBps: 50,
    fxPaddingBps: 100,
    minCop: 4000,
    minUsdc: 2,
    sellRateCopPerUsd: 4000,
  });
  assert.equal(
    getBelowMinimumReason({
      destinationCop: 3999,
      minCop: 4000,
      minUsdc: 2,
      netUsdcUsd: Number(underCop.netUsdcToBridge),
    }),
    "destination_cop"
  );

  const underUsdc = computeFixedOutputQuote({
    copbyFeeBps: 100,
    destinationCop: 4000,
    developerFeeBps: 50,
    fxPaddingBps: 100,
    minCop: 4000,
    minUsdc: 2,
    sellRateCopPerUsd: 4000,
  });
  assert.equal(
    getBelowMinimumReason({
      destinationCop: 4000,
      minCop: 4000,
      minUsdc: 2,
      netUsdcUsd: Number(underUsdc.netUsdcToBridge),
    }),
    "net_usdc"
  );

  const ok = computeFixedOutputQuote({
    copbyFeeBps: 100,
    destinationCop: 10000,
    developerFeeBps: 50,
    fxPaddingBps: 100,
    minCop: 4000,
    minUsdc: 2,
    sellRateCopPerUsd: 4000,
  });
  assert.equal(
    getBelowMinimumReason({
      destinationCop: 10000,
      minCop: 4000,
      minUsdc: 2,
      netUsdcUsd: Number(ok.netUsdcToBridge),
    }),
    null
  );
  assert.match(ok.effectiveUsdCop, /^\d+(\.\d+)?$/);
  assert.ok(Number(ok.netUsdcToBridge) >= 2);
});

test("cache hit does not call Bridge again", async () => {
  const { ctx, rateCalls } = createHarness();
  const first = await getBrebQuote(ctx, {
    destinationCop: "10000",
    fromToken: "USDC",
    integrationId: "partner-a",
  });
  const second = await getBrebQuote(ctx, {
    destinationCop: "20000",
    fromToken: "USDC",
    integrationId: "partner-a",
  });
  assert.equal(rateCalls(), 1);
  assert.equal(first.cached, false);
  assert.equal(second.cached, true);
  assert.match(first.display, /^1 USD = .+ COP$/);
  assert.equal(first.fees.some((fee) => fee.code === "copby"), true);
});

test("quote below minimum returns below_minimum", async () => {
  const { ctx } = createHarness();
  await assert.rejects(
    () =>
      getBrebQuote(ctx, {
        destinationCop: "3999",
        fromToken: "USDC",
        integrationId: "partner-a",
      }),
    (error: unknown) => isBrebError(error) && error.code === "below_minimum"
  );
  await assert.rejects(
    () =>
      getBrebQuote(ctx, {
        destinationCop: "4000",
        fromToken: "USDC",
        integrationId: "partner-a",
      }),
    (error: unknown) => isBrebError(error) && error.code === "below_minimum"
  );
});

test("COPm quote falls back when Squid has no route", async () => {
  const { ctx } = createHarness();
  ctx.copmQuoter = createChainedCopmQuoter({
    fallback: createMockCopmQuoter(),
    primary: throwingNoRouteQuoter(),
  });
  const quote = await getBrebQuote(ctx, {
    destinationCop: "10000",
    fromToken: "COPm",
    integrationId: "partner-a",
    userAddress: USER_A,
  });
  assert.equal(quote.fromToken, "COPm");
  assert.equal(quote.swapProvider, "mock");
  assert.ok(BigInt(quote.sourceAmount ?? "0") > 0n);
});

test("KYC requires OTP before approval", async () => {
  const { ctx } = createHarness();
  const started = await startKyc(ctx, {
    email: "ana@example.com",
    fullName: "Ana Perez",
    userAddress: USER_A,
  });
  assert.equal(started.status, "needs_otp");
  const verified = await approveWallet(ctx, USER_A, "ana@example.com");
  assert.equal(verified.status, "approved");
});

test("mock OTP returns debugCode 123456", async () => {
  const { ctx } = createHarness();
  delete ctx.generateOtp;
  const sent = await sendKycOtp(ctx, {
    email: "ana@example.com",
    userAddress: USER_A,
  });
  assert.equal(sent.status, "sent");
  assert.equal(sent.debugCode, "123456");
  const verified = await verifyKycOtp(ctx, {
    code: "123456",
    email: "ana@example.com",
    fullName: "Ana Perez",
    userAddress: USER_A,
  });
  assert.equal(verified.status, "approved");
});

test("first-party list hides other wallets", async () => {
  const { ctx } = createHarness();
  await approveWallet(ctx, USER_A, "ana@example.com");
  await approveWallet(ctx, USER_B, "beto@example.com");
  const payout = await createBrebPayout(ctx, {
    accountOwnerName: "Ana Perez",
    breBKey: "31234567890",
    destinationCop: "10000",
    fromToken: "USDC",
    integrationId: "copby",
    userAddress: USER_A,
  });
  await createBrebPayout(ctx, {
    accountOwnerName: "Beto Ruiz",
    breBKey: "39876543210",
    destinationCop: "12000",
    fromToken: "USDC",
    integrationId: "copby",
    userAddress: USER_B,
  });
  const listed = await listBrebPayouts(ctx.store, {
    integrationId: "copby",
    userAddress: USER_A,
  });
  assert.equal(listed.items.length, 1);
  assert.equal(listed.items[0]?.payoutId, payout.payoutId);
});

test("destination mismatch does not create a payout", async () => {
  const { ctx } = createHarness();
  await approveWallet(ctx, USER_A, "ana@example.com");
  await assert.rejects(
    () =>
      createBrebPayout(ctx, {
        accountOwnerName: "Nombre mismatch",
        breBKey: "31234567890",
        destinationCop: "10000",
        fromToken: "USDC",
        integrationId: "partner-a",
        userAddress: USER_A,
      }),
    (error: unknown) => isBrebError(error) && error.code === "destination_mismatch"
  );
  const listed = await listBrebPayouts(ctx.store, { integrationId: "partner-a" });
  assert.equal(listed.items.length, 0);
});

test("payouts are isolated by integration_id", async () => {
  const { ctx } = createHarness();
  await approveWallet(ctx, USER_A, "ana@example.com");
  const payout = await createBrebPayout(ctx, {
    accountOwnerName: "Ana Perez",
    breBKey: "31234567890",
    destinationCop: "10000",
    fromToken: "USDC",
    integrationId: "partner-a",
    userAddress: USER_A,
  });
  const visible = await listBrebPayouts(ctx.store, { integrationId: "partner-a" });
  const hidden = await listBrebPayouts(ctx.store, { integrationId: "partner-b" });
  assert.equal(visible.items.length, 1);
  assert.equal(visible.items[0]?.payoutId, payout.payoutId);
  assert.equal(hidden.items.length, 0);
});

test("confirm rejects a reused txHash on another payout", async () => {
  const { ctx } = createHarness();
  await approveWallet(ctx, USER_A, "ana@example.com");
  await approveWallet(ctx, USER_B, "beto@example.com");
  const first = await createBrebPayout(ctx, {
    accountOwnerName: "Ana Perez",
    breBKey: "31234567890",
    destinationCop: "10000",
    fromToken: "USDC",
    integrationId: "partner-a",
    userAddress: USER_A,
  });
  const second = await createBrebPayout(ctx, {
    accountOwnerName: "Beto Ruiz",
    breBKey: "39876543210",
    destinationCop: "12000",
    fromToken: "USDC",
    integrationId: "partner-a",
    userAddress: USER_B,
  });
  const confirmed = await confirmBrebPayout(ctx.store, {
    integrationId: "partner-a",
    payoutId: first.payoutId,
    txHash: TX_A,
  });
  assert.equal(confirmed.status, "deposit_verified");
  await assert.rejects(
    () =>
      confirmBrebPayout(ctx.store, {
        integrationId: "partner-a",
        payoutId: second.payoutId,
        txHash: TX_A,
      }),
    (error: unknown) => isBrebError(error) && error.code === "tx_hash_reused"
  );
  const same = await confirmBrebPayout(ctx.store, {
    integrationId: "partner-a",
    payoutId: first.payoutId,
    txHash: TX_A,
  });
  assert.equal(same.payoutId, first.payoutId);
  await confirmBrebPayout(ctx.store, {
    integrationId: "partner-a",
    payoutId: second.payoutId,
    txHash: TX_B,
  });
});

test("webhook funds_received closes deposit even without confirm", async () => {
  const { ctx } = createHarness();
  await approveWallet(ctx, USER_A, "ana@example.com");
  const payout = await createBrebPayout(ctx, {
    accountOwnerName: "Ana Perez",
    breBKey: "31234567890",
    destinationCop: "10000",
    fromToken: "USDC",
    integrationId: "partner-a",
    userAddress: USER_A,
  });
  const stored = await ctx.store.getPayout(payout.payoutId);
  assert.ok(stored?.bridgeTransferId);
  const request = new Request("http://localhost/api/breb/webhook", { method: "POST" });
  const result = await handleBridgeWebhook(
    ctx.store,
    JSON.stringify({
      event_id: "wh_1",
      event_object_id: stored?.bridgeTransferId,
      event_object_status: "funds_received",
      event_type: "transfer.updated",
    }),
    request
  );
  assert.equal(result.status, "funds_received");
  const duplicate = await handleBridgeWebhook(
    ctx.store,
    JSON.stringify({
      event_id: "wh_1",
      event_object_id: stored?.bridgeTransferId,
      event_object_status: "funds_received",
      event_type: "transfer.updated",
    }),
    request
  );
  assert.equal(duplicate.duplicate, true);
});
