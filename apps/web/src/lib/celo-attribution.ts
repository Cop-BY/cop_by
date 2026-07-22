import { codeFromHostname, toDataSuffix } from "@celo/attribution-tags";
import { concat, type Hex } from "viem";

let cachedSuffixByCode = new Map<string, Hex>();

function getAttributionCodes(hostname?: string) {
  const configured = (
    process.env.CELO_ATTRIBUTION_CODE ??
    process.env.NEXT_PUBLIC_CELO_ATTRIBUTION_CODE
  )
    ?.split(",")
    .map((code) => code.trim())
    .filter(Boolean);

  if (configured?.length) return configured;
  if (hostname) return [codeFromHostname(hostname)];
  if (typeof window === "undefined") return [];

  return [codeFromHostname(window.location.hostname)];
}

export function getAttributionSuffix(hostname?: string) {
  const codes = getAttributionCodes(hostname);
  if (!codes.length) return undefined;

  const cacheKey = codes.join(",");
  const cachedSuffix = cachedSuffixByCode.get(cacheKey);
  if (cachedSuffix) return cachedSuffix;

  const suffix = toDataSuffix(codes) as Hex;
  cachedSuffixByCode.set(cacheKey, suffix);
  return suffix;
}

export function appendAttributionSuffix(data: Hex, hostname?: string) {
  const suffix = getAttributionSuffix(hostname);
  return suffix ? concat([data, suffix]) : data;
}
