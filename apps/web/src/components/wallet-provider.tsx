"use client";

import { RainbowKitProvider, connectorsForWallets } from "@rainbow-me/rainbowkit";
import "@rainbow-me/rainbowkit/styles.css";
import { injectedWallet } from "@rainbow-me/rainbowkit/wallets";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { WagmiProvider, createConfig, http } from "wagmi";

import {
  NETWORK_CONFIG,
  SUPPORTED_CHAINS,
  getTargetNetwork,
} from "@/lib/network-config";

const connectors = connectorsForWallets(
  [
    {
      groupName: "Recommended",
      wallets: [injectedWallet],
    },
  ],
  {
    appName: "COP By",
    projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "cop_by",
  }
);

const wagmiConfig = createConfig({
  chains: SUPPORTED_CHAINS,
  connectors,
  transports: {
    [NETWORK_CONFIG.celo.chainId]: http(NETWORK_CONFIG.celo.rpcUrl),
    [NETWORK_CONFIG["celo-sepolia"].chainId]: http(
      NETWORK_CONFIG["celo-sepolia"].rpcUrl
    ),
  },
  ssr: true,
});

const queryClient = new QueryClient();

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider initialChain={getTargetNetwork().chain}>
          {mounted ? children : null}
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
