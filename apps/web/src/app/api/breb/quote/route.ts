import { NextResponse } from "next/server";

import { brebErrorResponse, withBrebFirstParty } from "@/lib/breb/http";
import { getBrebQuote } from "@/lib/breb/quote";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const auth = await withBrebFirstParty();
    const url = new URL(request.url);
    const result = await getBrebQuote(auth.ctx, {
      destinationCop: url.searchParams.get("destinationCop"),
      fromToken: url.searchParams.get("fromToken"),
      hostname: url.hostname,
      integrationId: auth.integration.id,
      userAddress: url.searchParams.get("userAddress") ?? undefined,
    });
    await auth.log({ path: "/api/breb/quote", status: 200 });
    return NextResponse.json(result);
  } catch (error) {
    return brebErrorResponse(error);
  }
}
