import { NextResponse } from "next/server";

import { ensureAgentSessionTable, getSql } from "@/lib/db";

type RevokeAgentSessionBody = {
  error?: string;
  onchainSessionTxHash?: string;
};

export async function POST(
  request: Request,
  { params }: { params: { sessionId: string } }
) {
  try {
    if (!/^0x[0-9a-fA-F]{64}$/.test(params.sessionId)) {
      return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as RevokeAgentSessionBody;
    await ensureAgentSessionTable();
    const [session] = await getSql()`
      UPDATE agent_sessions SET
        status = 'revoked',
        onchain_session_tx_hash = COALESCE(${body.onchainSessionTxHash ?? null}, onchain_session_tx_hash),
        error = COALESCE(${body.error ?? null}, error),
        updated_at = NOW()
      WHERE session_id = ${params.sessionId}
      RETURNING *
    `;

    if (!session) {
      return NextResponse.json({ error: "Agent session not found" }, { status: 404 });
    }

    return NextResponse.json({ session });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not revoke agent session",
      },
      { status: 500 }
    );
  }
}
