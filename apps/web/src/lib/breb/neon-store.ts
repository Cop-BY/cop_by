import { ensureBrebTables, getSql } from "../db";

import type { BrebStore } from "./store";
import type { QuoteFeeLeg } from "./quote-math";
import type {
  BrebFromToken,
  BrebPayoutStatus,
  CustomerRow,
  ExternalAccountRow,
  FxCacheRow,
  OtpRow,
  PayoutRow,
  QuoteRow,
  WalletRow,
} from "./types";

type QuoteDbRow = {
  created_at: string;
  destination_cop: string | null;
  effective_usd_cop: string;
  expires_at: string;
  fees: QuoteFeeLeg[] | string;
  from_token: BrebFromToken;
  integration_id: string;
  net_usdc_to_bridge: string | null;
  payload: Record<string, unknown> | string;
  quote_id: string;
  sell_rate: string;
  source_amount: string | null;
  source_amount_usd: string | null;
  swap_provider: string | null;
};

type CustomerDbRow = {
  cop_endorsement: string | null;
  created_at: string;
  customer_id: string;
  email_hash: string | null;
  email_normalized: string | null;
  full_name_hash: string | null;
  kyc_link: string | null;
  kyc_link_expires_at: string | null;
  kyc_status: CustomerRow["kycStatus"];
  tos_link: string | null;
  updated_at: string;
};

type WalletDbRow = {
  customer_id: string;
  email_verified_at: string | null;
  user_address: string;
};

type OtpDbRow = {
  attempts: number;
  code_hash: string;
  consumed_at: string | null;
  created_at: string;
  email_normalized: string;
  expires_at: string;
  id: string;
  user_address: string;
};

type ExternalAccountDbRow = {
  account_owner_name: string;
  bre_b_key_last4: string | null;
  created_at: string;
  customer_id: string;
  id: string;
  updated_at: string;
  validated_bank_name: string | null;
  validated_document_last4: string | null;
  verification_status: ExternalAccountRow["verificationStatus"];
};

type PayoutDbRow = {
  account_owner_name: string | null;
  additional_funding_usdc: string | null;
  approval_target: string | null;
  bre_b_key_last4: string | null;
  bridge_payout_verified_at: string | null;
  bridge_transfer_id: string | null;
  created_at: string;
  customer_id: string | null;
  deposit_address: string | null;
  deposit_amount: string | null;
  deposit_verified_at: string | null;
  destination_cop: string;
  effective_usd_cop: string | null;
  error: string | null;
  error_code: string | null;
  external_account_id: string | null;
  fee_tx_data: string | null;
  fee_tx_to: string | null;
  fees: QuoteFeeLeg[] | string;
  fees_verified_at: string | null;
  from_token: BrebFromToken;
  idempotency_key: string | null;
  integration_id: string;
  net_usdc_to_bridge: string;
  payout_id: string;
  quote_id: string | null;
  source_amount: string;
  source_amount_usd: string | null;
  source_tx_hash: string | null;
  status: BrebPayoutStatus;
  swap_provider: string | null;
  swap_tx_hash: string | null;
  tx_data: string | null;
  tx_to: string | null;
  tx_value: string | null;
  updated_at: string;
  user_address: string;
};

