import { NextResponse } from "next/server";
import {
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  AGENT_SESSION_MAX_COPM_TRADE,
  AGENT_SESSION_MAX_COPM_VOLUME,
  AGENT_SESSION_MAX_USDT_TRADE,
  AGENT_SESSION_MAX_USDT_VOLUME,
  buildAgentTradingSessionDomain,
  buildAgentTradingSessionMessage,
  verifyAgentTradingSessionSignature,
} from "@/lib/agent-session";
import { ensureAgentSessionTable, getSql } from "@/lib/db";
import { getTargetNetwork } from "@/lib/network-config";

type ConfirmAgentSessionBody = {
  onchainSessionTxHash?: string;
  sessionId?: string;
  signature?: Hex;
};

function getAgentRegistryAddress() {
  const address = process.env.AGENT_REGISTRY_ADDRESS;
  if (!address || !isAddress(address)) {
    throw new Error("Missing AGENT_REGISTRY_ADDRESS");
  }
  return address as Address;
}

function getRelayerPrivateKey() {
  const privateKey =
    process.env.AGENT_RELAYER_PRIVATE_KEY ?? process.env.BACKEND_LOGGER_PRIVATE_KEY;
  if (!privateKey) throw new Error("Missing AGENT_RELAYER_PRIVATE_KEY");
  return privateKey.startsWith("0x")
    ? (privateKey as Hex)
    : (`0x${privateKey}` as Hex);
}

function toUnixSeconds(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value));
  return BigInt(Math.floor(date.getTime() / 1000));
}

const agentRegistryAbi = [
  {
    inputs: [
      { name: "user", type: "address" },
      { name: "agent", type: "address" },
      { name: "sessionId", type: "bytes32" },
      { name: "expiresAt", type: "uint64" },
      { name: "maxCopmTrade", type: "uint256" },
      { name: "maxUsdtTrade", type: "uint256" },
      { name: "maxCopmVolume", type: "uint256" },
      { name: "maxUsdtVolume", type: "uint256" },
    ],
    name: "startSession",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ConfirmAgentSessionBody;
    if (!body.sessionId || !/^0x[0-9a-fA-F]{64}$/.test(body.sessionId)) {
      return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
    }
    if (!body.signature || !/^0x[0-9a-fA-F]+$/.test(body.signature)) {
      return NextResponse.json({ error: "Invalid session signature" }, { status: 400 });
    }

    await ensureAgentSessionTable();
    const [session] = await getSql()`
      SELECT *
      FROM agent_sessions
      WHERE session_id = ${body.sessionId}
      LIMIT 1
    `;

    if (!session) {
      return NextResponse.json({ error: "Agent session not found" }, { status: 404 });
    }
    if (session.status !== "pending") {
      return NextResponse.json(
        { error: "Agent session is not pending" },
        { status: 409 }
      );
    }

    const domain = buildAgentTradingSessionDomain({
      chainId: Number(session.chain_id),
      verifyingContract: getAgentRegistryAddress(),
    });
    const message = buildAgentTradingSessionMessage({
      agentAddress: session.agent_address as Address,
      chainId: Number(session.chain_id),
      expiresAt: toUnixSeconds(session.expires_at),
      maxTradeUsd: BigInt(session.max_trade_usd),
      sessionId: session.session_id as Hex,
      userAddress: session.user_address as Address,
    });
    const isValid = await verifyAgentTradingSessionSignature({
      domain,
      message,
      signature: body.signature,
    });

    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid agent session signature" },
        { status: 401 }
      );
    }

    const targetNetwork = getTargetNetwork();
    const account = privateKeyToAccount(getRelayerPrivateKey());
    const publicClient = createPublicClient({
      chain: targetNetwork.chain,
      transport: http(targetNetwork.rpcUrl),
    });
    const walletClient = createWalletClient({
      account,
      chain: targetNetwork.chain,
      transport: http(targetNetwork.rpcUrl),
    });

    const sessionHash = await walletClient.writeContract({
      address: getAgentRegistryAddress(),
      abi: agentRegistryAbi,
      functionName: "startSession",
      args: [
        session.user_address as Address,
        session.agent_address as Address,
        session.session_id as Hex,
        toUnixSeconds(session.expires_at),
        BigInt(session.max_copm_trade ?? AGENT_SESSION_MAX_COPM_TRADE),
        BigInt(session.max_usdt_trade ?? AGENT_SESSION_MAX_USDT_TRADE),
        BigInt(session.max_copm_volume ?? AGENT_SESSION_MAX_COPM_VOLUME),
        BigInt(session.max_usdt_volume ?? AGENT_SESSION_MAX_USDT_VOLUME),
      ],
    });
    await publicClient.waitForTransactionReceipt({ hash: sessionHash });

    const [updatedSession] = await getSql()`
      UPDATE agent_sessions SET
        status = 'active',
        signature = ${body.signature},
        onchain_session_tx_hash = ${sessionHash},
        updated_at = NOW()
      WHERE session_id = ${body.sessionId}
      RETURNING *
    `;

    return NextResponse.json({ session: updatedSession });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Could not confirm agent session",
      },
      { status: 500 }
    );
  }
}
