type UsdCopReference = {
  copPerUsd: number;
  date?: string;
  source: string;
};

async function fetchCoinGeckoUsdCopRate(): Promise<UsdCopReference | null> {
  const apiKey = process.env.COIN_GECKO_API_KEY;
  if (!apiKey) return null;

  const response = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=usd-coin&vs_currencies=cop&include_last_updated_at=true",
    {
      headers: {
        "x-cg-demo-api-key": apiKey,
      },
      next: { revalidate: 60 },
    }
  );

  if (!response.ok) return null;

  const data = (await response.json()) as {
    "usd-coin"?: {
      cop?: number;
      last_updated_at?: number;
    };
  };
  const copPerUsd = data["usd-coin"]?.cop;
  if (!copPerUsd || !Number.isFinite(copPerUsd)) return null;

  const updatedAt = data["usd-coin"]?.last_updated_at;
  return {
    copPerUsd,
    date: updatedAt
      ? new Date(updatedAt * 1000).toISOString()
      : new Date().toISOString(),
    source: "coingecko-usdc",
  };
}

async function fetchCurrencyApiUsdCopRate(): Promise<UsdCopReference | null> {
  const response = await fetch(
    "https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/usd.json",
    { next: { revalidate: 60 * 60 } }
  );

  if (!response.ok) return null;

  const data = (await response.json()) as {
    date?: string;
    usd?: {
      cop?: number;
    };
  };
  const copPerUsd = data.usd?.cop;
  if (!copPerUsd || !Number.isFinite(copPerUsd)) return null;

  return {
    copPerUsd,
    date: data.date,
    source: "currency-api",
  };
}

export async function fetchLatestUsdCopRate() {
  const [currencyApiReference, coinGeckoReference] = await Promise.all([
    fetchCurrencyApiUsdCopRate(),
    fetchCoinGeckoUsdCopRate(),
  ]);
  const references = [currencyApiReference, coinGeckoReference].filter(
    (reference): reference is UsdCopReference => reference !== null
  );
  const primaryReference = currencyApiReference ?? coinGeckoReference;

  if (!primaryReference) return null;

  return {
    copPerUsd: primaryReference.copPerUsd,
    date: references
      .map((reference) => reference.date)
      .filter(Boolean)
      .join(" / "),
    references,
    source: primaryReference.source,
  };
}
