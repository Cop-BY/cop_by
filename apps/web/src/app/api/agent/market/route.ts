import { NextRequest, NextResponse } from "next/server";
import { formatUnits, isAddress, parseUnits, type Address } from "viem";

import { fetchLatestUsdCopRate } from "@/lib/cop-rate";
import { getTargetNetwork } from "@/lib/network-config";
import { getSquidRoute, SquidApiError } from "@/lib/squid-config";

const DEFAULT_THRESHOLD_BPS = 100;

function getThresholdBps(value: string | null) {
  const fromQuery = Number(value);
  if (Number.isFinite(fromQuery) && fromQuery > 0) return fromQuery;

  const configured = Number(process.env.FX_AGENT_EDGE_THRESHOLD_BPS);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_THRESHOLD_BPS;
}

function edgeBps(actual: number, reference: number) {
  return ((actual - reference) / reference) * 10_000;
}

async function getQuote(params: Parameters<typeof getSquidRoute>[0]) {
  try {
    const result = await getSquidRoute(params);
    const toAmount = BigInt(result.route?.estimate?.toAmount ?? "0");
    if (toAmount <= 0n) return null;
    return { result, toAmount };
  } catch (error) {
    if (error instanceof SquidApiError) return null;
    throw error;
  }
}

export async function GET(request: NextRequest) {
  const userAddress = request.nextUrl.searchParams.get("userAddress");
  if (!userAddress || !isAddress(userAddress)) {
    return NextResponse.json({ error: "Invalid user address" }, { status: 400 });
  }

  const targetNetwork = getTargetNetwork();
  const copm = targetNetwork.tokens.copm.address;
  const usdt = targetNetwork.tokens.usdt.address;
  if (!copm || !usdt) {
    return NextResponse.json({ error: "Missing COPm/USDT config" }, { status: 500 });
  }

  const reference = await fetchLatestUsdCopRate();
  if (!reference) {
    return NextResponse.json({ error: "USD/COP reference unavailable" }, { status: 502 });
  }

  const thresholdBps = getThresholdBps(
    request.nextUrl.searchParams.get("thresholdBps")
  );
  const buyInputUsdt = parseUnits("1", targetNetwork.tokens.usdt.decimals);
  const sellInputCopm = parseUnits(
    Math.round(reference.copPerUsd).toString(),
    targetNetwork.tokens.copm.decimals
  );

  const [buyQuote, sellQuote] = await Promise.all([
    getQuote({
      fromAddress: userAddress as Address,
      fromAmount: buyInputUsdt.toString(),
      fromChain: targetNetwork.squidChainId,
      fromToken: usdt,
      slippage: 0.3,
      toAddress: userAddress as Address,
      toChain: targetNetwork.squidChainId,
      toToken: copm,
    }),
    getQuote({
      fromAddress: userAddress as Address,
      fromAmount: sellInputCopm.toString(),
      fromChain: targetNetwork.squidChainId,
      fromToken: copm,
      slippage: 0.3,
      toAddress: userAddress as Address,
      toChain: targetNetwork.squidChainId,
      toToken: usdt,
    }),
  ]);

  const buyCopmPerUsdt = buyQuote
    ? Number(formatUnits(buyQuote.toAmount, targetNetwork.tokens.copm.decimals))
    : null;
  const sellUsdtPerUsdReferenceCopm = sellQuote
    ? Number(formatUnits(sellQuote.toAmount, targetNetwork.tokens.usdt.decimals))
    : null;

  const buyEdgeBps =
    buyCopmPerUsdt === null ? null : edgeBps(buyCopmPerUsdt, reference.copPerUsd);
  const sellEdgeBps =
    sellUsdtPerUsdReferenceCopm === null
      ? null
      : edgeBps(sellUsdtPerUsdReferenceCopm, 1);

  let recommendation: "buy" | "sell" | "hold" = "hold";
  if (buyEdgeBps !== null && buyEdgeBps >= thresholdBps) {
    recommendation = "buy";
  }
  if (
    sellEdgeBps !== null &&
    sellEdgeBps >= thresholdBps &&
    (buyEdgeBps === null || sellEdgeBps > buyEdgeBps)
  ) {
    recommendation = "sell";
  }

  return NextResponse.json({
    reference: {
      copPerUsd: reference.copPerUsd,
      date: reference.date,
      source: reference.source,
    },
    quotes: {
      buy: buyQuote
        ? {
            inputUsdt: buyInputUsdt.toString(),
            outputCopm: buyQuote.toAmount.toString(),
            copmPerUsdt: buyCopmPerUsdt,
            requestId: buyQuote.result.requestId,
            quoteId: buyQuote.result.route?.quoteId,
          }
        : null,
      sell: sellQuote
        ? {
            inputCopm: sellInputCopm.toString(),
            outputUsdt: sellQuote.toAmount.toString(),
            usdtForReferenceCopm: sellUsdtPerUsdReferenceCopm,
            requestId: sellQuote.result.requestId,
            quoteId: sellQuote.result.route?.quoteId,
          }
        : null,
    },
    signals: {
      buyEdgeBps,
      recommendation,
      sellEdgeBps,
      thresholdBps,
    },
  });
}
