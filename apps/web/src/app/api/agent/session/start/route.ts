import { NextResponse } from "next/server";
import { isAddress, keccak256, toBytes, type Address } from "viem";

import {
  AGENT_SESSION_ALLOWED_PAIR_COPM_USDT,
  AGENT_SESSION_MAX_COPM_TRADE,
  AGENT_SESSION_MAX_COPM_VOLUME,
  AGENT_SESSION_MAX_TRADE_USD,
  AGENT_SESSION_MAX_USDT_TRADE,
  AGENT_SESSION_MAX_USDT_VOLUME,
  agentTradingSessionTypes,
  buildAgentTradingSessionDomain,
  buildAgentTradingSessionMessage,
  getAgentSessionExpiresAt,
} from "@/lib/agent-session";
import { ensureAgentSessionTable, getSql } from "@/lib/db";
import { getTargetNetwork } from "@/lib/network-config";

type StartAgentSessionBody = {
  agentAddress?: string;
  durationHours?: number;
  userAddress?: string;
};

function getAgentRegistryAddress() {
  const address = process.env.AGENT_REGISTRY_ADDRESS;
  if (!address || !isAddress(address)) {
    throw new Error("Missing AGENT_REGISTRY_ADDRESS");
  }
  return address as Address;
}

function createSessionId() {
  return keccak256(toBytes(crypto.randomUUID()));
}

export async function POST(request: Request) {
  try {
    const targetNetwork = getTargetNetwork();
    if (targetNetwork.key !== "celo") {
      return NextResponse.json(
        { error: "Agent sessions are only enabled on Celo mainnet" },
        { status: 400 }
      );
    }

    const body = (await request.json()) as StartAgentSessionBody;
    if (!body.userAddress || !isAddress(body.userAddress)) {
      return NextResponse.json({ error: "Invalid user address" }, { status: 400 });
    }
    if (!body.agentAddress || !isAddress(body.agentAddress)) {
      return NextResponse.json({ error: "Invalid agent address" }, { status: 400 });
    }

    const durationHours = body.durationHours ?? 24;
    if (durationHours !== 24) {
      return NextResponse.json(
        { error: "Agent sessions must be 24 hours" },
        { status: 400 }
      );
    }

    const registryAddress = getAgentRegistryAddress();
    const sessionId = createSessionId();
    const expiresAt = getAgentSessionExpiresAt();
    const expiresAtIso = new Date(Number(expiresAt) * 1000).toISOString();
    const userAddress = body.userAddress.toLowerCase();
    const agentAddress = body.agentAddress.toLowerCase();

    await ensureAgentSessionTable();
    const [activeSession] = await getSql()`
      SELECT session_id
      FROM agent_sessions
      WHERE LOWER(user_address) = ${userAddress}
        AND status IN ('pending', 'active')
        AND expires_at > NOW()
      LIMIT 1
    `;

    if (activeSession) {
      return NextResponse.json(
        { error: "User already has an active agent session" },
        { status: 409 }
      );
    }

    const domain = buildAgentTradingSessionDomain({
      chainId: targetNetwork.chainId,
      verifyingContract: registryAddress,
    });
    const message = buildAgentTradingSessionMessage({
      agentAddress: body.agentAddress as Address,
      chainId: targetNetwork.chainId,
      expiresAt,
      sessionId,
      userAddress: body.userAddress as Address,
    });

    const [session] = await getSql()`
      INSERT INTO agent_sessions (
        session_id,
        user_address,
        agent_address,
        chain_id,
        status,
        allowed_pair,
        max_trade_usd,
        max_copm_trade,
        max_usdt_trade,
        max_copm_volume,
        max_usdt_volume,
        expires_at
      )
      VALUES (
        ${sessionId},
        ${userAddress},
        ${agentAddress},
        ${targetNetwork.chainId},
        'pending',
        ${AGENT_SESSION_ALLOWED_PAIR_COPM_USDT},
        ${AGENT_SESSION_MAX_TRADE_USD.toString()},
        ${AGENT_SESSION_MAX_COPM_TRADE.toString()},
        ${AGENT_SESSION_MAX_USDT_TRADE.toString()},
        ${AGENT_SESSION_MAX_COPM_VOLUME.toString()},
        ${AGENT_SESSION_MAX_USDT_VOLUME.toString()},
        ${expiresAtIso}
      )
      RETURNING *
    `;

    return NextResponse.json({
      domain,
      message: {
        ...message,
        chainId: message.chainId.toString(),
        expiresAt: message.expiresAt.toString(),
        maxTradeUsd: message.maxTradeUsd.toString(),
      },
      primaryType: "AgentTradingSession",
      session,
      types: agentTradingSessionTypes,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not start agent session",
      },
      { status: 500 }
    );
  }
}
