import { NextResponse } from "next/server";

import { ensureAgentSessionTable, getSql } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: { sessionId: string } }
) {
  try {
    if (!/^0x[0-9a-fA-F]{64}$/.test(params.sessionId)) {
      return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
    }

    await ensureAgentSessionTable();
    const [session] = await getSql()`
      SELECT *
      FROM agent_sessions
      WHERE session_id = ${params.sessionId}
      LIMIT 1
    `;

    if (!session) {
      return NextResponse.json({ error: "Agent session not found" }, { status: 404 });
    }

    return NextResponse.json({ session });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not load agent session",
      },
      { status: 500 }
    );
  }
}
