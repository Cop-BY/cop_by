import Link from "next/link";

import {
  ensureIntegrationSwapTable,
  ensureSwapTable,
  ensureTransferTable,
  getSql,
} from "@/lib/db";
import { getTargetNetwork } from "@/lib/network-config";

export const dynamic = "force-dynamic";

type SwapRow = {
  chain_id: number;
  copm_received: string | null;
  created_at: string;
  error: string | null;
  fee_usd: string | null;
  intent_id: string;
  onchain_log_tx_hash: string | null;
  output_amount: string | null;
  output_token: string | null;
  requested_copm: string;
  squid_request_ids: unknown;
  status: string;
  swap_type: string | null;
  swap_tx_hashes: unknown;
  tokens_spent: unknown;
  user_address: string;
};

type TokenSpend = {
  amount?: string;
  amountUsd?: number;
  symbol?: string;
};

type TransferRow = {
  copm_amount: string;
  created_at: string;
  recipient_address: string;
  sender_address: string;
  status: string;
  transfer_id: string;
  tx_hash: string | null;
};

type IntegrationSwapRow = {
  actual_output_amount: string | null;
  created_at: string;
  error: string | null;
  input_amount: string;
  status: string;
  user_address: string;
};

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    style: "currency",
  }).format(value);
}

function number(value: number, maximumFractionDigits = 0) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value);
}

function metricNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;
  const normalized = value.replace(/,/g, "").trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function atomicUsdt(value: string | null) {
  if (!value || !/^[0-9]+$/.test(value)) return 0;
  return Number(value) / 1_000_000;
}

function atomicCopm(value: string | null) {
  if (!value || !/^[0-9]+$/.test(value)) return 0;
  return Number(value) / 1_000_000_000_000_000_000;
}

function percent(value: number) {
  return `${number(value, 1)}%`;
}

