import { createHmac, timingSafeEqual } from "crypto";

import { getBrebConfig, isBridgeMock } from "./config";
import { BrebError } from "./errors";
import { createId } from "./ids";
import type { BrebStore } from "./store";
import type { BrebPayoutStatus, PayoutRow } from "./types";

type BridgeWebhookPayload = {
  event_id?: string;
  event_object?: { id?: string; state?: string; status?: string };
  event_object_id?: string;
  event_object_status?: string;
  event_type?: string;
  id?: string;
  type?: string;
};

function headerSignature(request: Request) {
  return (
    request.headers.get("x-webhook-signature") ??
    request.headers.get("bridge-signature") ??
    request.headers.get("svix-signature") ??
    ""
  );
}

export function verifyBridgeWebhookSignature(rawBody: string, request: Request) {
  const config = getBrebConfig();
  if (isBridgeMock() && !config.bridgeWebhookSecret) return true;
  if (!config.bridgeWebhookSecret) {
    throw new BrebError("webhook_not_configured", "Missing BRIDGE_WEBHOOK_SECRET", 500);
  }
  const signature = headerSignature(request);
  const expected = createHmac("sha256", config.bridgeWebhookSecret)
    .update(rawBody)
    .digest("hex");
  const actual = signature.replace(/^sha256=/i, "").trim();
  if (!/^[0-9a-f]+$/i.test(actual) || actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

function parseStatus(payload: BridgeWebhookPayload) {
  return (
    payload.event_object_status ??
    payload.event_object?.state ??
    payload.event_object?.status ??
    ""
  ).toLowerCase();
}

function parseType(payload: BridgeWebhookPayload) {
  return (payload.event_type ?? payload.type ?? "").toLowerCase();
}

function mapTransferStatus(status: string): BrebPayoutStatus | null {
  if (status.includes("underfunded")) return "awaiting_topup";
  if (status.includes("funds_received")) return "funds_received";
  if (status.includes("payment_processed") || status.includes("completed")) {
    return "processing";
  }
  if (status.includes("refund")) return "refunded";
  if (status.includes("failed") || status.includes("canceled") || status.includes("cancelled")) {
    return "failed";
  }
  return null;
}

function reconcile(payout: PayoutRow): PayoutRow {
  if (payout.status === "processing" || payout.status === "funds_received") {
    const depositOk = Boolean(payout.depositVerifiedAt);
    const feesOk = Boolean(payout.feesVerifiedAt);
    const bridgeOk = Boolean(payout.bridgePayoutVerifiedAt) || payout.status === "processing";
    if (payout.status === "processing") {
      payout.bridgePayoutVerifiedAt = payout.bridgePayoutVerifiedAt ?? payout.updatedAt;
      if (depositOk && feesOk && bridgeOk) payout.status = "completed";
      else if (depositOk && bridgeOk && !feesOk) payout.status = "completed_fees_mismatch";
    }
  }
  return payout;
}

export async function handleBridgeWebhook(
  store: BrebStore,
  rawBody: string,
  request: Request
) {
  if (!verifyBridgeWebhookSignature(rawBody, request)) {
    throw new BrebError("invalid_webhook_signature", "Invalid webhook signature", 401);
  }

  const payload = JSON.parse(rawBody) as BridgeWebhookPayload;
  const eventId = payload.event_id ?? payload.id ?? createId("wh");
  const eventType = parseType(payload) || "unknown";
  const inserted = await store.saveWebhookEvent(eventId, eventType, payload);
  if (!inserted) return { duplicate: true, eventId };

  if (eventType.startsWith("customer.")) {
    return { eventId, ignored: false, type: eventType };
  }

  const transferId = payload.event_object_id ?? payload.event_object?.id;
  if (!transferId) return { eventId, ignored: true, type: eventType };

  const payout = await store.getPayoutByTransferId(transferId);
  if (!payout) return { eventId, ignored: true, type: eventType };

  const mapped = mapTransferStatus(parseStatus(payload) || eventType);
  const now = new Date().toISOString();
  payout.updatedAt = now;
  if (mapped === "funds_received") {
    payout.status = "funds_received";
  } else if (mapped === "processing") {
    payout.status = "processing";
    payout.bridgePayoutVerifiedAt = now;
  } else if (mapped === "awaiting_topup") {
    payout.status = "awaiting_topup";
    payout.errorCode = "underfunded";
    payout.error = "Transfer is underfunded; user must deposit the remaining amount";
  } else if (mapped) {
    payout.status = mapped;
  }
  reconcile(payout);
  await store.updatePayout(payout);
  return { eventId, payoutId: payout.payoutId, status: payout.status };
}
