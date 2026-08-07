import { NextResponse } from "next/server";

import { ensureIntegrationSwapTable, getSql } from "@/lib/db";
import { requireIntegrationApiKey } from "@/lib/integration-api-keys";

export const dynamic = "force-dynamic";

type IntegrationSwapRow = {
  actual_output_amount: string | null;
  chain_id: number;
  created_at: string;
  input_amount: string;
  input_token: string;
  intent_id: string;
  min_output_amount: string | null;
  output_token: string;
  quoted_output_amount: string | null;
  squid_quote_id: string | null;
  squid_request_id: string | null;
  status: string;
  swap_tx_hash: string | null;
  updated_at: string;
  user_address: string;
};

function parseSince(value: string | null) {
  if (!value) return { date: new Date(0), value: 0 };
  if (!/^\d+$/.test(value)) return null;

  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds < 0) return null;

  return { date: new Date(seconds * 1000), value: seconds };
}

function parseLimit(value: string | null) {
  if (!value) return 100;
  if (!/^\d+$/.test(value)) return null;

  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1) return null;

  return Math.min(limit, 500);
}

function toUnixSeconds(value: string | Date) {
  return Math.floor(new Date(value).getTime() / 1000);
}

function mapSwap(row: IntegrationSwapRow) {
  return {
    actualOutputAmount: row.actual_output_amount,
    chainId: row.chain_id,
    createdAt: row.created_at,
    inputAmount: row.input_amount,
    inputToken: row.input_token,
    intentId: row.intent_id,
    minOutputAmount: row.min_output_amount,
    outputToken: row.output_token,
    quotedOutputAmount: row.quoted_output_amount,
    squidQuoteId: row.squid_quote_id,
    squidRequestId: row.squid_request_id,
    status: row.status,
    swapTxHash: row.swap_tx_hash,
    updatedAt: row.updated_at,
    userAddress: row.user_address,
  };
}

export async function GET(request: Request) {
  const auth = await requireIntegrationApiKey(request);
  if ("response" in auth) return auth.response;

  const url = new URL(request.url);
  const integrationId = url.searchParams.get("integration_id");
  if (!integrationId) {
    return NextResponse.json({ error: "Missing integration_id" }, { status: 400 });
  }
  if (integrationId !== auth.integration.id) {
    return NextResponse.json({ error: "Integration not allowed" }, { status: 403 });
  }

  const since = parseSince(url.searchParams.get("since"));
  if (!since || Number.isNaN(since.date.getTime())) {
    return NextResponse.json({ error: "Invalid since. Use unix seconds." }, { status: 400 });
  }

  const limit = parseLimit(url.searchParams.get("limit"));
  if (!limit) {
    return NextResponse.json({ error: "Invalid limit" }, { status: 400 });
  }

  await ensureIntegrationSwapTable();
  const rows = (await getSql()`
    SELECT
      intent_id,
      user_address,
      chain_id,
      status,
      input_token,
      output_token,
      input_amount,
      quoted_output_amount,
      actual_output_amount,
      min_output_amount,
      squid_request_id,
      squid_quote_id,
      swap_tx_hash,
      created_at,
      updated_at
    FROM integration_swap_intents
    WHERE integration_id = ${integrationId}
      AND status = 'confirmed'
      AND updated_at >= ${since.date.toISOString()}
    ORDER BY updated_at ASC
    LIMIT ${limit}
  `) as IntegrationSwapRow[];

  const lastUpdatedAt = rows.at(-1)?.updated_at;

  return NextResponse.json({
    integrationId,
    inclusive: true,
    items: rows.map(mapSwap),
    limit,
    nextSince: lastUpdatedAt ? toUnixSeconds(lastUpdatedAt) : since.value,
    since: since.value,
  });
}
