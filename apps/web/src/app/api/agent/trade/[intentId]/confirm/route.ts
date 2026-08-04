import { NextResponse } from "next/server";
import {
  createPublicClient,
  http,
  isAddress,
  parseEventLogs,
  type Address,
  type Hex,
} from "viem";

import { ensureAgentTradeTable, getSql } from "@/lib/db";
import { getTargetNetwork } from "@/lib/network-config";

type ConfirmAgentTradeBody = {
  txHash?: string;
};

const fxExecutorAbi = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "user", type: "address" },
      { indexed: true, name: "agent", type: "address" },
      { indexed: true, name: "sessionId", type: "bytes32" },
      { indexed: false, name: "intentId", type: "bytes32" },
      { indexed: false, name: "tokenIn", type: "address" },
      { indexed: false, name: "tokenOut", type: "address" },
      { indexed: false, name: "amountIn", type: "uint256" },
      { indexed: false, name: "amountOut", type: "uint256" },
    ],
    name: "AgentTradeExecuted",
    type: "event",
  },
] as const;

function isTxHash(value?: string): value is Hex {
  return /^0x[0-9a-fA-F]{64}$/.test(value ?? "");
}

export async function POST(
  request: Request,
  { params }: { params: { intentId: string } }
) {
  try {
    if (!/^0x[0-9a-fA-F]{64}$/.test(params.intentId)) {
      return NextResponse.json({ error: "Invalid intent id" }, { status: 400 });
    }

    const body = (await request.json()) as ConfirmAgentTradeBody;
    if (!isTxHash(body.txHash)) {
      return NextResponse.json({ error: "Invalid tx hash" }, { status: 400 });
    }

    await ensureAgentTradeTable();
    const [trade] = await getSql()`
      SELECT *
      FROM agent_trades
      WHERE intent_id = ${params.intentId}
      LIMIT 1
    `;
    if (!trade) {
      return NextResponse.json({ error: "Agent trade not found" }, { status: 404 });
    }
    if (trade.status === "confirmed") {
      return NextResponse.json({ trade });
    }

    const targetNetwork = getTargetNetwork();
    const publicClient = createPublicClient({
      chain: targetNetwork.chain,
      transport: http(targetNetwork.rpcUrl),
    });
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: body.txHash,
    });

    if (receipt.status !== "success") {
      const [failedTrade] = await getSql()`
        UPDATE agent_trades SET
          status = 'failed',
          trade_tx_hash = ${body.txHash},
          error = 'Transaction reverted',
          updated_at = NOW()
        WHERE intent_id = ${params.intentId}
        RETURNING *
      `;
      return NextResponse.json({ trade: failedTrade }, { status: 409 });
    }

    const logs = parseEventLogs({
      abi: fxExecutorAbi,
      eventName: "AgentTradeExecuted",
      logs: receipt.logs,
    });
    const tradeLog = logs.find((log) => {
      const args = log.args;
      return (
        args.intentId?.toLowerCase() === params.intentId.toLowerCase() &&
        args.user?.toLowerCase() === String(trade.user_address).toLowerCase() &&
        args.agent?.toLowerCase() === String(trade.agent_address).toLowerCase() &&
        args.tokenIn?.toLowerCase() === String(trade.input_token).toLowerCase() &&
        args.tokenOut?.toLowerCase() === String(trade.output_token).toLowerCase()
      );
    });

    if (!tradeLog) {
      return NextResponse.json(
        { error: "Transaction does not match prepared agent trade" },
        { status: 400 }
      );
    }

    const [updatedTrade] = await getSql()`
      UPDATE agent_trades SET
        status = 'confirmed',
        trade_tx_hash = ${body.txHash},
        actual_output_amount = ${tradeLog.args.amountOut?.toString() ?? null},
        updated_at = NOW()
      WHERE intent_id = ${params.intentId}
      RETURNING *
    `;

    return NextResponse.json({ trade: updatedTrade });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not confirm agent trade",
      },
      { status: 500 }
    );
  }
}
