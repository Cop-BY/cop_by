import { NextResponse } from "next/server";

import { confirmBrebPayout } from "@/lib/breb/confirm";
import { brebErrorResponse, withBrebAuth } from "@/lib/breb/http";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: { payoutId: string } }
) {
  try {
    const auth = await withBrebAuth(request);
    if ("response" in auth) return auth.response;

    const body = (await request.json()) as { txHash?: string };
    const result = await confirmBrebPayout(auth.ctx.store, {
      integrationId: auth.integration.id,
      payoutId: params.payoutId,
      txHash: body.txHash,
    });
    await auth.log({
      path: "/api/integrations/breb/payouts/:id/confirm",
      status: 200,
    });
    return NextResponse.json(result);
  } catch (error) {
    return brebErrorResponse(error);
  }
}
