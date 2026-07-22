import { NextResponse } from "next/server";
import {
  createPublicClient,
  encodeFunctionData,
  http,
  isAddress,
  keccak256,
  toBytes,
  type Address,
  type Hex,
} from "viem";

import { AGENT_SESSION_MAX_TRADE_USD } from "@/lib/agent-session";
import { appendAttributionSuffix } from "@/lib/celo-attribution";
import { ensureAgentSessionTable, ensureAgentTradeTable, getSql } from "@/lib/db";
import { getTargetNetwork } from "@/lib/network-config";
import { getSquidRoute } from "@/lib/squid-config";

type PrepareAgentTradeBody = {
  agentAddress?: string;
  direction?: "buy" | "sell";
  inputAmount?: string;
  sessionId?: string;
  slippage?: number;
  userAddress?: string;
};

const agentRegistryAbi = [
  {
    inputs: [
      { name: "user", type: "address" },
      { name: "agent", type: "address" },
    ],
    name: "isSessionActive",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const fxExecutorAbi = [
  {
    inputs: [
      { name: "sessionId", type: "bytes32" },
      { name: "intentId", type: "bytes32" },
      { name: "tokenIn", type: "address" },
      { name: "amountIn", type: "uint256" },
      { name: "minAmountOut", type: "uint256" },
      { name: "swapTarget", type: "address" },
      { name: "swapData", type: "bytes" },
      { name: "deadline", type: "uint256" },
    ],
    name: "executeTrade",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

function getAgentRegistryAddress() {
  const address = process.env.AGENT_REGISTRY_ADDRESS;
  if (!address || !isAddress(address)) {
    throw new Error("Missing AGENT_REGISTRY_ADDRESS");
  }
  return address as Address;
}

function getAgentFxExecutorAddress() {
  const address = process.env.AGENT_FX_EXECUTOR_ADDRESS;
  if (!address || !isAddress(address)) {
    throw new Error("Missing AGENT_FX_EXECUTOR_ADDRESS");
  }
  return address as Address;
}

function createIntentId() {
  return keccak256(toBytes(crypto.randomUUID()));
}

function parseAtomicAmount(value?: string) {
  if (!value || !/^[0-9]+$/.test(value)) {
    throw new Error("Invalid input amount");
  }
  const amount = BigInt(value);
  if (amount <= 0n) throw new Error("Invalid input amount");
  return amount;
}

function getDeadline() {
  return BigInt(Math.floor(Date.now() / 1000) + 5 * 60);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as PrepareAgentTradeBody;
    if (!body.sessionId || !/^0x[0-9a-fA-F]{64}$/.test(body.sessionId)) {
      return NextResponse.json({ error: "Invalid session id" }, { status: 400 });
    }
    if (!body.userAddress || !isAddress(body.userAddress)) {
      return NextResponse.json({ error: "Invalid user address" }, { status: 400 });
    }
    if (!body.agentAddress || !isAddress(body.agentAddress)) {
      return NextResponse.json({ error: "Invalid agent address" }, { status: 400 });
    }
    if (body.direction !== "buy" && body.direction !== "sell") {
      return NextResponse.json({ error: "Invalid trade direction" }, { status: 400 });
    }

    const inputAmount = parseAtomicAmount(body.inputAmount);
    const targetNetwork = getTargetNetwork();
    const copm = targetNetwork.tokens.copm.address;
    const usdt = targetNetwork.tokens.usdt.address;
    if (!copm || !usdt) throw new Error("Missing COPm/USDT token config");

    const inputToken = body.direction === "buy" ? usdt : copm;
    const outputToken = body.direction === "buy" ? copm : usdt;
    if (body.direction === "buy" && inputAmount > AGENT_SESSION_MAX_TRADE_USD) {
      return NextResponse.json(
        { error: "Trade exceeds session max amount" },
        { status: 400 }
      );
    }

    await ensureAgentSessionTable();
    const [session] = await getSql()`
      SELECT *
      FROM agent_sessions
      WHERE session_id = ${body.sessionId}
        AND LOWER(user_address) = ${body.userAddress.toLowerCase()}
        AND LOWER(agent_address) = ${body.agentAddress.toLowerCase()}
      LIMIT 1
    `;
    if (!session) {
      return NextResponse.json({ error: "Agent session not found" }, { status: 404 });
    }
    if (session.status !== "active" || new Date(session.expires_at) <= new Date()) {
      return NextResponse.json(
        { error: "Agent session is not active" },
        { status: 409 }
      );
    }

    const publicClient = createPublicClient({
      chain: targetNetwork.chain,
      transport: http(targetNetwork.rpcUrl),
    });
    const isOnchainActive = await publicClient.readContract({
      address: getAgentRegistryAddress(),
      abi: agentRegistryAbi,
      functionName: "isSessionActive",
      args: [body.userAddress as Address, body.agentAddress as Address],
    });
    if (!isOnchainActive) {
      return NextResponse.json(
        { error: "Agent session is not active onchain" },
        { status: 409 }
      );
    }

    const routeResult = await getSquidRoute({
      fromAddress: body.userAddress as Address,
      fromAmount: inputAmount.toString(),
      fromChain: targetNetwork.squidChainId,
      fromToken: inputToken,
      slippage: body.slippage ?? 0.3,
      toAddress: body.userAddress as Address,
      toChain: targetNetwork.squidChainId,
      toToken: outputToken,
    });
    const tx = routeResult.route?.transactionRequest;
    if (!tx?.target || !isAddress(tx.target) || !tx.data) {
      throw new Error("Invalid Squid transaction");
    }
    if (BigInt(tx.value ?? "0") !== 0n) {
      throw new Error("Agent trades do not support native value routes");
    }

    const quotedOutputAmount = BigInt(routeResult.route?.estimate?.toAmount ?? "0");
    const minAmountOut = BigInt(
      routeResult.route?.estimate?.toAmountMin ?? quotedOutputAmount.toString()
    );
    if (quotedOutputAmount <= 0n) throw new Error("Invalid Squid output amount");
    if (minAmountOut <= 0n) throw new Error("Invalid Squid min output amount");
    if (body.direction === "sell" && quotedOutputAmount > AGENT_SESSION_MAX_TRADE_USD) {
      return NextResponse.json(
        { error: "Trade exceeds session max amount" },
        { status: 400 }
      );
    }

    const intentId = createIntentId();
    const deadline = getDeadline();
    const tradeData = encodeFunctionData({
      abi: fxExecutorAbi,
      functionName: "executeTrade",
      args: [
        body.sessionId as Hex,
        intentId,
        inputToken,
        inputAmount,
        minAmountOut,
        tx.target as Address,
        tx.data,
        deadline,
      ],
    });
    const taggedTradeData = appendAttributionSuffix(
      tradeData,
      new URL(request.url).hostname
    );

    await ensureAgentTradeTable();
    const [trade] = await getSql()`
      INSERT INTO agent_trades (
        intent_id,
        session_id,
        user_address,
        agent_address,
        chain_id,
        status,
        direction,
        input_token,
        output_token,
        input_amount,
        quoted_output_amount,
        squid_request_id,
        squid_quote_id,
        batch_to,
        batch_data,
        batch_value
      )
      VALUES (
        ${intentId},
        ${body.sessionId},
        ${body.userAddress.toLowerCase()},
        ${body.agentAddress.toLowerCase()},
        ${targetNetwork.chainId},
        'prepared',
        ${body.direction},
        ${inputToken},
        ${outputToken},
        ${inputAmount.toString()},
        ${quotedOutputAmount.toString()},
        ${routeResult.requestId ?? null},
        ${routeResult.route?.quoteId ?? null},
        ${body.userAddress},
        ${taggedTradeData},
        '0'
      )
      RETURNING *
    `;

    return NextResponse.json({
      intentId,
      route: {
        minAmountOut: minAmountOut.toString(),
        quoteId: routeResult.route?.quoteId,
        requestId: routeResult.requestId,
        toAmount: quotedOutputAmount.toString(),
      },
      trade,
      transaction: {
        data: taggedTradeData,
        delegateTo: getAgentFxExecutorAddress(),
        from: body.agentAddress,
        to: body.userAddress,
        value: "0",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not prepare agent trade",
      },
      { status: 500 }
    );
  }
}
