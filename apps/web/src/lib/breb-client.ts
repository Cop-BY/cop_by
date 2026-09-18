import type { Address, Hex } from "viem";

import type { QuoteFeeLeg } from "./breb/quote-math";
import type { BrebFromToken, BrebPayoutStatus, PreparedTx } from "./breb/types";

export const BREB_MIN_COP = 4000;

export type BrebApiError = Error & {
  errorCode?: string;
  status: number;
};

export type BrebQuote = {
  cached: boolean;
  destinationCop: string | null;
  display: string;
  effectiveUsdCop: string;
  expiresAt: string;
  fees: QuoteFeeLeg[];
  fromToken: BrebFromToken;
  netUsdcToBridge: string | null;
  quoteId: string;
  sellRate: string;
  sourceAmount: string | null;
  sourceAmountUsd: string | null;
  swapProvider: string | null;
};

export type BrebKycStatus = {
  debugCode?: string;
  expiresAt?: string;
  kycLink?: string | null;
  status: "needs_otp" | "needs_kyc" | "approved" | "sent";
  tosLink?: string | null;
};

export type BrebPayout = {
  accountOwnerName?: string | null;
  breBKeyLast4?: string | null;
  createdAt?: string;
  deposit: {
    address: string;
    amount: string;
    chain: string;
    currency: string;
  } | null;
  destinationCop?: string;
  destinationPreview?: {
    accountOwnerName: string;
    bankName?: string | null;
    documentLast4?: string | null;
  };
  error?: string | null;
  feeTransaction?: PreparedTx | null;
  fees: QuoteFeeLeg[];
  fromToken: BrebFromToken;
  payoutId: string;
  quote: { display: string | null; effectiveUsdCop: string | null };
  sourceAmount: string | null;
  sourceTxHash?: string | null;
  status: BrebPayoutStatus;
  transaction: PreparedTx | null;
  updatedAt?: string;
};

async function parseBrebResponse<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    errorCode?: string;
  } & T;
  if (!response.ok) {
    const error = new Error(body.error || "BRE-B request failed") as BrebApiError;
    error.errorCode = body.errorCode;
    error.status = response.status;
    throw error;
  }
  return body;
}

export function getBrebErrorMessage(error: unknown) {
  if (error && typeof error === "object" && "errorCode" in error) {
    const code = String((error as BrebApiError).errorCode);
    if (code === "below_minimum") {
      return `El mínimo es ${BREB_MIN_COP} COP y 2 USDC.`;
    }
    if (code === "destination_mismatch") {
      return "La llave Bre-B y el nombre del titular no coinciden.";
    }
    if (code === "needs_kyc") {
      return "Completa la verificación antes de enviar.";
    }
    if (code === "otp_invalid") return "El código no es válido.";
    if (code === "otp_expired") return "El código expiró. Pide uno nuevo.";
    if (code === "otp_rate_limited") {
      return "Espera unos segundos antes de pedir otro código.";
    }
    if (code === "mercado_cerrado") {
      return "El mercado de pesos está cerrado. Intenta con USDC.";
    }
    if (code === "requote") return "La tasa se movió. Vuelve a cotizar.";
  }
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (
    lower.includes("user rejected") ||
    lower.includes("user denied") ||
    lower.includes("rejected the request")
  ) {
    return "Cancelaste la confirmación en tu wallet.";
  }
  return message || "No pudimos completar el envío.";
}

export async function fetchBrebQuote(input: {
  destinationCop: string;
  fromToken: BrebFromToken;
  userAddress?: Address;
}) {
  const params = new URLSearchParams({
    destinationCop: input.destinationCop,
    fromToken: input.fromToken,
  });
  if (input.userAddress) params.set("userAddress", input.userAddress);
  const response = await fetch(`/api/breb/quote?${params}`);
  return parseBrebResponse<BrebQuote>(response);
}

export async function fetchBrebKyc(userAddress: Address) {
  const response = await fetch(
    `/api/breb/kyc?${new URLSearchParams({ userAddress })}`
  );
  return parseBrebResponse<BrebKycStatus>(response);
}

export async function startBrebKyc(input: {
  email: string;
  fullName: string;
  redirectUri?: string;
  userAddress: Address;
}) {
  const response = await fetch("/api/breb/kyc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseBrebResponse<BrebKycStatus>(response);
}

export async function sendBrebOtp(input: { email: string; userAddress: Address }) {
  const response = await fetch("/api/breb/kyc/otp/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseBrebResponse<BrebKycStatus>(response);
}

export async function verifyBrebOtp(input: {
  code: string;
  email: string;
  fullName: string;
  redirectUri?: string;
  userAddress: Address;
}) {
  const response = await fetch("/api/breb/kyc/otp/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseBrebResponse<BrebKycStatus>(response);
}

export async function createBrebPayoutRequest(input: {
  accountOwnerName: string;
  breBKey: string;
  destinationCop: string;
  fromToken: BrebFromToken;
  quoteId?: string;
  userAddress: Address;
}) {
  const response = await fetch("/api/breb/payouts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseBrebResponse<BrebPayout>(response);
}

export async function listBrebPayouts(userAddress: Address, limit = 20) {
  const params = new URLSearchParams({
    userAddress,
    limit: String(limit),
  });
  const response = await fetch(`/api/breb/payouts?${params}`);
  return parseBrebResponse<{ items: BrebPayout[] }>(response);
}

export async function confirmBrebPayoutRequest(input: {
  payoutId: string;
  txHash: Hex;
  userAddress: Address;
}) {
  const response = await fetch(`/api/breb/payouts/${input.payoutId}/confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      txHash: input.txHash,
      userAddress: input.userAddress,
    }),
  });
  return parseBrebResponse<BrebPayout>(response);
}
