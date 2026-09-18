import { NextResponse } from "next/server";

import { confirmBrebPayout } from "@/lib/breb/confirm";
import { brebErrorResponse, withBrebFirstParty } from "@/lib/breb/http";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: { payoutId: string } }
) {
  try {
    const auth = await withBrebFirstParty();
    const body = (await request.json()) as { txHash?: string; userAddress?: string };
    if (!body.userAddress) {
      return NextResponse.json({ error: "Missing userAddress" }, { status: 400 });
    }
    const result = await confirmBrebPayout(auth.ctx.store, {
      integrationId: auth.integration.id,
      payoutId: params.payoutId,
      txHash: body.txHash,
      userAddress: body.userAddress,
    });
    await auth.log({ path: "/api/breb/payouts/:id/confirm", status: 200 });
    return NextResponse.json(result);
  } catch (error) {
    return brebErrorResponse(error);
  }
}