function shortAddress(address?: string | null) {
  if (!address) return "Not set";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function getTokensSpent(row: SwapRow) {
  return asArray(row.tokens_spent) as TokenSpend[];
}

function isCompleted(row: SwapRow) {
  return ["confirmed", "logged"].includes(row.status);
}

function getVolumeUsd(rows: SwapRow[]) {
  return rows.reduce(
    (sum, row) =>
      sum +
      getTokensSpent(row).reduce(
        (tokenSum, token) => tokenSum + metricNumber(token.amountUsd),
        0
      ),
    0
  );
}

async function getRows() {
  await ensureSwapTable();
  return (await getSql()`
    SELECT *
    FROM swap_intents
    ORDER BY created_at DESC
    LIMIT 5000
  `) as SwapRow[];
}

async function getTransferRows() {
  await ensureTransferTable();
  return (await getSql()`
    SELECT *
    FROM copm_transfers
    ORDER BY created_at DESC
    LIMIT 5000
  `) as TransferRow[];
}

async function getIntegrationRows() {
  await ensureIntegrationSwapTable();
  return (await getSql()`
    SELECT *
    FROM integration_swap_intents
    ORDER BY created_at DESC
    LIMIT 5000
  `) as IntegrationSwapRow[];
}

function StatCard({
  label,
  tone,
  value,
  sub,
}: {
  label: string;
  tone: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className={`rounded-[8px] p-4 ${tone}`}>
      <p className="text-[11px] font-bold uppercase text-[#808880]">{label}</p>
      <p className="mt-3 text-2xl font-bold tracking-normal text-[#2B2D2F] sm:text-3xl">
        {value}
      </p>
      {sub && <p className="mt-2 text-xs text-[#808880]">{sub}</p>}
    </div>
  );
}

export default async function AnalyticsPage() {
  const rows = await getRows();
  const transfers = await getTransferRows();
  const integrationRows = await getIntegrationRows();
  const targetNetwork = getTargetNetwork();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const total = rows.length + integrationRows.length;
  const completed = rows.filter(isCompleted);
  const completedBuys = completed.filter((row) => (row.swap_type ?? "buy") === "buy");
  const completedSells = completed.filter((row) => row.swap_type === "sell");
  const completedTransfers = transfers.filter((row) =>
    ["confirmed", "logged"].includes(row.status)
  );
  const completedIntegrations = integrationRows.filter(
    (row) => row.status === "confirmed"
  );
  const logged = rows.filter((row) => row.status === "logged");
  const failed = [
    ...rows.filter((row) => row.status === "failed" || row.error),
    ...integrationRows.filter((row) => row.status === "failed" || row.error),
  ];
  const todayRows = completed.filter((row) => new Date(row.created_at) >= today);
  const todayIntegrations = completedIntegrations.filter(
    (row) => new Date(row.created_at) >= today
  );
  const weeklyUsers = [
    ...completed
      .filter((row) => new Date(row.created_at) >= sevenDaysAgo)
      .map((row) => row.user_address),
    ...completedIntegrations
      .filter((row) => new Date(row.created_at) >= sevenDaysAgo)
      .map((row) => row.user_address),
  ];
  const monthlyUsers = [
    ...completed
      .filter((row) => new Date(row.created_at) >= thirtyDaysAgo)
      .map((row) => row.user_address),
    ...completedIntegrations
      .filter((row) => new Date(row.created_at) >= thirtyDaysAgo)
      .map((row) => row.user_address),
  ];
  const wau = new Set(
    weeklyUsers
  ).size;
  const mau = new Set(
    monthlyUsers
  ).size;
  const users = new Set([
    ...completed.map((row) => row.user_address),
    ...completedIntegrations.map((row) => row.user_address),
  ]).size;
  const volumeUsd = getVolumeUsd(completed);
  const integrationVolumeUsd = completedIntegrations.reduce(
    (sum, row) => sum + atomicUsdt(row.input_amount),
    0
  );
  const todayIntegrationVolumeUsd = todayIntegrations.reduce(
    (sum, row) => sum + atomicUsdt(row.input_amount),
    0
  );
  const buyVolumeUsd = getVolumeUsd(completedBuys) + integrationVolumeUsd;
  const sellVolumeUsd = getVolumeUsd(completedSells);
  const feeUsd = completed.reduce((sum, row) => sum + metricNumber(row.fee_usd), 0);
  const copmReceived = completedBuys.reduce(
    (sum, row) => sum + metricNumber(row.copm_received),
    0
  ) +
    completedIntegrations.reduce(
      (sum, row) => sum + atomicCopm(row.actual_output_amount),
      0
    );
  const copmSold = completedSells.reduce(
    (sum, row) => sum + metricNumber(row.requested_copm),
    0
  );
  const usdtReceived = completedSells.reduce(
    (sum, row) => sum + metricNumber(row.output_amount),
    0
  );
  const multiToken = completed.filter((row) => getTokensSpent(row).length > 1).length;
  const txCount = completed.reduce(
    (sum, row) => sum + asArray(row.swap_tx_hashes).length,
    0
  ) + completedIntegrations.length;
  const transferVolume = completedTransfers.reduce(
    (sum, row) => sum + metricNumber(row.copm_amount),
    0
  );
  const tokenTable = Object.entries(
    completedIntegrations.reduce(
      (acc, row) => {
        acc.USDT ??= { count: 0, usd: 0 };
        acc.USDT.count += 1;
        acc.USDT.usd += atomicUsdt(row.input_amount);
        return acc;
      },
      completed.reduce<Record<string, { count: number; usd: number }>>((acc, row) => {
      getTokensSpent(row).forEach((token) => {
        if (!token.symbol) return;
        acc[token.symbol] ??= { count: 0, usd: 0 };
        acc[token.symbol].count += 1;
        acc[token.symbol].usd += metricNumber(token.amountUsd);
      });
      return acc;
      }, {})
    )
  ).sort(([, a], [, b]) => b.usd - a.usd);
  const tokenTotalUsd = tokenTable.reduce((sum, [, token]) => sum + token.usd, 0);

  const contracts = [
    ["Purchase log", process.env.PURCHASE_LOG_CONTRACT_ADDRESS],
    ["COPm", targetNetwork.tokens.copm.address],
    ["Squid router", "0xce16F69375520ab01377ce7B88f5BA8C48F8D666"],
    ["Logger", "0x1f4D4b2820670B8ce7cC4E709fa06fa783F029d2"],
  ];

  return (
    <main className="min-h-screen bg-[#FAFAF8] px-5 py-6 text-[#2B2D2F]">
      <div className="mx-auto max-w-6xl">
        <Link
          href="/"
          className="text-xs font-bold uppercase text-[#808880] hover:text-[#0E7C4F]"
        >
          ← Back
        </Link>
        <h1 className="mt-5 text-4xl font-black uppercase leading-none">Stats</h1>
        <p className="mt-3 font-mono text-sm text-[#808880]">
          Live · refresh to update
        </p>

        <section className="mt-10">
          <h2 className="text-2xl font-black uppercase">Today</h2>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <StatCard
              label="Swaps today"
              tone="bg-[#E1F1EA]"
              value={number(todayRows.length + todayIntegrations.length)}
            />
            <StatCard
              label="Volume today"
              tone="bg-[#EEF0FA]"
              value={money(
                getVolumeUsd(todayRows) + todayIntegrationVolumeUsd
              )}
            />
            <StatCard
              label="Fees today"
              tone="bg-[#FBE6E8]"
              value={money(
                todayRows.reduce((sum, row) => sum + metricNumber(row.fee_usd), 0)
              )}
            />
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-2xl font-black uppercase">Economy</h2>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <StatCard
              label="Volume"
              tone="bg-[#E1F1EA]"
              value={money(volumeUsd + integrationVolumeUsd)}
              sub={`${money(buyVolumeUsd)} buy · ${money(sellVolumeUsd)} sell`}
            />
            <StatCard
              label="Integrator fees"
              tone="bg-[#FFF8BE]"
              value={money(feeUsd)}
              sub="reported by Squid"
            />
            <StatCard
              label="COPm delivered"
              tone="bg-[#FFEAC8]"
              value={number(copmReceived, 2)}
              sub="confirmed buys"
            />
            <StatCard
              label="COPm sold"
              tone="bg-[#EEF0FA]"
              value={number(copmSold, 2)}
              sub={`${number(usdtReceived, 2)} USDT received`}
            />
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-2xl font-black uppercase">On-chain</h2>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <StatCard
              label="Completed swaps"
              tone="bg-[#E1F1EA]"
              value={number(completed.length + completedIntegrations.length)}
              sub={`${number(completedBuys.length + completedIntegrations.length)} buys · ${number(completedSells.length)} sells`}
            />
            <StatCard
              label="Swap txs"
              tone="bg-[#EEF0FA]"
              value={number(txCount)}
              sub={`${number(multiToken)} multi-token swaps`}
            />
            <StatCard
              label="On-chain logs"
              tone="bg-[#FFEAC8]"
              value={number(logged.length)}
              sub="confirmed swaps recorded"
            />
            <StatCard
              label="WAU"
              tone="bg-[#FFF8BE]"
              value={number(wau)}
              sub="last 7 days"
            />
            <StatCard
              label="MAU"
              tone="bg-[#F0E4F1]"
              value={number(mau)}
              sub="last 30 days"
            />
            <StatCard
              label="Failed rate"
              tone="bg-[#FBE6E8]"
              value={percent(total ? (failed.length / total) * 100 : 0)}
              sub={`${number(failed.length)} failed intents`}
            />
          </div>
        </section>

        <section className="mt-10">
          <h2 className="text-2xl font-black uppercase">Transfers</h2>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <StatCard
              label="Completed transfers"
              tone="bg-[#E1F1EA]"
              value={number(completedTransfers.length)}
            />
            <StatCard
              label="COPm transferred"
              tone="bg-[#EEF0FA]"
              value={number(transferVolume, 2)}
            />
            <StatCard
              label="Transfer users"
              tone="bg-[#FFEAC8]"
              value={number(
                new Set(completedTransfers.map((row) => row.sender_address)).size
              )}
            />
          </div>
        </section>

        <section className="mt-10 rounded-[8px] border border-[#E6E6E2] bg-white p-5">
          <h2 className="text-xl font-black uppercase">Transactions by token</h2>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-left">
              <thead className="border-b border-[#ECECE8] text-xs uppercase text-[#808880]">
                <tr>
                  <th className="py-3">Token</th>
                  <th className="py-3 text-right">Count</th>
                  <th className="py-3 text-right">Volume</th>
                  <th className="py-3 text-right">Share</th>
                </tr>
              </thead>
              <tbody>
                {tokenTable.map(([symbol, token]) => (
                  <tr key={symbol} className="border-b border-[#F0F0EC]">
                    <td className="py-4 text-base">{symbol}</td>
                    <td className="py-4 text-right">{number(token.count)}</td>
                    <td className="py-4 text-right">{money(token.usd)}</td>
                    <td className="py-4 text-right text-[#808880]">
                      {percent(tokenTotalUsd ? (token.usd / tokenTotalUsd) * 100 : 0)}
                    </td>
                  </tr>
                ))}
                {tokenTable.length === 0 && (
                  <tr>
                    <td className="py-6 text-[#808880]" colSpan={4}>
                      No swaps logged yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-6 rounded-[8px] border border-[#E6E6E2] bg-white p-5">
          <h2 className="text-xl font-black uppercase">Contracts</h2>
          <div className="mt-5 space-y-3">
            {contracts.map(([label, address]) => (
              <div
                key={label}
                className="flex items-center justify-between gap-4 text-sm"
              >
                <span className="font-bold uppercase text-[#808880]">{label}</span>
                <span className="font-mono text-[#0E7C4F]">
                  {shortAddress(address)}
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-6 rounded-[8px] border border-[#E6E6E2] bg-white p-5">
          <h2 className="text-xl font-black uppercase">Recent swaps</h2>
          <div className="mt-5 overflow-x-auto">
            <table className="w-full text-left">
              <thead className="border-b border-[#ECECE8] text-xs uppercase text-[#808880]">
                <tr>
                  <th className="py-3">User</th>
                  <th className="py-3">Type</th>
                  <th className="py-3">Status</th>
                  <th className="py-3 text-right">Requested</th>
                  <th className="py-3 text-right">Received</th>
                  <th className="py-3 text-right">Fee</th>
                </tr>
              </thead>
              <tbody>
                {completed.slice(0, 10).map((row) => (
                  <tr key={row.intent_id} className="border-b border-[#F0F0EC]">
                    <td className="py-4 font-mono text-sm">
                      {shortAddress(row.user_address)}
                    </td>
                    <td className="py-4">{row.swap_type === "sell" ? "sell" : "buy"}</td>
                    <td className="py-4">confirmed</td>
                    <td className="py-4 text-right">
                      {row.requested_copm} COPm
                    </td>
                    <td className="py-4 text-right">
                      {row.swap_type === "sell"
                        ? row.output_amount
                          ? `${number(metricNumber(row.output_amount), 2)} ${row.output_token ?? "USDT"}`
                          : "-"
                        : row.copm_received
                          ? `${number(metricNumber(row.copm_received), 2)} COPm`
                          : "-"}
                    </td>
                    <td className="py-4 text-right">
                      {row.fee_usd ? money(metricNumber(row.fee_usd)) : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
