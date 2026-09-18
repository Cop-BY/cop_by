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

export type BrebStore = {
  ensureReady(): Promise<void>;
  getCustomer(customerId: string): Promise<CustomerRow | null>;
  getCustomerByAddress(userAddress: string): Promise<CustomerRow | null>;
  getCustomerByEmail(emailNormalized: string): Promise<CustomerRow | null>;
  getExternalAccount(id: string): Promise<ExternalAccountRow | null>;
  getFxCache(cacheKey: string): Promise<FxCacheRow | null>;
  getPayout(payoutId: string): Promise<PayoutRow | null>;
  getPayoutByIdempotency(
    integrationId: string,
    idempotencyKey: string
  ): Promise<PayoutRow | null>;
  getPayoutByTransferId(transferId: string): Promise<PayoutRow | null>;
  getPayoutByTxHash(txHash: string): Promise<PayoutRow | null>;
  getQuote(quoteId: string): Promise<QuoteRow | null>;
  getWallet(userAddress: string): Promise<WalletRow | null>;
  getActiveOtp(emailNormalized: string, userAddress: string): Promise<OtpRow | null>;
  linkWallet(wallet: WalletRow): Promise<void>;
  listPayouts(
    integrationId: string,
    options?: { limit?: number; since?: string }
  ): Promise<PayoutRow[]>;
  logRequest(row: RequestLogRow): Promise<void>;
  saveExternalAccount(row: ExternalAccountRow): Promise<void>;
  saveOtp(row: OtpRow): Promise<void>;
  savePayout(row: PayoutRow): Promise<void>;
  saveQuote(row: QuoteRow): Promise<void>;
  saveWebhookEvent(
    eventId: string,
    eventType: string,
    payload: unknown
  ): Promise<boolean>;
  setFxCache(row: FxCacheRow): Promise<void>;
  updateOtp(row: OtpRow): Promise<void>;
  updatePayout(row: PayoutRow): Promise<void>;
  upsertCustomer(row: CustomerRow): Promise<void>;
};
