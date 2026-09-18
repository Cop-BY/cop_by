import { NextResponse } from "next/server";

import { brebErrorResponse, withBrebAuth } from "@/lib/breb/http";
import { createBrebPayout, listBrebPayouts } from "@/lib/breb/payout";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const auth = await withBrebAuth(request);
    if ("response" in auth) return auth.response;

    const url = new URL(request.url);
    const result = await listBrebPayouts(auth.ctx.store, {
      integrationId: auth.integration.id,
      limit: url.searchParams.get("limit")
        ? Number(url.searchParams.get("limit"))
        : undefined,
      since: url.searchParams.get("since") ?? undefined,
    });
    await auth.log({ path: "/api/integrations/breb/payouts", status: 200 });
    return NextResponse.json(result);
  } catch (error) {
    return brebErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await withBrebAuth(request);
    if ("response" in auth) return auth.response;

    const body = (await request.json()) as {
      accountOwnerName?: string;
      breBKey?: string;
      destinationCop?: string;
      fromToken?: string;
      quoteId?: string;
      userAddress?: string;
    };
    const result = await createBrebPayout(auth.ctx, {
      ...body,
      hostname: new URL(request.url).hostname,
      idempotencyKey: request.headers.get("idempotency-key"),
      integrationId: auth.integration.id,
    });
    await auth.log({ path: "/api/integrations/breb/payouts", status: 200 });
    return NextResponse.json(result);
  } catch (error) {
    return brebErrorResponse(error);
  }
}
