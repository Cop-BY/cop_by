import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";

import { ensureIntegrationApiKeyTable, getSql } from "@/lib/db";

export type IntegrationApiKey = {
  id: string;
  name: string;
};

type IntegrationApiKeyRow = {
  allowed_origins: unknown;
  id: string;
  key_hash: string;
  name: string;
  public_key_id: string | null;
  status: string;
};

type ParsedApiKey = {
  publicKeyId?: string;
  raw: string;
  secret: string;
};

function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const [scheme, token] = authorization.split(" ");
  if (scheme?.toLowerCase() === "bearer" && token) return token.trim();

  return request.headers.get("x-copby-api-key")?.trim() ?? "";
}

export function hashIntegrationApiKey(apiKey: string) {
  const pepper = process.env.COPBY_API_KEY_PEPPER;
  if (!pepper) throw new Error("Missing COPBY_API_KEY_PEPPER");

  return createHmac("sha256", pepper).update(apiKey).digest("hex");
}

function getInvalidApiKeyResponse() {
  return NextResponse.json({ error: "Invalid integration API key" }, { status: 401 });
}

function tryHashIntegrationApiKey(apiKey: string) {
  try {
    return hashIntegrationApiKey(apiKey);
  } catch {
    return null;
  }
}

function parseApiKey(apiKey: string): ParsedApiKey {
  const match = apiKey.match(/^copby_live_pk_([A-Za-z0-9_-]{6,32})\.([A-Za-z0-9_-]{24,})$/);
  if (!match) return { raw: apiKey, secret: apiKey };

  return {
    publicKeyId: match[1],
    raw: apiKey,
    secret: match[2],
  };
}

function hashesMatch(actual: string, expected: string) {
  if (!/^[0-9a-f]{64}$/i.test(actual) || !/^[0-9a-f]{64}$/i.test(expected)) {
    return false;
  }

  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

function isOriginAllowed(row: IntegrationApiKeyRow, request: Request) {
  const origins = Array.isArray(row.allowed_origins)
    ? row.allowed_origins.filter((origin): origin is string => typeof origin === "string")
    : [];
  if (!origins.length) return true;

  const origin = request.headers.get("origin");
  return Boolean(origin && origins.includes(origin));
}

export async function requireIntegrationApiKey(request: Request): Promise<
  | { integration: IntegrationApiKey }
  | { response: NextResponse<{ error: string }> }
> {
  const apiKey = getBearerToken(request);
  if (!apiKey) {
    return {
      response: NextResponse.json({ error: "Missing integration API key" }, { status: 401 }),
    };
  }

  await ensureIntegrationApiKeyTable();
  const parsed = parseApiKey(apiKey);
  const keyHash = tryHashIntegrationApiKey(parsed.secret);
  if (!keyHash) {
    return { response: getInvalidApiKeyResponse() };
  }
  const [row] = parsed.publicKeyId
    ? ((await getSql()`
        SELECT id, name, public_key_id, key_hash, status, allowed_origins
        FROM integration_api_keys
        WHERE public_key_id = ${parsed.publicKeyId}
        LIMIT 1
      `) as IntegrationApiKeyRow[])
    : ((await getSql()`
        SELECT id, name, public_key_id, key_hash, status, allowed_origins
        FROM integration_api_keys
        WHERE key_hash = ${keyHash}
        LIMIT 1
      `) as IntegrationApiKeyRow[]);

  if (!row || row.status !== "active" || !hashesMatch(keyHash, row.key_hash)) {
    return { response: getInvalidApiKeyResponse() };
  }

  if (!isOriginAllowed(row, request)) {
    return {
      response: NextResponse.json({ error: "Origin not allowed" }, { status: 403 }),
    };
  }

  return { integration: { id: row.id, name: row.name } };
}
