import type { BrebStore } from "./store";
import type {
  CustomerRow,
  ExternalAccountRow,
  FxCacheRow,
  OtpRow,
  PayoutRow,
  QuoteRow,
  RequestLogRow,
  WalletRow,
} from "./types";

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function createMemoryBrebStore(): BrebStore {
  const customers = new Map<string, CustomerRow>();
  const emails = new Map<string, string>();
  const wallets = new Map<string, WalletRow>();
  const quotes = new Map<string, QuoteRow>();
  const fx = new Map<string, FxCacheRow>();
  const otps: OtpRow[] = [];
  const accounts = new Map<string, ExternalAccountRow>();
  const payouts = new Map<string, PayoutRow>();
  const webhookIds = new Set<string>();
  const logs: RequestLogRow[] = [];

  return {
    async ensureReady() {},
    async getCustomer(customerId) {
      const row = customers.get(customerId);
      return row ? clone(row) : null;
    },
    async getCustomerByAddress(userAddress) {
      const wallet = wallets.get(userAddress.toLowerCase());
      if (!wallet) return null;
      return this.getCustomer(wallet.customerId);
    },
    async getCustomerByEmail(emailNormalized) {
      const customerId = emails.get(emailNormalized);
      if (!customerId) return null;
      return this.getCustomer(customerId);
    },
    async getExternalAccount(id) {
      const row = accounts.get(id);
      return row ? clone(row) : null;
    },
    async getFxCache(cacheKey) {
      const row = fx.get(cacheKey);
      return row ? clone(row) : null;
    },
    async getPayout(payoutId) {
      const row = payouts.get(payoutId);
      return row ? clone(row) : null;
    },
    async getPayoutByIdempotency(integrationId, idempotencyKey) {
      for (const payout of payouts.values()) {
        if (
          payout.integrationId === integrationId &&
          payout.idempotencyKey === idempotencyKey
        ) {
          return clone(payout);
        }
      }
      return null;
    },
    async getPayoutByTransferId(transferId) {
      for (const payout of payouts.values()) {
        if (payout.bridgeTransferId === transferId) return clone(payout);
      }
      return null;
    },
    async getPayoutByTxHash(txHash) {
      const normalized = txHash.toLowerCase();
      for (const payout of payouts.values()) {
        if (payout.sourceTxHash?.toLowerCase() === normalized) {
          return clone(payout);
        }
      }
      return null;
    },
    async getQuote(quoteId) {
      const row = quotes.get(quoteId);
      return row ? clone(row) : null;
    },
    async getWallet(userAddress) {
      const row = wallets.get(userAddress.toLowerCase());
      return row ? clone(row) : null;
    },
    async getActiveOtp(emailNormalized, userAddress) {
      const address = userAddress.toLowerCase();
      const row = [...otps]
        .reverse()
        .find(
          (otp) =>
            otp.emailNormalized === emailNormalized &&
            otp.userAddress === address &&
            !otp.consumedAt
        );
      return row ? clone(row) : null;
    },
    async linkWallet(wallet) {
      wallets.set(wallet.userAddress.toLowerCase(), {
        ...wallet,
        userAddress: wallet.userAddress.toLowerCase(),
      });
    },
    async listPayouts(integrationId, options) {
      const since = options?.since ? Date.parse(options.since) : 0;
      const limit = options?.limit ?? 100;
      const userAddress = options?.userAddress?.toLowerCase();
      return [...payouts.values()]
        .filter(
          (payout) =>
            payout.integrationId === integrationId &&
            Date.parse(payout.createdAt) >= since &&
            (!userAddress || payout.userAddress === userAddress)
        )
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(0, limit)
        .map(clone);
    },
    async logRequest(row) {
      logs.push(row);
    },
    async saveExternalAccount(row) {
      accounts.set(row.id, clone(row));
    },
    async saveOtp(row) {
      otps.push(clone(row));
    },
    async savePayout(row) {
      payouts.set(row.payoutId, clone(row));
    },
    async saveQuote(row) {
      quotes.set(row.quoteId, clone(row));
    },
    async saveWebhookEvent(eventId) {
      if (webhookIds.has(eventId)) return false;
      webhookIds.add(eventId);
      return true;
    },
    async setFxCache(row) {
      fx.set(row.cacheKey, clone(row));
    },
    async updateOtp(row) {
      const index = otps.findIndex((otp) => otp.id === row.id);
      if (index >= 0) otps[index] = clone(row);
    },
    async updatePayout(row) {
      payouts.set(row.payoutId, clone(row));
    },
    async upsertCustomer(row) {
      customers.set(row.customerId, clone(row));
      if (row.emailNormalized) emails.set(row.emailNormalized, row.customerId);
    },
  };
}
