"use client";

import { HelpCircle } from "lucide-react";

import { OPEN_ONBOARDING_EVENT } from "@/components/onboarding-screen";
import {
  AddressBadge,
  ConnectButton,
  NetworkBadge,
} from "@/components/connect-button";
import { useWalletAdapter } from "@/hooks/use-wallet-adapter";

const COPM_ICON_URL = "https://app.mento.org/tokens/COPm.svg";

export function Navbar() {
  const { isMiniPay } = useWalletAdapter();

  return (
    <header className="sticky top-0 z-50 w-full border-b border-[#DDE4DC] bg-[#F7F8F5]/95 backdrop-blur">
      <div className="mx-auto flex h-12 w-full max-w-md items-center justify-between px-3 sm:max-w-lg sm:px-4 md:max-w-2xl">
        <div className="flex shrink-0 items-center gap-2">
          <img
            src={COPM_ICON_URL}
            alt="COPm"
            className="h-7 w-7 shrink-0 rounded-[8px]"
          />
          <div className="hidden sm:block">
            <p className="text-sm font-semibold leading-none text-[#17211B]">
              COPm
            </p>
            <p className="mt-0.5 text-[11px] leading-none text-[#66736B]">
              USD → pesos en MiniPay
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <NetworkBadge />
          {isMiniPay ? <AddressBadge /> : <ConnectButton />}
          <button
            type="button"
            aria-label="Ayuda"
            onClick={() => window.dispatchEvent(new CustomEvent(OPEN_ONBOARDING_EVENT))}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[#DDE4DC] bg-white text-[#66736B] transition-colors hover:bg-[#F2F4F0] active:scale-95 sm:h-9 sm:w-9"
          >
            <HelpCircle className="h-[18px] w-[18px]" />
          </button>
        </div>
      </div>
    </header>
  );
}
