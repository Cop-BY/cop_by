import {
  isAddress,
  keccak256,
  toBytes,
  verifyTypedData,
  type Address,
  type Hex,
  type TypedDataDomain,
} from "viem";

export const AGENT_SESSION_DOMAIN_NAME = "COP By Agent Trading";
export const AGENT_SESSION_DOMAIN_VERSION = "1";
export const AGENT_SESSION_DURATION_SECONDS = 24 * 60 * 60;
export const AGENT_SESSION_MAX_TRADE_USD_DECIMALS = 6;
export const AGENT_SESSION_MAX_TRADE_USD =
  50n * 10n ** BigInt(AGENT_SESSION_MAX_TRADE_USD_DECIMALS);
export const AGENT_SESSION_MAX_USDT_TRADE = AGENT_SESSION_MAX_TRADE_USD;
export const AGENT_SESSION_MAX_USDT_VOLUME = 150n * 10n ** 6n;
export const AGENT_SESSION_MAX_COPM_TRADE = 200_000n * 10n ** 18n;
export const AGENT_SESSION_MAX_COPM_VOLUME = 600_000n * 10n ** 18n;
export const AGENT_SESSION_ALLOWED_PAIR_COPM_USDT = keccak256(
  toBytes("COPm/USDT")
);

export const agentTradingSessionTypes = {
  AgentTradingSession: [
    { name: "sessionId", type: "bytes32" },
    { name: "user", type: "address" },
    { name: "agent", type: "address" },
    { name: "chainId", type: "uint256" },
    { name: "allowedPair", type: "bytes32" },
    { name: "maxTradeUsd", type: "uint256" },
    { name: "expiresAt", type: "uint64" },
  ],
} as const;

export type AgentTradingSessionMessage = {
  agent: Address;
  allowedPair: Hex;
  chainId: bigint;
  expiresAt: bigint;
  maxTradeUsd: bigint;
  sessionId: Hex;
  user: Address;
};

export type BuildAgentTradingSessionParams = {
  agentAddress: Address;
  chainId: number;
  expiresAt: Date | number | bigint;
  maxTradeUsd?: bigint;
  sessionId: Hex;
  userAddress: Address;
};

export type AgentTradingSessionDomainParams = {
  chainId: number;
  verifyingContract: Address;
};

export function buildAgentTradingSessionDomain({
  chainId,
  verifyingContract,
}: AgentTradingSessionDomainParams): TypedDataDomain {
  if (!isAddress(verifyingContract)) {
    throw new Error("Invalid agent registry address.");
  }

  return {
    chainId,
    name: AGENT_SESSION_DOMAIN_NAME,
    verifyingContract,
    version: AGENT_SESSION_DOMAIN_VERSION,
  };
}

export function getAgentSessionExpiresAt(now = new Date()) {
  return BigInt(
    Math.floor(now.getTime() / 1000) + AGENT_SESSION_DURATION_SECONDS
  );
}

export function buildAgentTradingSessionMessage({
  agentAddress,
  chainId,
  expiresAt,
  maxTradeUsd = AGENT_SESSION_MAX_TRADE_USD,
  sessionId,
  userAddress,
}: BuildAgentTradingSessionParams): AgentTradingSessionMessage {
  if (!isAddress(userAddress)) throw new Error("Invalid user address.");
  if (!isAddress(agentAddress)) throw new Error("Invalid agent address.");
  if (!/^0x[0-9a-fA-F]{64}$/.test(sessionId)) {
    throw new Error("Invalid agent session id.");
  }

  const expiresAtSeconds =
    expiresAt instanceof Date
      ? BigInt(Math.floor(expiresAt.getTime() / 1000))
      : BigInt(expiresAt);

  if (expiresAtSeconds <= 0n) throw new Error("Invalid session expiration.");
  if (maxTradeUsd <= 0n) throw new Error("Invalid max trade amount.");

  return {
    agent: agentAddress,
    allowedPair: AGENT_SESSION_ALLOWED_PAIR_COPM_USDT,
    chainId: BigInt(chainId),
    expiresAt: expiresAtSeconds,
    maxTradeUsd,
    sessionId,
    user: userAddress,
  };
}

export async function verifyAgentTradingSessionSignature({
  domain,
  message,
  signature,
}: {
  domain: TypedDataDomain;
  message: AgentTradingSessionMessage;
  signature: Hex;
}) {
  return verifyTypedData({
    address: message.agent,
    domain,
    message,
    primaryType: "AgentTradingSession",
    signature,
    types: agentTradingSessionTypes,
  });
}
