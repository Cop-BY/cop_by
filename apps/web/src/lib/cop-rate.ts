export async function fetchLatestUsdCopRate() {
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
