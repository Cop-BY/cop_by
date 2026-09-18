import { NextResponse } from "next/server";

import { brebErrorResponse, withBrebAuth } from "@/lib/breb/http";
import { getBrebPayout } from "@/lib/breb/payout";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: { payoutId: string } }
) {
  try {
    const auth = await withBrebAuth(request);
    if ("response" in auth) return auth.response;

    const result = await getBrebPayout(auth.ctx.store, {
      integrationId: auth.integration.id,
      payoutId: params.payoutId,
    });
    await auth.log({ path: "/api/integrations/breb/payouts/:id", status: 200 });
    return NextResponse.json(result);
  } catch (error) {
    return brebErrorResponse(error);
  }
}
