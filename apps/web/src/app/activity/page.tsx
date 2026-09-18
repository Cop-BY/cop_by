"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";

import { useWalletAdapter } from "@/hooks/use-wallet-adapter";
import {
  fetchUserActivity,
  formatActivityDate,
  getActivityRecipientLabel,
  getActivityStatusLabel,
  getActivityStatusTone,
  getActivityTitle,
  isActivityCredit,
  type ActivityItem,
} from "@/lib/activity";
import { getRecipientAlias } from "@/lib/saved-recipients";
import { formatPesoAmountFromString } from "@/lib/format-peso";
import { getTargetNetwork } from "@/lib/network-config";

function formatAddressPreview(address: string) {
  if (address.length <= 14) return address;
  return `${address.slice(0, 7)}...${address.slice(-4)}`;
}

function formatRecipient(address: string | null) {
  if (!address) return "—";
  const alias = getRecipientAlias(address);
  if (alias) return `${alias} (${formatAddressPreview(address)})`;
  return formatAddressPreview(address);
}

function ActivityCard({
  item,
  explorerUrl,
}: {
  item: ActivityItem;
  explorerUrl: string;
}) {
  const title = getActivityTitle(item);
  const amountPrefix = isActivityCredit(item) ? "+" : "−";
  const statusLabel = getActivityStatusLabel(item.status, item.error);
  const statusTone = getActivityStatusTone(item.status, item.error);

  return (
    <div className="rounded-[8px] border border-[#DDE4DC] bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[#17211B]">{title}</p>
          <p className="mt-1 text-xs text-[#66736B]">
            {getActivityRecipientLabel(item)}{" "}
            {item.type === "breb"
              ? item.recipientAddress ?? "cuenta Bre-B"
              : formatRecipient(item.recipientAddress)}
          </p>
        </div>
        <span
          className={`inline-flex shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusTone}`}
        >
          {statusLabel}
        </span>
      </div>
      <p className="mt-3 text-xl font-semibold text-[#0E7C4F]">
        {amountPrefix}
        {formatPesoAmountFromString(item.amount)}{" "}
        {item.type === "breb" ? "COP" : "pesos"}
      </p>
      <p className="mt-1 text-xs text-[#66736B]">{formatActivityDate(item.createdAt)}</p>
      {item.txHash && (
        <a
          href={`${explorerUrl}/tx/${item.txHash}`}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-block text-xs font-semibold text-[#6D45B8] underline-offset-2 hover:underline"
        >
          Ver transacción
        </a>
      )}
    </div>
  );
}

export default function ActivityPage() {
  const { address, isConnected } = useWalletAdapter();
  const targetNetwork = getTargetNetwork();
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadActivity = useCallback(async () => {
    if (!address) {
      setItems([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const nextItems = await fetchUserActivity(address);
      setItems(nextItems);
    } catch {
      setError("No pudimos cargar tu actividad.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    void loadActivity();
  }, [loadActivity]);

  return (
    <main className="min-h-[calc(100vh-3rem)] bg-[#F7F8F5] text-[#17211B]">
      <section className="mx-auto w-full max-w-md px-4 py-5 sm:max-w-lg md:max-w-2xl">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-sm font-semibold text-[#66736B] hover:text-[#0E7C4F]"
        >
          <ArrowLeft className="h-4 w-4" />
          Volver
        </Link>
        <h1 className="mt-4 text-2xl font-bold">Mi actividad</h1>
        <p className="mt-1 text-sm text-[#66736B]">
          Conversiones, ventas, envíos y COP a cuentas Bre-B.
        </p>

        {!isConnected || !address ? (
          <div className="mt-8 rounded-[8px] border border-[#DDE4DC] bg-white p-5 text-sm text-[#66736B]">
            Conecta tu wallet para ver tu historial.
          </div>
        ) : loading ? (
          <div className="mt-8 rounded-[8px] border border-[#DDE4DC] bg-white p-5 text-sm text-[#66736B]">
            Cargando actividad…
          </div>
        ) : error ? (
          <div className="mt-8 space-y-3">
            <div className="rounded-[8px] border border-[#DDE4DC] bg-white p-5 text-sm text-[#8A1F1F]">
              {error}
            </div>
            <button
              type="button"
              onClick={() => void loadActivity()}
              className="text-sm font-semibold text-[#6D45B8] underline-offset-2 hover:underline"
            >
              Reintentar
            </button>
          </div>
        ) : items.length === 0 ? (
          <div className="mt-8 rounded-[8px] border border-[#DDE4DC] bg-white p-5 text-sm text-[#66736B]">
            Aún no tienes operaciones. Convierte, vende o envía para verlas aquí.
          </div>
        ) : (
          <div className="mt-6 space-y-3">
            {items.map((item) => (
              <ActivityCard
                key={`${item.type}-${item.id}`}
                item={item}
                explorerUrl={targetNetwork.blockExplorerUrl}
              />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
