import type { Address, Hex } from "viem";

import type { QuoteFeeLeg } from "./quote-math";

export type BrebFromToken = "USDC" | "COPm";

export type BrebCustomerStatus = "pending" | "approved" | "rejected";

export type BrebPayoutStatus =
  | "needs_kyc"
  | "awaiting_deposit"
  | "deposit_verified"
  | "funds_received"
  | "processing"
  | "completed"
  | "awaiting_topup"
  | "completed_fees_mismatch"
  | "failed"
  | "refunded";

export type FxCacheRow = {
  cacheKey: string;
  expiresAt: string;
  fetchedAt: string;
  sellRate: string;
};

export type QuoteRow = {
  createdAt: string;
  destinationCop: string | null;
  effectiveUsdCop: string;
  expiresAt: string;
  fees: QuoteFeeLeg[];
  fromToken: BrebFromToken;
  integrationId: string;
  netUsdcToBridge: string | null;
  payload: Record<string, unknown>;
  quoteId: string;
  sellRate: string;
  sourceAmount: string | null;
  sourceAmountUsd: string | null;
  swapProvider: string | null;
};

export type CustomerRow = {
  copEndorsement: string | null;
  createdAt: string;
  customerId: string;
  emailHash: string | null;
  emailNormalized: string | null;
  fullNameHash: string | null;
  kycLink: string | null;
  kycLinkExpiresAt: string | null;
  kycStatus: BrebCustomerStatus;
  tosLink: string | null;
  updatedAt: string;
};

export type WalletRow = {
  customerId: string;
  emailVerifiedAt: string | null;
  userAddress: string;
};

export type OtpRow = {
  attempts: number;
  codeHash: string;
  consumedAt: string | null;
  createdAt: string;
  emailNormalized: string;
  expiresAt: string;
  id: string;
  userAddress: string;
};

export type ExternalAccountRow = {
  accountOwnerName: string;
  breBKeyLast4: string | null;
  createdAt: string;
  customerId: string;
  id: string;
  updatedAt: string;
  validatedBankName: string | null;
  validatedDocumentLast4: string | null;
  verificationStatus: "pending" | "matched" | "mismatched";
};

export type PreparedTx = {
  approvalTarget?: Address;
  data: Hex;
  to: Address;
  value: "0";
};

export type PayoutRow = {
  accountOwnerName: string | null;
  additionalFundingUsdc: string | null;
  approvalTarget: string | null;
  breBKeyLast4: string | null;
  bridgePayoutVerifiedAt: string | null;
  bridgeTransferId: string | null;
  createdAt: string;
  customerId: string | null;
  depositAddress: string | null;
  depositAmount: string | null;
  depositVerifiedAt: string | null;
  destinationCop: string;
  effectiveUsdCop: string | null;
  error: string | null;
  errorCode: string | null;
  externalAccountId: string | null;
  feeTxData: string | null;
  feeTxTo: string | null;
  fees: QuoteFeeLeg[];
  feesVerifiedAt: string | null;
  fromToken: BrebFromToken;
  idempotencyKey: string | null;
  integrationId: string;
  netUsdcToBridge: string;
  payoutId: string;
  quoteId: string | null;
  sourceAmount: string;
  sourceAmountUsd: string | null;
  sourceTxHash: string | null;
  status: BrebPayoutStatus;
  swapProvider: string | null;
  swapTxHash: string | null;
  txData: string | null;
  txTo: string | null;
  txValue: string | null;
  updatedAt: string;
  userAddress: string;
};

export type RequestLogRow = {
  errorCode?: string | null;
  id: string;
  integrationId: string;
  latencyMs?: number | null;
  method: string;
  path: string;
  status?: number | null;
};

export type CopmQuoteResult = {
  approvalTarget?: Address;
  copmIn: bigint;
  provider: "squid" | "uniswap_v3" | "mock";
  swapFeeUsd?: number;
  transaction?: PreparedTx;
};
