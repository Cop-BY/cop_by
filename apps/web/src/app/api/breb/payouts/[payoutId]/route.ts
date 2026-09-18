import { NextResponse } from "next/server";

import { brebErrorResponse, withBrebFirstParty } from "@/lib/breb/http";
import { getBrebPayout } from "@/lib/breb/payout";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: { payoutId: string } }
) {
  try {
    const auth = await withBrebFirstParty();
    const userAddress = new URL(request.url).searchParams.get("userAddress");
    if (!userAddress) {
      return NextResponse.json({ error: "Missing userAddress" }, { status: 400 });
    }
    const result = await getBrebPayout(auth.ctx.store, {
      integrationId: auth.integration.id,
      payoutId: params.payoutId,
      userAddress,
    });
    await auth.log({ path: "/api/breb/payouts/:id", status: 200 });
    return NextResponse.json(result);
  } catch (error) {
    return brebErrorResponse(error);
  }
}
