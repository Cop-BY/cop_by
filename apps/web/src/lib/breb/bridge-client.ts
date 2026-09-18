import { randomUUID } from "crypto";
import { getAddress, type Address } from "viem";

import { getBrebConfig } from "./config";
import { BrebError } from "./errors";

export type BridgeExchangeRate = {
  buyRate?: string;
  midmarketRate?: string;
  sellRate: string;
};

export type BridgeKycLinks = {
  customerId: string;
  kycLink: string;
  kycLinkExpiresAt: string;
  tosLink: string;
};

export type BridgeExternalAccount = {
  id: string;
  matched: boolean;
  validatedBankName?: string;
  validatedDocumentLast4?: string;
  verificationCompleted: boolean;
};

export type BridgeTransfer = {
  depositAddress: Address;
  depositAmount: string;
  id: string;
  status: string;
};

export type BridgeClient = {
  createExternalAccount(input: {
    accountOwnerName: string;
    breBKey: string;
    customerId: string;
  }): Promise<{ id: string }>;
  createKycLink(input: {
    email: string;
    fullName: string;
    redirectUri?: string;
  }): Promise<BridgeKycLinks>;
  createTransfer(input: {
    customerId: string;
    destinationCop: string;
    developerFeePercent: string;
    externalAccountId: string;
    fromAddress: Address;
    returnAddress: Address;
  }): Promise<BridgeTransfer>;
  getExchangeRate(): Promise<BridgeExchangeRate>;
  getTransfer(transferId: string): Promise<BridgeTransfer | null>;
  verifyExternalAccount(id: string): Promise<BridgeExternalAccount>;
};

type MockBridgeOptions = {
  onGetExchangeRate?: () => void;
  sellRate?: number;
};

function padAddress(index: number): Address {
  return getAddress(`0x${index.toString(16).padStart(40, "0")}`);
}

export function createMockBridgeClient(
  options: MockBridgeOptions = {}
): BridgeClient {
  const config = getBrebConfig();
  const sellRate = String(options.sellRate ?? config.mockSellRate);
  let accountCount = 0;
  let transferCount = 0;
  const accounts = new Map<
    string,
    {
      accountOwnerName: string;
      breBKey: string;
      customerId: string;
    }
  >();
  const transfers = new Map<string, BridgeTransfer>();

  return {
    async getExchangeRate() {
      options.onGetExchangeRate?.();
      return { midmarketRate: sellRate, sellRate };
    },
    async createKycLink(input) {
      const customerId = `cust_mock_${Buffer.from(input.email.toLowerCase()).toString("hex").slice(0, 16)}`;
      const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      return {
        customerId,
        kycLink: `https://bridge.xyz/kyc/mock/${customerId}`,
        kycLinkExpiresAt: expires,
        tosLink: `https://bridge.xyz/tos/mock/${customerId}`,
      };
    },
    async createExternalAccount(input) {
      accountCount += 1;
      const id = `ea_mock_${accountCount.toString().padStart(4, "0")}`;
      accounts.set(id, input);
      return { id };
    },
    async verifyExternalAccount(id) {
      const account = accounts.get(id);
      if (!account) {
        throw new BrebError("external_account_not_found", "External account not found", 404);
      }
      const mismatch =
        /mismatch/i.test(account.accountOwnerName) ||
        account.breBKey.replace(/\s/g, "").startsWith("0000");
      return {
        id,
        matched: !mismatch,
        validatedBankName: mismatch ? undefined : "Bancolombia",
        validatedDocumentLast4: mismatch ? undefined : "1234",
        verificationCompleted: true,
      };
    },
    async createTransfer(input) {
      transferCount += 1;
      const id = `tr_mock_${transferCount.toString().padStart(4, "0")}`;
      const transfer: BridgeTransfer = {
        depositAddress: padAddress(transferCount),
        depositAmount: input.destinationCop,
        id,
        status: "awaiting_funds",
      };
      transfers.set(id, transfer);
      return transfer;
    },
    async getTransfer(transferId) {
      return transfers.get(transferId) ?? null;
    },
  };
}

