import { createHmac, randomInt, timingSafeEqual } from "crypto";
import { isAddress } from "viem";

import { getBrebConfig } from "./config";
import { BrebError } from "./errors";
import { createId } from "./ids";
import type { BrebStore } from "./store";
import type { BridgeClient } from "./bridge-client";
import type { CustomerRow } from "./types";

export type KycDeps = {
  bridge: BridgeClient;
  generateOtp?: () => string;
  now?: () => Date;
  sendOtp?: (input: { code: string; email: string }) => Promise<void>;
  store: BrebStore;
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function normalizeAddress(address: string) {
  return address.toLowerCase();
}

function hashPii(value: string) {
  const pepper =
    process.env.COPBY_API_KEY_PEPPER ?? process.env.BREB_PII_PEPPER ?? "mock";
  return createHmac("sha256", pepper).update(value).digest("hex");
}

function hashOtp(code: string, email: string, address: string) {
  return hashPii(`${code}:${email}:${address}`);
}

function hashesEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function isApproved(customer: CustomerRow | null) {
  return customer?.kycStatus === "approved" && customer.copEndorsement === "approved";
}

function mapKycResponse(customer: CustomerRow) {
  if (isApproved(customer)) {
    return { status: "approved" as const };
  }
  return {
    kycLink: customer.kycLink,
    status: "needs_kyc" as const,
    tosLink: customer.tosLink,
  };
}

export async function getKycStatus(deps: KycDeps, userAddress: string) {
  if (!isAddress(userAddress)) {
    throw new BrebError("invalid_user_address", "Invalid user address", 400);
  }
  const customer = await deps.store.getCustomerByAddress(userAddress);
  if (!customer) return { status: "needs_otp" as const };
  return mapKycResponse(customer);
}

export async function startKyc(
  deps: KycDeps,
  input: {
    email?: string;
    fullName?: string;
    redirectUri?: string;
    userAddress?: string;
  }
) {
  if (!input.userAddress || !isAddress(input.userAddress)) {
    throw new BrebError("invalid_user_address", "Invalid user address", 400);
  }
  const existing = await deps.store.getCustomerByAddress(input.userAddress);
  if (existing) return mapKycResponse(existing);

  if (!input.fullName?.trim() || !input.email?.trim()) {
    throw new BrebError("invalid_kyc_input", "fullName and email are required", 400);
  }

  return { status: "needs_otp" as const };
}

export async function sendKycOtp(
  deps: KycDeps,
  input: { email?: string; userAddress?: string }
) {
  if (!input.userAddress || !isAddress(input.userAddress)) {
    throw new BrebError("invalid_user_address", "Invalid user address", 400);
  }
  if (!input.email?.includes("@")) {
    throw new BrebError("invalid_email", "Valid email is required", 400);
  }

  const now = deps.now?.() ?? new Date();
  const email = normalizeEmail(input.email);
  const address = normalizeAddress(input.userAddress);
  const config = getBrebConfig();
  const active = await deps.store.getActiveOtp(email, address);
  if (active) {
    const elapsed = now.getTime() - Date.parse(active.createdAt);
    if (elapsed < config.otpResendSeconds * 1000) {
      throw new BrebError("otp_rate_limited", "Wait before requesting another code", 429);
    }
    active.consumedAt = now.toISOString();
    await deps.store.updateOtp(active);
  }

  const code = deps.generateOtp?.() ?? String(randomInt(100000, 1000000));
  const expiresAt = new Date(
    now.getTime() + config.otpTtlMinutes * 60 * 1000
  ).toISOString();
  await deps.store.saveOtp({
    attempts: 0,
    codeHash: hashOtp(code, email, address),
    consumedAt: null,
    createdAt: now.toISOString(),
    emailNormalized: email,
    expiresAt,
    id: createId("otp"),
    userAddress: address,
  });
  await deps.sendOtp?.({ code, email });
  return { expiresAt, status: "sent" as const };
}

export async function verifyKycOtp(
  deps: KycDeps,
  input: {
    code?: string;
    email?: string;
    fullName?: string;
    redirectUri?: string;
    userAddress?: string;
  }
) {
  if (!input.userAddress || !isAddress(input.userAddress)) {
    throw new BrebError("invalid_user_address", "Invalid user address", 400);
  }
  if (!input.email?.includes("@") || !input.code?.trim()) {
    throw new BrebError("invalid_otp", "email and code are required", 400);
  }

  const now = deps.now?.() ?? new Date();
  const email = normalizeEmail(input.email);
  const address = normalizeAddress(input.userAddress);
  const config = getBrebConfig();
  const otp = await deps.store.getActiveOtp(email, address);
  if (!otp) {
    throw new BrebError("otp_not_found", "No active OTP for this email", 400);
  }
  if (Date.parse(otp.expiresAt) <= now.getTime()) {
    throw new BrebError("otp_expired", "OTP expired", 400);
  }
  if (otp.attempts >= config.otpMaxAttempts) {
    throw new BrebError("otp_locked", "Too many OTP attempts", 429);
  }
  if (!hashesEqual(otp.codeHash, hashOtp(input.code.trim(), email, address))) {
    otp.attempts += 1;
    await deps.store.updateOtp(otp);
    throw new BrebError("otp_invalid", "Invalid OTP", 400);
  }

  otp.consumedAt = now.toISOString();
  await deps.store.updateOtp(otp);

  const existing = await deps.store.getCustomerByEmail(email);
  if (existing && isApproved(existing)) {
    await deps.store.linkWallet({
      customerId: existing.customerId,
      emailVerifiedAt: now.toISOString(),
      userAddress: address,
    });
    return { status: "approved" as const };
  }

  const fullName = input.fullName?.trim() || "Pending";
  const links = await deps.bridge.createKycLink({
    email,
    fullName,
    redirectUri: input.redirectUri,
  });
  const approved = config.mockAutoApproveKyc;
  const customer: CustomerRow = {
    copEndorsement: approved ? "approved" : "pending",
    createdAt: now.toISOString(),
    customerId: existing?.customerId ?? links.customerId,
    emailHash: hashPii(email),
    emailNormalized: email,
    fullNameHash: hashPii(fullName),
    kycLink: approved ? null : links.kycLink,
    kycLinkExpiresAt: approved ? null : links.kycLinkExpiresAt,
    kycStatus: approved ? "approved" : "pending",
    tosLink: approved ? null : links.tosLink,
    updatedAt: now.toISOString(),
  };
  await deps.store.upsertCustomer(customer);
  await deps.store.linkWallet({
    customerId: customer.customerId,
    emailVerifiedAt: now.toISOString(),
    userAddress: address,
  });
  return mapKycResponse(customer);
}

export async function requireApprovedCustomer(deps: KycDeps, userAddress: string) {
  const customer = await deps.store.getCustomerByAddress(userAddress);
  if (isApproved(customer) && customer) return customer;
  throw new BrebError(
    "needs_kyc",
    "Complete Bridge KYC before creating a payout",
    409,
    customer
      ? { kycLink: customer.kycLink, tosLink: customer.tosLink }
      : { status: "needs_otp" }
  );
}
