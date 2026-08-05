import type { Address } from "viem";
import { celo, celoSepolia } from "wagmi/chains";

export type SupportedNetworkKey = "celo" | "celo-sepolia";

export type SupportedTokenKey =
  | "copm"
  | "usdc"
  | "usdm"
  | "usdt"
  | "wbtc"
  | "weth";

export type TokenConfig = {
  key: SupportedTokenKey;
  symbol: string;
  name: string;
  address?: Address;
  decimals: number;
  feeCurrency?: Address;
  requiresApproval: boolean;
  enabled: boolean;
};

export type NetworkConfig = {
  key: SupportedNetworkKey;
  name: string;
  chain: typeof celo | typeof celoSepolia;
  chainId: number;
  squidChainId: string;
  blockExplorerUrl: string;
  rpcUrl: string;
  nativeCurrencySymbol: string;
  tokens: Record<SupportedTokenKey, TokenConfig>;
};

const CELO_RPC_URL =
  process.env.NEXT_PUBLIC_CELO_RPC_URL ?? "https://forno.celo.org";
const CELO_SEPOLIA_RPC_URL =
  process.env.NEXT_PUBLIC_CELO_SEPOLIA_RPC_URL ??
  "https://forno.celo-sepolia.celo-testnet.org";

export const NETWORK_CONFIG = {
  celo: {
    key: "celo",
    name: "Celo",
    chain: celo,
    chainId: celo.id,
    squidChainId: String(celo.id),
    blockExplorerUrl: "https://celoscan.io",
    rpcUrl: CELO_RPC_URL,
    nativeCurrencySymbol: "CELO",
    tokens: {
      copm: {
        key: "copm",
        symbol: "COPm",
        name: "Mento Colombian Peso",
        address: "0x8A567e2aE79CA692Bd748aB832081C45de4041eA",
        decimals: 18,
        requiresApproval: false,
        enabled: true,
      },
      usdc: {
        key: "usdc",
        symbol: "USDC",
        name: "USDC",
        address: "0xcebA9300f2b948710d2653dD7B07f33A8B32118C",
        decimals: 6,
        feeCurrency: "0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B",
        requiresApproval: true,
        enabled: true,
      },
      usdm: {
        key: "usdm",
        symbol: "USDm",
        name: "Mento Dollar",
        address: "0x765DE816845861e75A25fCA122bb6898B8B1282a",
        decimals: 18,
        requiresApproval: true,
        enabled: true,
      },
      usdt: {
        key: "usdt",
        symbol: "USDT",
        name: "Tether USD",
        address: "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e",
        decimals: 6,
        feeCurrency: "0x0e2a3e05bc9a16f5292a6170456a710cb89c6f72",
        requiresApproval: true,
        enabled: true,
      },
      wbtc: {
        key: "wbtc",
        symbol: "WBTC",
        name: "Wrapped BTC",
        address: "0x8aC2901Dd8A1F17a1A4768A6bA4C3751e3995B2D",
        decimals: 8,
        requiresApproval: true,
        enabled: true,
      },
      weth: {
        key: "weth",
        symbol: "ETH",
        name: "WETH on Celo",
        address: "0xD221812de1BD094f35587EE8E174B07B6167D9Af",
        decimals: 18,
        requiresApproval: true,
        enabled: true,
      },
    },
  },
  "celo-sepolia": {
    key: "celo-sepolia",
    name: "Celo Sepolia",
    chain: celoSepolia,
    chainId: celoSepolia.id,
    squidChainId: String(celoSepolia.id),
    blockExplorerUrl: "https://sepolia.celoscan.io",
    rpcUrl: CELO_SEPOLIA_RPC_URL,
    nativeCurrencySymbol: "CELO",
    tokens: {
      copm: {
        key: "copm",
        symbol: "COPm",
        name: "Mento Colombian Peso",
        address: "0x5F8d55c3627d2dc0a2B4afa798f877242F382F67",
        decimals: 18,
        requiresApproval: false,
        enabled: true,
      },
      usdc: {
        key: "usdc",
        symbol: "USDC",
        name: "USDC",
        address: "0x01C5C0122039549AD1493B8220cABEdD739BC44E",
        decimals: 6,
        requiresApproval: true,
        enabled: true,
      },
      usdm: {
        key: "usdm",
        symbol: "USDm",
        name: "Mento Dollar",
        address: "0xdE9e4C3ce781b4bA68120d6261cbad65ce0aB00b",
        decimals: 18,
        requiresApproval: true,
        enabled: true,
      },
      usdt: {
        key: "usdt",
        symbol: "USDT",
        name: "Tether USD",
        address: "0xd077A400968890Eacc75cdc901F0356c943e4fDb",
        decimals: 6,
        requiresApproval: true,
        enabled: true,
      },
      wbtc: {
        key: "wbtc",
        symbol: "WBTC",
        name: "Wrapped BTC",
        decimals: 8,
        requiresApproval: true,
        enabled: false,
      },
      weth: {
        key: "weth",
        symbol: "ETH",
        name: "WETH on Celo",
        address: "0x2cE73DC897A3E10b3FF3F86470847c36ddB735cf",
        decimals: 18,
        requiresApproval: true,
        enabled: true,
      },
    },
  },
} as const satisfies Record<SupportedNetworkKey, NetworkConfig>;

export const SUPPORTED_CHAINS = [
  NETWORK_CONFIG.celo.chain,
  NETWORK_CONFIG["celo-sepolia"].chain,
] as const;

export function getConfiguredNetworkKey(): SupportedNetworkKey {
  const configured = process.env.NEXT_PUBLIC_APP_NETWORK;
  return configured === "celo" || configured === "celo-sepolia"
    ? configured
    : "celo";
}

export function getNetworkByChainId(chainId?: number) {
  return Object.values(NETWORK_CONFIG).find(
    (network) => network.chainId === chainId
  );
}

export function getTargetNetwork() {
  return NETWORK_CONFIG[getConfiguredNetworkKey()];
}
