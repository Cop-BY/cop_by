import { NextResponse } from "next/server";
import {
  createPublicClient,
  http,
  isAddress,
  parseEventLogs,
  type Hex,
} from "viem";

import { ensureIntegrationSwapTable, getSql } from "@/lib/db";
import { requireIntegrationApiKey } from "@/lib/integration-api-keys";
import { getTargetNetwork } from "@/lib/network-config";

type ConfirmIntegrationSwapBody = {
  txHash?: string;
};

type IntegrationSwapRow = {
  input_token: string;
  integration_id: string;
  intent_id: string;
  output_token: string;
  status: string;
  tx_data: string | null;
  tx_to: string | null;
  user_address: string;
};

const erc20TransferAbi = [
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "from", type: "address" },
      { indexed: true, name: "to", type: "address" },
      { indexed: false, name: "value", type: "uint256" },
    ],
    name: "Transfer",
    type: "event",
  },
] as const;

function isIntentId(value?: string): value is Hex {
  return /^0x[0-9a-fA-F]{64}$/.test(value ?? "");
}

function isTxHash(value?: string): value is Hex {
  return /^0x[0-9a-fA-F]{64}$/.test(value ?? "");
}

export async function POST(
  request: Request,
  { params }: { params: { intentId: string } }
) {
  try {
    const auth = await requireIntegrationApiKey(request);
    if ("response" in auth) return auth.response;

    if (!isIntentId(params.intentId)) {
      return NextResponse.json({ error: "Invalid intent id" }, { status: 400 });
    }

    const body = (await request.json()) as ConfirmIntegrationSwapBody;
    if (!isTxHash(body.txHash)) {
      return NextResponse.json({ error: "Invalid tx hash" }, { status: 400 });
    }

    await ensureIntegrationSwapTable();
    const [swap] = (await getSql()`
      SELECT *
      FROM integration_swap_intents
      WHERE intent_id = ${params.intentId}
        AND integration_id = ${auth.integration.id}
      LIMIT 1
    `) as IntegrationSwapRow[];

    if (!swap) {
      return NextResponse.json({ error: "Integration swap not found" }, { status: 404 });
    }
    if (swap.status === "confirmed") {
      return NextResponse.json({ swap });
    }

    const targetNetwork = getTargetNetwork();
    const publicClient = createPublicClient({
      chain: targetNetwork.chain,
      transport: http(targetNetwork.rpcUrl),
    });
    const [transaction, receipt] = await Promise.all([
      publicClient.getTransaction({ hash: body.txHash }),
      publicClient.waitForTransactionReceipt({ hash: body.txHash }),
    ]);

    if (transaction.from.toLowerCase() !== swap.user_address.toLowerCase()) {
      return NextResponse.json(
        { error: "Transaction sender does not match prepared swap" },
        { status: 400 }
      );
    }
    if (
      swap.tx_to &&
      transaction.to?.toLowerCase() !== swap.tx_to.toLowerCase()
    ) {
      return NextResponse.json(
        { error: "Transaction target does not match prepared swap" },
        { status: 400 }
      );
    }
    if (
      swap.tx_data &&
      transaction.input.toLowerCase() !== swap.tx_data.toLowerCase()
    ) {
      return NextResponse.json(
        { error: "Transaction data does not match prepared swap" },
        { status: 400 }
      );
    }

    if (receipt.status !== "success") {
      const [failedSwap] = await getSql()`
        UPDATE integration_swap_intents SET
          status = 'failed',
          swap_tx_hash = ${body.txHash},
          error = 'Transaction reverted',
          updated_at = NOW()
        WHERE intent_id = ${params.intentId}
        RETURNING *
      `;
      return NextResponse.json({ swap: failedSwap }, { status: 409 });
    }

    if (!isAddress(swap.output_token)) {
      throw new Error("Invalid output token");
    }
    const transferLogs = parseEventLogs({
      abi: erc20TransferAbi,
      eventName: "Transfer",
      logs: receipt.logs.filter(
        (log) => log.address.toLowerCase() === swap.output_token.toLowerCase()
      ),
    });
    const actualOutputAmount = transferLogs.reduce((sum, log) => {
      const to = log.args.to?.toLowerCase();
      if (to !== swap.user_address.toLowerCase()) return sum;
      return sum + (log.args.value ?? 0n);
    }, 0n);

    if (actualOutputAmount <= 0n) {
      const [failedSwap] = await getSql()`
        UPDATE integration_swap_intents SET
          status = 'failed',
          swap_tx_hash = ${body.txHash},
          error = 'COPm transfer to user not found',
          updated_at = NOW()
        WHERE intent_id = ${params.intentId}
        RETURNING *
      `;
      return NextResponse.json({ swap: failedSwap }, { status: 409 });
    }

    const [updatedSwap] = await getSql()`
      UPDATE integration_swap_intents SET
        status = 'confirmed',
        swap_tx_hash = ${body.txHash},
        actual_output_amount = ${actualOutputAmount.toString()},
        updated_at = NOW()
      WHERE intent_id = ${params.intentId}
      RETURNING *
    `;

    return NextResponse.json({ swap: updatedSwap });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not confirm integration swap",
      },
      { status: 500 }
    );
  }
}
