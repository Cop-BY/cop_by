import { NextResponse } from "next/server";

import { fetchLatestUsdCopRate } from "@/lib/cop-rate";

export const revalidate = 60;

export async function GET() {
  const apiKey = process.env.COIN_GECKO_API_KEY;
  const [fxReference, coinGeckoData] = await Promise.all([
    fetchLatestUsdCopRate(),
    apiKey
      ? fetch(
          "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,usd-coin&vs_currencies=usd,cop&include_24hr_change=true",
          {
            headers: {
              "x-cg-demo-api-key": apiKey,
            },
            next: { revalidate },
          }
        )
          .then((response) => (response.ok ? response.json() : null))
          .catch(() => null)
      : Promise.resolve(null),
  ]);

  const data = coinGeckoData as {
    bitcoin?: { usd?: number };
    ethereum?: { usd?: number };
    "usd-coin"?: { cop_24h_change?: number };
  } | null;

  if (!fxReference && !data) {
    return NextResponse.json({ error: "Token prices unavailable" }, { status: 502 });
  }

  return NextResponse.json({
    COP_PER_USD: fxReference?.copPerUsd,
    COP_PER_USD_SOURCE: fxReference?.source,
    COP_PER_USD_24H_CHANGE: data?.["usd-coin"]?.cop_24h_change,
    ETH: data?.ethereum?.usd,
    WBTC: data?.bitcoin?.usd,
  });
}
