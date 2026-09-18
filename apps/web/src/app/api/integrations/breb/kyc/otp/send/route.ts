import { NextResponse } from "next/server";

import { brebErrorResponse, withBrebAuth } from "@/lib/breb/http";
import { sendKycOtp } from "@/lib/breb/kyc";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const auth = await withBrebAuth(request);
    if ("response" in auth) return auth.response;

    const body = (await request.json()) as { email?: string; userAddress?: string };
    const result = await sendKycOtp(auth.ctx, body);
    await auth.log({ path: "/api/integrations/breb/kyc/otp/send", status: 200 });
    return NextResponse.json(result);
  } catch (error) {
    return brebErrorResponse(error);
  }
}
