import { getAddress, isAddress, type Address } from "viem";

import { getTargetNetwork } from "../network-config";

export const BREB_MIN_COP_DEFAULT = 4000;
export const BREB_MIN_USDC_DEFAULT = 2;
export const COPBY_FEE_BPS_DEFAULT = 100;
export const BRIDGE_DEVELOPER_FEE_BPS_DEFAULT = 50;
export const BRIDGE_FX_PADDING_BPS_DEFAULT = 100;
export const BREB_FX_TTL_HOURS_DEFAULT = 6;
export const BREB_OTP_TTL_MINUTES_DEFAULT = 10;
export const BREB_OTP_RESEND_SECONDS_DEFAULT = 30;
export const BREB_OTP_MAX_ATTEMPTS_DEFAULT = 5;
export const BREB_SWAP_SLIPPAGE_BPS_DEFAULT = 50;

export const CELO_UNISWAP_V3_SWAP_ROUTER =
  "0x5615CDAb10dc425a742d643d949a7F474C01abc4" as Address;
export const CELO_UNISWAP_V3_QUOTER_V2 =
  "0x82825d0554fA07f7FC52Ab63c961F330fdEFa8E8" as Address;
export const MOCK_FEE_WALLET =
  "0x1111111111111111111111111111111111111111" as Address;
export const COPBY_INTEGRATION_ID = "copby";
export const BREB_MOCK_OTP_DEFAULT = "123456";

export function getMockOtpCode() {
  const configured = process.env.BREB_MOCK_OTP?.trim();
  return configured && /^\d{6}$/.test(configured)
    ? configured
    : BREB_MOCK_OTP_DEFAULT;
}

function envNumber(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function envAddress(name: string, fallback?: Address) {
  const raw = process.env[name]?.trim();
  if (raw && isAddress(raw)) return getAddress(raw);
  return fallback;
}

export function isBridgeMock() {
  const flag = process.env.BRIDGE_MOCK?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  if (flag === "true" || flag === "1") return true;
  return !process.env.BRIDGE_API_KEY;
}

export function getBrebConfig() {
  const mock = isBridgeMock();
  return {
    bridgeApiBaseUrl:
      process.env.BRIDGE_API_BASE_URL?.trim() || "https://api.bridge.xyz",
    bridgeApiKey: process.env.BRIDGE_API_KEY?.trim() ?? "",
    bridgeWebhookSecret: process.env.BRIDGE_WEBHOOK_SECRET?.trim() ?? "",
    copbyFeeBps: envNumber("COPBY_FEE_BPS", COPBY_FEE_BPS_DEFAULT),
    copbyFeeWallet:
      envAddress("COPBY_FEE_WALLET") ?? (mock ? MOCK_FEE_WALLET : undefined),
    developerFeeBps: Math.round(
      envNumber("BRIDGE_DEVELOPER_FEE_PERCENT", 0.5) * 100
    ) || BRIDGE_DEVELOPER_FEE_BPS_DEFAULT,
    fxPaddingBps: envNumber("BRIDGE_FX_PADDING_BPS", BRIDGE_FX_PADDING_BPS_DEFAULT),
    fxTtlHours: envNumber("BREB_FX_TTL_HOURS", BREB_FX_TTL_HOURS_DEFAULT),
    minCop: envNumber("BREB_MIN_COP", BREB_MIN_COP_DEFAULT),
    minUsdc: envNumber("BREB_MIN_USDC", BREB_MIN_USDC_DEFAULT),
    mock,
    mockAutoApproveKyc: mock && process.env.BREB_MOCK_AUTO_APPROVE_KYC !== "false",
    mockSellRate: envNumber("BREB_MOCK_SELL_RATE", 4000),
    otpMaxAttempts: envNumber("BREB_OTP_MAX_ATTEMPTS", BREB_OTP_MAX_ATTEMPTS_DEFAULT),
    otpResendSeconds: envNumber(
      "BREB_OTP_RESEND_SECONDS",
      BREB_OTP_RESEND_SECONDS_DEFAULT
    ),
    otpTtlMinutes: envNumber("BREB_OTP_TTL_MINUTES", BREB_OTP_TTL_MINUTES_DEFAULT),
    swapSlippageBps: envNumber("BREB_SWAP_SLIPPAGE_BPS", BREB_SWAP_SLIPPAGE_BPS_DEFAULT),
    uniswapPool: envAddress("UNISWAP_V3_COPM_USDC_POOL"),
    uniswapPoolFee: envNumber("UNISWAP_V3_POOL_FEE", 0),
    uniswapQuoter:
      envAddress("UNISWAP_V3_QUOTER") ?? CELO_UNISWAP_V3_QUOTER_V2,
    uniswapRouter:
      envAddress("UNISWAP_V3_SWAP_ROUTER") ?? CELO_UNISWAP_V3_SWAP_ROUTER,
  };
}

export function getBrebTokenAddresses() {
  const network = getTargetNetwork();
  const usdc = network.tokens.usdc.address;
  const copm = network.tokens.copm.address;
  if (!usdc || !copm) {
    throw new Error("Missing USDC/COPm token config");
  }

  return {
    chainId: network.chainId,
    copm,
    copmDecimals: network.tokens.copm.decimals,
    rpcUrl: network.rpcUrl,
    usdc,
    usdcDecimals: network.tokens.usdc.decimals,
  };
}
