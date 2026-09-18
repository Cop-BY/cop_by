import { NextResponse } from "next/server";

import { brebErrorResponse, withBrebFirstParty } from "@/lib/breb/http";
import { verifyKycOtp } from "@/lib/breb/kyc";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const auth = await withBrebFirstParty();
    const body = (await request.json()) as {
      code?: string;
      email?: string;
      fullName?: string;
      redirectUri?: string;
      userAddress?: string;
    };
    const result = await verifyKycOtp(auth.ctx, body);
    await auth.log({ path: "/api/breb/kyc/otp/verify", status: 200 });
    return NextResponse.json(result);
  } catch (error) {
    return brebErrorResponse(error);
  }
}
