import { NextResponse } from "next/server";

import { getKycStatus, startKyc } from "@/lib/breb/kyc";
import { brebErrorResponse, withBrebAuth } from "@/lib/breb/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const auth = await withBrebAuth(request);
    if ("response" in auth) return auth.response;

    const userAddress = new URL(request.url).searchParams.get("userAddress");
    if (!userAddress) {
      return NextResponse.json({ error: "Missing userAddress" }, { status: 400 });
    }
    const result = await getKycStatus(auth.ctx, userAddress);
    await auth.log({ path: "/api/integrations/breb/kyc", status: 200 });
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
      email?: string;
      fullName?: string;
      redirectUri?: string;
      userAddress?: string;
    };
    const result = await startKyc(auth.ctx, body);
    await auth.log({ path: "/api/integrations/breb/kyc", status: 200 });
    return NextResponse.json(result);
  } catch (error) {
    return brebErrorResponse(error);
  }
}
