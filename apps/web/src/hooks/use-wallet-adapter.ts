"use client";

import { useEffect, useMemo, useState } from "react";
import {
  useConnectModal,
  useAccountModal,
  useChainModal,
} from "@rainbow-me/rainbowkit";
import {
  useAccount,
  useChainId,
  useConnect,
  useDisconnect,
  useSwitchChain,
} from "wagmi";

import {
  getNetworkByChainId,
  getTargetNetwork,
  type NetworkConfig,
} from "@/lib/network-config";

export type WalletRuntime = "minipay" | "browser" | "none";

export type WalletAdapterState = {
  address?: `0x${string}`;
  chainId?: number;
  currentNetwork?: NetworkConfig;
  targetNetwork: NetworkConfig;
  runtime: WalletRuntime;
  isMiniPay: boolean;
  isMetaMask: boolean;
  isConnected: boolean;
  isConnecting: boolean;
  isCorrectNetwork: boolean;
  hasProvider: boolean;
  connectBrowserWallet: () => void;
  disconnectWallet: () => void;
  switchToTargetNetwork: () => void;
  openConnectModal?: () => void;
  openAccountModal?: () => void;
  openChainModal?: () => void;
};

export function useWalletAdapter(): WalletAdapterState {
  const [runtime, setRuntime] = useState<WalletRuntime>("none");
  const [isMetaMask, setIsMetaMask] = useState(false);
  const [hasAttemptedMiniPayConnect, setHasAttemptedMiniPayConnect] =
    useState(false);

  const { address, isConnected, isConnecting } = useAccount();
  const chainId = useChainId();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();

  const { openConnectModal } = useConnectModal();
  const { openAccountModal } = useAccountModal();
  const { openChainModal } = useChainModal();

  const targetNetwork = getTargetNetwork();
  const currentNetwork = getNetworkByChainId(chainId);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const provider = (window as unknown as { ethereum?: { isMiniPay?: boolean; isMetaMask?: boolean } }).ethereum;
    setIsMetaMask(provider?.isMetaMask === true);

    if (provider?.isMiniPay) {
      setRuntime("minipay");
      return;
    }

    setRuntime(provider ? "browser" : "none");
  }, []);

  const injectedConnector = useMemo(
    () => connectors.find((connector) => connector.id === "injected"),
    [connectors]
  );

  useEffect(() => {
    if (
      runtime !== "minipay" ||
      hasAttemptedMiniPayConnect ||
      !injectedConnector
    ) {
      return;
    }

    connect({ connector: injectedConnector });
    setHasAttemptedMiniPayConnect(true);
  }, [connect, hasAttemptedMiniPayConnect, injectedConnector, runtime]);

  const connectBrowserWallet = async () => {
    // 1. Direct user activation prompt for injected extensions (e.g. Zeal, MetaMask)
    if (typeof window !== "undefined") {
      const eth = (window as unknown as { ethereum?: { request?: (args: { method: string }) => Promise<unknown> } }).ethereum;
      if (eth?.request) {
        try {
          await eth.request({ method: "eth_requestAccounts" });
        } catch (err) {
          console.warn("Direct eth_requestAccounts prompt:", err);
        }
      }
    }

    // 2. Connect via Wagmi
    const connector = injectedConnector ?? connectors[0];
    if (connector) {
      connect({ connector });
      return;
    }

    // 3. Fallback to RainbowKit modal
    if (openConnectModal) {
      openConnectModal();
    }
  };

  const switchToTargetNetwork = () => {
    if (openChainModal) {
      openChainModal();
      return;
    }
    switchChain({ chainId: targetNetwork.chainId });
  };

  return {
    address,
    chainId,
    currentNetwork,
    targetNetwork,
    runtime,
    isMiniPay: runtime === "minipay",
    isMetaMask,
    isConnected,
    isConnecting,
    isCorrectNetwork: chainId === targetNetwork.chainId,
    hasProvider: runtime !== "none" || Boolean(openConnectModal),
    connectBrowserWallet,
    disconnectWallet: disconnect,
    switchToTargetNetwork,
    openConnectModal,
    openAccountModal,
    openChainModal,
  };
}
