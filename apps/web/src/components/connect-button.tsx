"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, LogOut, Wallet } from "lucide-react";
import { erc20Abi } from "viem";
import { useReadContract } from "wagmi";

import { useWalletAdapter } from "@/hooks/use-wallet-adapter";
import { formatPesoAmountFromBigInt } from "@/lib/format-peso";

const COPM_ICON_URL = "https://app.mento.org/tokens/COPm.svg";

function formatCopmBalance(value?: bigint, decimals = 18) {
  if (value === undefined) return "0";
  return formatPesoAmountFromBigInt(value, decimals);
}

function formatAddressPreview(address: string) {
  if (address.length <= 14) return address;
  return `${address.slice(0, 7)}...${address.slice(-4)}`;
}

function formatAddressCompact(address: string) {
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}...${address.slice(-3)}`;
}

function getShortNetworkName(name: string) {
  const lower = name.toLowerCase();
  if (lower.includes("sepolia")) return "Sepolia";
  if (lower.includes("alfajores")) return "Alfajores";
  if (lower.includes("celo")) return "Celo";
  return name.length > 8 ? `${name.slice(0, 7)}…` : name;
}

export function NetworkBadge() {
  const {
    currentNetwork,
    isConnected,
    isCorrectNetwork,
    openChainModal,
    switchToTargetNetwork,
    targetNetwork,
  } = useWalletAdapter();

  const networkName = isConnected
    ? currentNetwork?.name ?? targetNetwork.name
    : targetNetwork.name;
  const shortNetworkName = getShortNetworkName(networkName);
  const isWrongNetwork = isConnected && !isCorrectNetwork;

  const handleClick = () => {
    if (openChainModal) {
      openChainModal();
      return;
    }
    if (isWrongNetwork) {
      switchToTargetNetwork();
    } else {
      window.open(targetNetwork.blockExplorerUrl, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      title={
        isWrongNetwork
          ? `Red incorrecta: Haz clic para cambiar a ${targetNetwork.name}`
          : `Red: ${networkName} (Activa)`
      }
      aria-label={`Red: ${networkName}`}
      className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold transition-all hover:bg-[#F2F4F0] active:scale-95 sm:h-9 sm:px-3 ${
        isWrongNetwork
          ? "border-[#F2C94C] bg-[#FFF6D8] text-[#7A5800]"
          : "border-[#DDE4DC] bg-white text-[#17211B]"
      }`}
    >
      {isWrongNetwork ? (
        <span className="relative flex h-2 w-2 items-center justify-center shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
        </span>
      ) : (
        <span className="relative flex h-2 w-2 items-center justify-center shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
      )}
      <span className="sm:hidden">{shortNetworkName}</span>
      <span className="hidden sm:inline">{networkName}</span>
    </button>
  );
}

export function CopmBalanceBadge() {
  const {
    address,
    currentNetwork,
    isConnected,
    isCorrectNetwork,
    targetNetwork,
  } = useWalletAdapter();
  const activeNetwork = currentNetwork ?? targetNetwork;
  const copmToken = activeNetwork.tokens.copm;
  const copmBalance = useReadContract({
    address: copmToken.address,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: {
      enabled: Boolean(isConnected && isCorrectNetwork && address && copmToken.address),
      refetchInterval: 10_000,
    },
  });

  if (!isConnected || !isCorrectNetwork) return null;

  return (
    <span className="hidden sm:inline-flex h-8 sm:h-9 max-w-[132px] shrink-0 items-center gap-1.5 truncate rounded-full border border-[#DDD2F3] bg-[#F2ECFF] px-2 sm:px-2.5 text-[11px] font-semibold text-[#6D45B8]">
      <img
        src={COPM_ICON_URL}
        alt="COPm"
        className="h-4 w-4 shrink-0 rounded-full"
      />
      <span className="truncate">
        {formatCopmBalance(copmBalance.data, copmToken.decimals)}
      </span>
    </span>
  );
}

