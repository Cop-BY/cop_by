import { NextResponse } from "next/server";

import { brebErrorResponse, withBrebFirstParty } from "@/lib/breb/http";
import { sendKycOtp } from "@/lib/breb/kyc";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const auth = await withBrebFirstParty();
    const body = (await request.json()) as { email?: string; userAddress?: string };
    const result = await sendKycOtp(auth.ctx, body);
    await auth.log({ path: "/api/breb/kyc/otp/send", status: 200 });
    return NextResponse.json(result);
  } catch (error) {
    return brebErrorResponse(error);
  }
}