async function bridgeFetch<T>(
  path: string,
  init: RequestInit & { idempotencyKey?: string } = {}
) {
  const config = getBrebConfig();
  if (!config.bridgeApiKey) {
    throw new BrebError("bridge_not_configured", "Missing BRIDGE_API_KEY", 500);
  }

  const headers: Record<string, string> = {
    Accept: "application/json",
    "Api-Key": config.bridgeApiKey,
    ...(init.body ? { "Content-Type": "application/json" } : {}),
  };
  if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;

  const response = await fetch(`${config.bridgeApiBaseUrl}${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
  });
  const payload = (await response.json().catch(() => undefined)) as
    | (T & { code?: string; message?: string })
    | undefined;
  if (!response.ok) {
    throw new BrebError(
      payload?.code ?? "bridge_error",
      payload?.message ?? "Bridge request failed",
      response.status >= 400 && response.status < 600 ? response.status : 502,
      { path }
    );
  }
  return payload as T;
}

export function createHttpBridgeClient(): BridgeClient {
  return {
    async getExchangeRate() {
      const payload = await bridgeFetch<{
        buy_rate?: string;
        midmarket_rate?: string;
        sell_rate?: string;
      }>("/v0/exchange_rates?from=usd&to=cop");
      const sellRate = payload.sell_rate ?? payload.midmarket_rate;
      if (!sellRate) {
        throw new BrebError("bridge_rate_unavailable", "Bridge sell rate unavailable", 502);
      }
      return {
        buyRate: payload.buy_rate,
        midmarketRate: payload.midmarket_rate,
        sellRate,
      };
    },
    async createKycLink(input) {
      const payload = await bridgeFetch<{
        customer_id?: string;
        id?: string;
        kyc_link?: string;
        kyc_link_url?: string;
        tos_link?: string;
        tos_link_url?: string;
      }>("/v0/kyc_links", {
        body: JSON.stringify({
          email: input.email,
          endorsement: "cop",
          full_name: input.fullName,
          redirect_uri: input.redirectUri,
          type: "individual",
        }),
        method: "POST",
      });
      const customerId = payload.customer_id ?? payload.id;
      const kycLink = payload.kyc_link ?? payload.kyc_link_url;
      const tosLink = payload.tos_link ?? payload.tos_link_url;
      if (!customerId || !kycLink || !tosLink) {
        throw new BrebError("bridge_kyc_unavailable", "Bridge KYC links unavailable", 502);
      }
      return {
        customerId,
        kycLink,
        kycLinkExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        tosLink,
      };
    },
    async createExternalAccount(input) {
      const payload = await bridgeFetch<{ id: string }>(
        `/v0/customers/${input.customerId}/external_accounts`,
        {
          body: JSON.stringify({
            account_owner_name: input.accountOwnerName,
            account_type: "bre_b",
            bre_b_key: input.breBKey,
            currency: "cop",
          }),
          method: "POST",
        }
      );
      return { id: payload.id };
    },
    async verifyExternalAccount(id) {
      await bridgeFetch(`/v0/external_accounts/${id}/verify`, { method: "POST" });
      const payload = await bridgeFetch<{
        account_verification?: {
          completed_at?: string;
          details?: {
            bre_b?: { matched?: boolean };
          };
        };
        id: string;
        validated_bank_name?: string;
        validated_document_number_last4?: string;
      }>(`/v0/external_accounts/${id}`);
      return {
        id: payload.id,
        matched: payload.account_verification?.details?.bre_b?.matched === true,
        validatedBankName: payload.validated_bank_name,
        validatedDocumentLast4: payload.validated_document_number_last4,
        verificationCompleted: Boolean(payload.account_verification?.completed_at),
      };
    },
    async createTransfer(input) {
      const payload = await bridgeFetch<{
        id: string;
        source_deposit_instructions?: {
          to_address?: string;
          amount?: string;
        };
        state?: string;
        status?: string;
      }>("/v0/transfers", {
        body: JSON.stringify({
          amount: input.destinationCop,
          developer_fee_percent: input.developerFeePercent,
          destination: {
            currency: "cop",
            external_account_id: input.externalAccountId,
            payment_rail: "bre_b",
          },
          on_behalf_of: input.customerId,
          return_instructions: {
            return_address: input.returnAddress,
          },
          source: {
            currency: "usdc",
            from_address: input.fromAddress,
            payment_rail: "celo",
          },
        }),
        idempotencyKey: randomUUID(),
        method: "POST",
      });
      const depositAddress = payload.source_deposit_instructions?.to_address;
      if (!depositAddress) {
        throw new BrebError("bridge_deposit_missing", "Bridge deposit address missing", 502);
      }
      return {
        depositAddress: getAddress(depositAddress),
        depositAmount: payload.source_deposit_instructions?.amount ?? input.destinationCop,
        id: payload.id,
        status: payload.state ?? payload.status ?? "awaiting_funds",
      };
    },
    async getTransfer(transferId) {
      try {
        const payload = await bridgeFetch<{
          id: string;
          source_deposit_instructions?: { to_address?: string; amount?: string };
          state?: string;
          status?: string;
        }>(`/v0/transfers/${transferId}`);
        const depositAddress =
          payload.source_deposit_instructions?.to_address ??
          "0x0000000000000000000000000000000000000000";
        return {
          depositAddress: getAddress(depositAddress),
          depositAmount: payload.source_deposit_instructions?.amount ?? "0",
          id: payload.id,
          status: payload.state ?? payload.status ?? "unknown",
        };
      } catch (error) {
        if (error instanceof BrebError && error.status === 404) return null;
        throw error;
      }
    },
  };
}

export function createBridgeClient(): BridgeClient {
  return getBrebConfig().mock ? createMockBridgeClient() : createHttpBridgeClient();
}