export function AddressBadge() {
  const {
    address,
    disconnectWallet,
    isConnected,
    isMiniPay,
    openAccountModal,
    targetNetwork,
  } = useWalletAdapter();
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  if (!isConnected || !address) return null;

  const copyAddress = () => {
    void navigator.clipboard?.writeText(address);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  const handleBadgeClick = () => {
    if (openAccountModal) {
      openAccountModal();
      return;
    }
    setMenuOpen((prev) => !prev);
  };

  const explorerUrl = `${targetNetwork.blockExplorerUrl}/address/${address}`;

  return (
    <div className="relative shrink min-w-0" ref={menuRef}>
      <button
        type="button"
        onClick={handleBadgeClick}
        aria-label="Opciones de wallet"
        aria-expanded={menuOpen}
        className="inline-flex h-8 sm:h-9 max-w-[100px] sm:max-w-[136px] shrink-0 items-center gap-1 sm:gap-1.5 rounded-full border border-[#DDE4DC] bg-white px-2 sm:px-2.5 text-[11px] font-semibold text-[#17211B] transition-colors hover:bg-[#F2F4F0] active:scale-95"
      >
        <Wallet className="h-3.5 w-3.5 shrink-0 text-[#66736B]" />
        <span className="truncate sm:hidden">{formatAddressCompact(address)}</span>
        <span className="truncate hidden sm:inline">{formatAddressPreview(address)}</span>
      </button>

      {menuOpen && (
        <div className="absolute right-0 top-10 z-50 w-56 rounded-xl border border-[#DDE4DC] bg-white p-2 shadow-lg sm:top-11">
          <div className="border-b border-[#F2F4F0] px-2.5 py-2">
            <p className="text-[10px] font-medium text-[#66736B]">Wallet conectada</p>
            <p className="mt-0.5 truncate text-xs font-semibold text-[#17211B]">
              {address}
            </p>
          </div>
          <div className="mt-1 space-y-0.5">
            <button
              type="button"
              onClick={copyAddress}
              className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-[#17211B] transition-colors hover:bg-[#F7F8F5]"
            >
              <span className="flex items-center gap-2">
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-[#0E7C4F]" />
                ) : (
                  <Copy className="h-3.5 w-3.5 text-[#66736B]" />
                )}
                {copied ? "¡Dirección copiada!" : "Copiar dirección"}
              </span>
            </button>
            <a
              href={explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setMenuOpen(false)}
              className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-[#17211B] transition-colors hover:bg-[#F7F8F5]"
            >
              <span className="flex items-center gap-2">
                <ExternalLink className="h-3.5 w-3.5 text-[#66736B]" />
                Ver en explorador
              </span>
            </a>
            {!isMiniPay && (
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  disconnectWallet();
                }}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-[#C53030] transition-colors hover:bg-[#FFF5F5]"
              >
                <LogOut className="h-3.5 w-3.5" />
                Desconectar
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function ConnectButton() {
  const {
    connectBrowserWallet,
    isConnected,
    isConnecting,
    isCorrectNetwork,
    isMiniPay,
    switchToTargetNetwork,
    targetNetwork,
  } = useWalletAdapter();

  if (isMiniPay) return null;

  if (isConnected && !isCorrectNetwork) {
    return (
      <button
        type="button"
        onClick={switchToTargetNetwork}
        className="inline-flex h-8 sm:h-9 shrink-0 items-center gap-1.5 rounded-full border border-[#F2C94C] bg-[#FFF6D8] px-2.5 sm:px-3 text-[11px] sm:text-xs font-semibold text-[#7A5800] transition-colors hover:bg-[#FFEAA7] active:scale-95 cursor-pointer"
      >
        Cambiar a {targetNetwork.name}
      </button>
    );
  }

  if (isConnected) {
    return (
      <div className="flex shrink items-center gap-1 sm:gap-1.5 min-w-0">
        <CopmBalanceBadge />
        <AddressBadge />
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={connectBrowserWallet}
      className="inline-flex h-8 sm:h-9 shrink-0 items-center gap-1.5 rounded-full border border-[#DDE4DC] bg-white px-2.5 sm:px-3 text-[11px] sm:text-xs font-semibold text-[#17211B] transition-colors hover:bg-[#F2F4F0] active:scale-95 cursor-pointer"
    >
      <Wallet className="h-3.5 w-3.5 shrink-0 text-[#66736B]" />
      <span>{isConnecting ? "Conectando..." : "Conectar"}</span>
    </button>
  );
}