function parseJson<T>(value: T | string, fallback: T): T {
  if (typeof value !== "string") return value ?? fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mapQuote(row: QuoteDbRow): QuoteRow {
  return {
    createdAt: row.created_at,
    destinationCop: row.destination_cop,
    effectiveUsdCop: row.effective_usd_cop,
    expiresAt: row.expires_at,
    fees: parseJson(row.fees, []),
    fromToken: row.from_token,
    integrationId: row.integration_id,
    netUsdcToBridge: row.net_usdc_to_bridge,
    payload: parseJson(row.payload, {}),
    quoteId: row.quote_id,
    sellRate: row.sell_rate,
    sourceAmount: row.source_amount,
    sourceAmountUsd: row.source_amount_usd,
    swapProvider: row.swap_provider,
  };
}

function mapCustomer(row: CustomerDbRow): CustomerRow {
  return {
    copEndorsement: row.cop_endorsement,
    createdAt: row.created_at,
    customerId: row.customer_id,
    emailHash: row.email_hash,
    emailNormalized: row.email_normalized,
    fullNameHash: row.full_name_hash,
    kycLink: row.kyc_link,
    kycLinkExpiresAt: row.kyc_link_expires_at,
    kycStatus: row.kyc_status,
    tosLink: row.tos_link,
    updatedAt: row.updated_at,
  };
}

function mapOtp(row: OtpDbRow): OtpRow {
  return {
    attempts: row.attempts,
    codeHash: row.code_hash,
    consumedAt: row.consumed_at,
    createdAt: row.created_at,
    emailNormalized: row.email_normalized,
    expiresAt: row.expires_at,
    id: row.id,
    userAddress: row.user_address,
  };
}

function mapExternalAccount(row: ExternalAccountDbRow): ExternalAccountRow {
  return {
    accountOwnerName: row.account_owner_name,
    breBKeyLast4: row.bre_b_key_last4,
    createdAt: row.created_at,
    customerId: row.customer_id,
    id: row.id,
    updatedAt: row.updated_at,
    validatedBankName: row.validated_bank_name,
    validatedDocumentLast4: row.validated_document_last4,
    verificationStatus: row.verification_status,
  };
}

function mapPayout(row: PayoutDbRow): PayoutRow {
  return {
    accountOwnerName: row.account_owner_name,
    additionalFundingUsdc: row.additional_funding_usdc,
    approvalTarget: row.approval_target,
    breBKeyLast4: row.bre_b_key_last4,
    bridgePayoutVerifiedAt: row.bridge_payout_verified_at,
    bridgeTransferId: row.bridge_transfer_id,
    createdAt: row.created_at,
    customerId: row.customer_id,
    depositAddress: row.deposit_address,
    depositAmount: row.deposit_amount,
    depositVerifiedAt: row.deposit_verified_at,
    destinationCop: row.destination_cop,
    effectiveUsdCop: row.effective_usd_cop,
    error: row.error,
    errorCode: row.error_code,
    externalAccountId: row.external_account_id,
    feeTxData: row.fee_tx_data,
    feeTxTo: row.fee_tx_to,
    fees: parseJson(row.fees, []),
    feesVerifiedAt: row.fees_verified_at,
    fromToken: row.from_token,
    idempotencyKey: row.idempotency_key,
    integrationId: row.integration_id,
    netUsdcToBridge: row.net_usdc_to_bridge,
    payoutId: row.payout_id,
    quoteId: row.quote_id,
    sourceAmount: row.source_amount,
    sourceAmountUsd: row.source_amount_usd,
    sourceTxHash: row.source_tx_hash,
    status: row.status,
    swapProvider: row.swap_provider,
    swapTxHash: row.swap_tx_hash,
    txData: row.tx_data,
    txTo: row.tx_to,
    txValue: row.tx_value,
    updatedAt: row.updated_at,
    userAddress: row.user_address,
  };
}

export function createNeonBrebStore(): BrebStore {
  return {
    async ensureReady() {
      await ensureBrebTables();
    },
    async getCustomer(customerId) {
      const [row] = (await getSql()`
        SELECT * FROM bridge_customers WHERE customer_id = ${customerId} LIMIT 1
      `) as CustomerDbRow[];
      return row ? mapCustomer(row) : null;
    },
    async getCustomerByAddress(userAddress) {
      const [row] = (await getSql()`
        SELECT c.*
        FROM bridge_customer_wallets w
        JOIN bridge_customers c ON c.customer_id = w.customer_id
        WHERE w.user_address = ${userAddress.toLowerCase()}
        LIMIT 1
      `) as CustomerDbRow[];
      return row ? mapCustomer(row) : null;
    },
    async getCustomerByEmail(emailNormalized) {
      const [row] = (await getSql()`
        SELECT * FROM bridge_customers
        WHERE email_normalized = ${emailNormalized}
        LIMIT 1
      `) as CustomerDbRow[];
      return row ? mapCustomer(row) : null;
    },
    async getExternalAccount(id) {
      const [row] = (await getSql()`
        SELECT * FROM bridge_external_accounts WHERE id = ${id} LIMIT 1
      `) as ExternalAccountDbRow[];
      return row ? mapExternalAccount(row) : null;
    },
    async getFxCache(cacheKey) {
      const [row] = (await getSql()`
        SELECT cache_key, sell_rate, fetched_at, expires_at
        FROM breb_fx_cache
        WHERE cache_key = ${cacheKey}
        LIMIT 1
      `) as Array<{
        cache_key: string;
        expires_at: string;
        fetched_at: string;
        sell_rate: string;
      }>;
      if (!row) return null;
      return {
        cacheKey: row.cache_key,
        expiresAt: row.expires_at,
        fetchedAt: row.fetched_at,
        sellRate: row.sell_rate,
      } satisfies FxCacheRow;
    },
    async getPayout(payoutId) {
      const [row] = (await getSql()`
        SELECT * FROM breb_payouts WHERE payout_id = ${payoutId} LIMIT 1
      `) as PayoutDbRow[];
      return row ? mapPayout(row) : null;
    },
    async getPayoutByIdempotency(integrationId, idempotencyKey) {
      const [row] = (await getSql()`
        SELECT * FROM breb_payouts
        WHERE integration_id = ${integrationId}
          AND idempotency_key = ${idempotencyKey}
        LIMIT 1
      `) as PayoutDbRow[];
      return row ? mapPayout(row) : null;
    },
    async getPayoutByTransferId(transferId) {
      const [row] = (await getSql()`
        SELECT * FROM breb_payouts
        WHERE bridge_transfer_id = ${transferId}
        LIMIT 1
      `) as PayoutDbRow[];
      return row ? mapPayout(row) : null;
    },
    async getPayoutByTxHash(txHash) {
      const [row] = (await getSql()`
        SELECT * FROM breb_payouts
        WHERE lower(source_tx_hash) = ${txHash.toLowerCase()}
        LIMIT 1
      `) as PayoutDbRow[];
      return row ? mapPayout(row) : null;
    },
    async getQuote(quoteId) {
      const [row] = (await getSql()`
        SELECT * FROM breb_quotes WHERE quote_id = ${quoteId} LIMIT 1
      `) as QuoteDbRow[];
      return row ? mapQuote(row) : null;
    },
    async getWallet(userAddress) {
      const [row] = (await getSql()`
        SELECT user_address, customer_id, email_verified_at
        FROM bridge_customer_wallets
        WHERE user_address = ${userAddress.toLowerCase()}
        LIMIT 1
      `) as WalletDbRow[];
      if (!row) return null;
      return {
        customerId: row.customer_id,
        emailVerifiedAt: row.email_verified_at,
        userAddress: row.user_address,
      };
    },
    async getActiveOtp(emailNormalized, userAddress) {
      const [row] = (await getSql()`
        SELECT *
        FROM breb_email_otps
        WHERE email_normalized = ${emailNormalized}
          AND user_address = ${userAddress.toLowerCase()}
          AND consumed_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
      `) as OtpDbRow[];
      return row ? mapOtp(row) : null;
    },
    async linkWallet(wallet) {
      await getSql()`
        INSERT INTO bridge_customer_wallets (user_address, customer_id, email_verified_at)
        VALUES (
          ${wallet.userAddress.toLowerCase()},
          ${wallet.customerId},
          ${wallet.emailVerifiedAt}
        )
        ON CONFLICT (user_address) DO UPDATE SET
          customer_id = EXCLUDED.customer_id,
          email_verified_at = EXCLUDED.email_verified_at
      `;
    },
    async listPayouts(integrationId, options) {
      const since = options?.since ?? new Date(0).toISOString();
      const limit = Math.min(options?.limit ?? 100, 500);
      const userAddress = options?.userAddress?.toLowerCase() ?? null;
      const rows = (await getSql()`
        SELECT *
        FROM breb_payouts
        WHERE integration_id = ${integrationId}
          AND created_at >= ${since}
          AND (${userAddress}::text IS NULL OR user_address = ${userAddress})
        ORDER BY created_at ASC
        LIMIT ${limit}
      `) as PayoutDbRow[];
      return rows.map(mapPayout);
    },
    async logRequest(row) {
      await getSql()`
        INSERT INTO integration_request_logs (
          id, integration_id, path, method, status, error_code, latency_ms
        )
        VALUES (
          ${row.id},
          ${row.integrationId},
          ${row.path},
          ${row.method},
          ${row.status ?? null},
          ${row.errorCode ?? null},
          ${row.latencyMs ?? null}
        )
      `;
    },
    async saveExternalAccount(row) {
      await getSql()`
        INSERT INTO bridge_external_accounts (
          id, customer_id, bre_b_key_last4, account_owner_name,
          verification_status, validated_bank_name, validated_document_last4,
          created_at, updated_at
        )
        VALUES (
          ${row.id},
          ${row.customerId},
          ${row.breBKeyLast4},
          ${row.accountOwnerName},
          ${row.verificationStatus},
          ${row.validatedBankName},
          ${row.validatedDocumentLast4},
          ${row.createdAt},
          ${row.updatedAt}
        )
        ON CONFLICT (id) DO UPDATE SET
          verification_status = EXCLUDED.verification_status,
          validated_bank_name = EXCLUDED.validated_bank_name,
          validated_document_last4 = EXCLUDED.validated_document_last4,
          updated_at = EXCLUDED.updated_at
      `;
    },
    async saveOtp(row) {
      await getSql()`
        INSERT INTO breb_email_otps (
          id, email_normalized, user_address, code_hash, expires_at,
          attempts, consumed_at, created_at
        )
        VALUES (
          ${row.id},
          ${row.emailNormalized},
          ${row.userAddress},
          ${row.codeHash},
          ${row.expiresAt},
          ${row.attempts},
          ${row.consumedAt},
          ${row.createdAt}
        )
      `;
    },
    async savePayout(row) {
      await getSql()`
        INSERT INTO breb_payouts (
          payout_id, integration_id, user_address, customer_id, from_token,
          quote_id, destination_cop, source_amount, source_amount_usd,
          net_usdc_to_bridge, effective_usd_cop, swap_provider, deposit_address,
          deposit_amount, bridge_transfer_id, external_account_id,
          bre_b_key_last4, account_owner_name, status, fees, approval_target,
          tx_to, tx_data, tx_value, fee_tx_to, fee_tx_data, source_tx_hash,
          swap_tx_hash, idempotency_key, error, error_code,
          additional_funding_usdc, deposit_verified_at, fees_verified_at,
          bridge_payout_verified_at, created_at, updated_at
        )
        VALUES (
          ${row.payoutId},
          ${row.integrationId},
          ${row.userAddress},
          ${row.customerId},
          ${row.fromToken},
          ${row.quoteId},
          ${row.destinationCop},
          ${row.sourceAmount},
          ${row.sourceAmountUsd},
          ${row.netUsdcToBridge},
          ${row.effectiveUsdCop},
          ${row.swapProvider},
          ${row.depositAddress},
          ${row.depositAmount},
          ${row.bridgeTransferId},
          ${row.externalAccountId},
          ${row.breBKeyLast4},
          ${row.accountOwnerName},
          ${row.status},
          ${JSON.stringify(row.fees)}::jsonb,
          ${row.approvalTarget},
          ${row.txTo},
          ${row.txData},
          ${row.txValue},
          ${row.feeTxTo},
          ${row.feeTxData},
          ${row.sourceTxHash},
          ${row.swapTxHash},
          ${row.idempotencyKey},
          ${row.error},
          ${row.errorCode},
          ${row.additionalFundingUsdc},
          ${row.depositVerifiedAt},
          ${row.feesVerifiedAt},
          ${row.bridgePayoutVerifiedAt},
          ${row.createdAt},
          ${row.updatedAt}
        )
      `;
    },
    async saveQuote(row) {
      await getSql()`
        INSERT INTO breb_quotes (
          quote_id, integration_id, from_token, destination_cop, sell_rate,
          effective_usd_cop, source_amount, source_amount_usd,
          net_usdc_to_bridge, swap_provider, fees, payload, expires_at, created_at
        )
        VALUES (
          ${row.quoteId},
          ${row.integrationId},
          ${row.fromToken},
          ${row.destinationCop},
          ${row.sellRate},
          ${row.effectiveUsdCop},
          ${row.sourceAmount},
          ${row.sourceAmountUsd},
          ${row.netUsdcToBridge},
          ${row.swapProvider},
          ${JSON.stringify(row.fees)}::jsonb,
          ${JSON.stringify(row.payload)}::jsonb,
          ${row.expiresAt},
          ${row.createdAt}
        )
      `;
    },
    async saveWebhookEvent(eventId, eventType, payload) {
      const [row] = (await getSql()`
        INSERT INTO breb_webhook_events (event_id, event_type, payload)
        VALUES (${eventId}, ${eventType}, ${JSON.stringify(payload)}::jsonb)
        ON CONFLICT (event_id) DO NOTHING
        RETURNING event_id
      `) as Array<{ event_id: string }>;
      return Boolean(row);
    },
    async setFxCache(row) {
      await getSql()`
        INSERT INTO breb_fx_cache (cache_key, sell_rate, fetched_at, expires_at)
        VALUES (${row.cacheKey}, ${row.sellRate}, ${row.fetchedAt}, ${row.expiresAt})
        ON CONFLICT (cache_key) DO UPDATE SET
          sell_rate = EXCLUDED.sell_rate,
          fetched_at = EXCLUDED.fetched_at,
          expires_at = EXCLUDED.expires_at
      `;
    },
    async updateOtp(row) {
      await getSql()`
        UPDATE breb_email_otps SET
          attempts = ${row.attempts},
          consumed_at = ${row.consumedAt}
        WHERE id = ${row.id}
      `;
    },
    async updatePayout(row) {
      await getSql()`
        UPDATE breb_payouts SET
          status = ${row.status},
          source_tx_hash = ${row.sourceTxHash},
          swap_tx_hash = ${row.swapTxHash},
          deposit_verified_at = ${row.depositVerifiedAt},
          fees_verified_at = ${row.feesVerifiedAt},
          bridge_payout_verified_at = ${row.bridgePayoutVerifiedAt},
          additional_funding_usdc = ${row.additionalFundingUsdc},
          error = ${row.error},
          error_code = ${row.errorCode},
          fees = ${JSON.stringify(row.fees)}::jsonb,
          updated_at = ${row.updatedAt}
        WHERE payout_id = ${row.payoutId}
      `;
    },
    async upsertCustomer(row) {
      await getSql()`
        INSERT INTO bridge_customers (
          customer_id, email_normalized, email_hash, full_name_hash,
          kyc_status, cop_endorsement, kyc_link, tos_link, kyc_link_expires_at,
          created_at, updated_at
        )
        VALUES (
          ${row.customerId},
          ${row.emailNormalized},
          ${row.emailHash},
          ${row.fullNameHash},
          ${row.kycStatus},
          ${row.copEndorsement},
          ${row.kycLink},
          ${row.tosLink},
          ${row.kycLinkExpiresAt},
          ${row.createdAt},
          ${row.updatedAt}
        )
        ON CONFLICT (customer_id) DO UPDATE SET
          email_normalized = EXCLUDED.email_normalized,
          email_hash = EXCLUDED.email_hash,
          full_name_hash = EXCLUDED.full_name_hash,
          kyc_status = EXCLUDED.kyc_status,
          cop_endorsement = EXCLUDED.cop_endorsement,
          kyc_link = EXCLUDED.kyc_link,
          tos_link = EXCLUDED.tos_link,
          kyc_link_expires_at = EXCLUDED.kyc_link_expires_at,
          updated_at = EXCLUDED.updated_at
      `;
    },
  };
}
