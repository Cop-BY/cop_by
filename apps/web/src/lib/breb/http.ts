import { NextResponse } from "next/server";

import { requireIntegrationApiKey } from "../integration-api-keys";

import { getBrebContext } from "./context";
import { isBrebError } from "./errors";
import { createId } from "./ids";

export function brebErrorResponse(error: unknown) {
  if (isBrebError(error)) {
    return NextResponse.json(
      {
        error: error.message,
        errorCode: error.code,
        ...(error.body ?? {}),
      },
      { status: error.status }
    );
  }

  return NextResponse.json(
    {
      error: error instanceof Error ? error.message : "BRE-B request failed",
      errorCode: "internal_error",
    },
    { status: 500 }
  );
}

export async function withBrebAuth(request: Request) {
  const started = Date.now();
  const auth = await requireIntegrationApiKey(request);
  if ("response" in auth) return auth;

  const ctx = getBrebContext();
  await ctx.store.ensureReady();
  return {
    ctx,
    integration: auth.integration,
    log: async (input: { errorCode?: string; path: string; status: number }) => {
      try {
        await ctx.store.logRequest({
          errorCode: input.errorCode,
          id: createId("log"),
          integrationId: auth.integration.id,
          latencyMs: Date.now() - started,
          method: request.method,
          path: input.path,
          status: input.status,
        });
      } catch {
        // Logging must not fail the request.
      }
    },
  };
}
