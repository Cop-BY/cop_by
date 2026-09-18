import { NextResponse } from "next/server";

import { brebErrorResponse, withBrebFirstParty } from "@/lib/breb/http";
import { getKycStatus, startKyc } from "@/lib/breb/kyc";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const auth = await withBrebFirstParty();
    const userAddress = new URL(request.url).searchParams.get("userAddress");
    if (!userAddress) {
      return NextResponse.json({ error: "Missing userAddress" }, { status: 400 });
    }
    const result = await getKycStatus(auth.ctx, userAddress);
    await auth.log({ path: "/api/breb/kyc", status: 200 });
    return NextResponse.json(result);
  } catch (error) {
    return brebErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await withBrebFirstParty();
    const body = (await request.json()) as {
      email?: string;
      fullName?: string;
      redirectUri?: string;
      userAddress?: string;
    };
    const result = await startKyc(auth.ctx, body);
    await auth.log({ path: "/api/breb/kyc", status: 200 });
    return NextResponse.json(result);
  } catch (error) {
    return brebErrorResponse(error);
  }
}
