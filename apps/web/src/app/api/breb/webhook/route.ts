import { NextResponse } from "next/server";

import { getBrebContext } from "@/lib/breb/context";
import { brebErrorResponse } from "@/lib/breb/http";
import { handleBridgeWebhook } from "@/lib/breb/webhook";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const ctx = getBrebContext();
    await ctx.store.ensureReady();
    const rawBody = await request.text();
    const result = await handleBridgeWebhook(ctx.store, rawBody, request);
    return NextResponse.json(result);
  } catch (error) {
    return brebErrorResponse(error);
  }
}
