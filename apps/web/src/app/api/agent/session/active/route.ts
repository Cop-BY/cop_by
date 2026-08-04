import { NextResponse } from "next/server";
import { isAddress } from "viem";

import { ensureAgentSessionTable, getSql } from "@/lib/db";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userAddress = searchParams.get("userAddress");
    const agentAddress = searchParams.get("agentAddress");

    if (!userAddress || !isAddress(userAddress)) {
      return NextResponse.json({ error: "Invalid user address" }, { status: 400 });
    }
    if (!agentAddress || !isAddress(agentAddress)) {
      return NextResponse.json({ error: "Invalid agent address" }, { status: 400 });
    }

    await ensureAgentSessionTable();
    const [session] = await getSql()`
      SELECT *
      FROM agent_sessions
      WHERE LOWER(user_address) = ${userAddress.toLowerCase()}
        AND LOWER(agent_address) = ${agentAddress.toLowerCase()}
        AND status IN ('pending', 'active')
        AND expires_at > NOW()
      ORDER BY updated_at DESC
      LIMIT 1
    `;

    return NextResponse.json({ session: session ?? null });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not load active session",
      },
      { status: 500 }
    );
  }
}
