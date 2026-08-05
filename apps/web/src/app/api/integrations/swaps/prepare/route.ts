import { NextResponse } from "next/server";
import { isAddress, keccak256, toBytes, type Address } from "viem";

import { appendAttributionSuffix } from "@/lib/celo-attribution";
import { ensureIntegrationSwapTable, getSql } from "@/lib/db";
import { requireIntegrationApiKey } from "@/lib/integration-api-keys";
import { getTargetNetwork } from "@/lib/network-config";
import { getSquidCopmRoute } from "@/lib/squid-config";

type PrepareIntegrationSwapBody = {
  fromAmount?: string;
  fromToken?: "USDC" | "USDm" | "USDT";
  slippage?: number;
  userAddress?: string;
};

const SUPPORTED_INPUT_TOKENS = ["USDT", "USDC", "USDm"] as const;
type SupportedInputToken = (typeof SUPPORTED_INPUT_TOKENS)[number];

function createIntentId() {
  return keccak256(toBytes(crypto.randomUUID()));
}

function parseAtomicAmount(value?: string) {
  if (!value || !/^[0-9]+$/.test(value)) {
    throw new Error("Invalid from amount");
  }
  const amount = BigInt(value);
  if (amount <= 0n) throw new Error("Invalid from amount");
  return amount;
}

function parseSlippage(value: unknown) {
  const slippage = Number(value ?? 0.3);
  if (!Number.isFinite(slippage) || slippage <= 0 || slippage > 3) return 0.3;
  return slippage;
}

function parseInputToken(value: unknown): SupportedInputToken | null {
  if (!value) return "USDT";
  if (SUPPORTED_INPUT_TOKENS.includes(value as SupportedInputToken)) {
    return value as SupportedInputToken;
  }

  return null;
}

export async function POST(request: Request) {
  try {
    const auth = await requireIntegrationApiKey(request);
    if ("response" in auth) return auth.response;

    const body = (await request.json()) as PrepareIntegrationSwapBody;
    if (!body.userAddress || !isAddress(body.userAddress)) {
      return NextResponse.json({ error: "Invalid user address" }, { status: 400 });
    }
    const inputTokenSymbol = parseInputToken(body.fromToken);
    if (!inputTokenSymbol) {
      return NextResponse.json(
        { error: "Only USDT, USDC, or USDm to COPm is supported" },
        { status: 400 }
      );
    }

    const targetNetwork = getTargetNetwork();
    if (targetNetwork.chainId !== 42220) {
      return NextResponse.json(
        { error: "Integration swaps are only enabled on Celo mainnet" },
        { status: 400 }
      );
    }

    const inputTokenConfig =
      inputTokenSymbol === "USDC"
        ? targetNetwork.tokens.usdc
        : inputTokenSymbol === "USDm"
          ? targetNetwork.tokens.usdm
          : targetNetwork.tokens.usdt;
    const inputToken = inputTokenConfig.address;
    const copm = targetNetwork.tokens.copm.address;
    if (!inputToken || !copm) {
      throw new Error(`Missing ${inputTokenSymbol}/COPm token config`);
    }

    const inputAmount = parseAtomicAmount(body.fromAmount);
    const routeResult = await getSquidCopmRoute({
      fromAddress: body.userAddress as Address,
      fromAmount: inputAmount.toString(),
      fromChain: targetNetwork.squidChainId,
      fromToken: inputToken,
      slippage: parseSlippage(body.slippage),
      toAddress: body.userAddress as Address,
      toChain: targetNetwork.squidChainId,
      toToken: copm,
    });

    const tx = routeResult.route?.transactionRequest;
    if (!tx?.target || !isAddress(tx.target) || !tx.data) {
      throw new Error("Invalid Squid transaction");
    }
    if (BigInt(tx.value ?? "0") !== 0n) {
      throw new Error("Integration swaps do not support native value routes");
    }

    const quotedOutputAmount = BigInt(routeResult.route?.estimate?.toAmount ?? "0");
    const minOutputAmount = BigInt(
      routeResult.route?.estimate?.toAmountMin ?? quotedOutputAmount.toString()
    );
    if (quotedOutputAmount <= 0n || minOutputAmount <= 0n) {
      throw new Error("Invalid Squid output amount");
    }

    const intentId = createIntentId();
    const taggedData = appendAttributionSuffix(tx.data, new URL(request.url).hostname);

    await ensureIntegrationSwapTable();
    const [swap] = await getSql()`
      INSERT INTO integration_swap_intents (
        intent_id,
        integration_id,
        user_address,
        chain_id,
        status,
        input_token,
        output_token,
        input_amount,
        quoted_output_amount,
        min_output_amount,
        squid_request_id,
        squid_quote_id,
        approval_target,
        tx_to,
        tx_data,
        tx_value
      )
      VALUES (
        ${intentId},
        ${auth.integration.id},
        ${body.userAddress.toLowerCase()},
        ${targetNetwork.chainId},
        'prepared',
        ${inputToken},
        ${copm},
        ${inputAmount.toString()},
        ${quotedOutputAmount.toString()},
        ${minOutputAmount.toString()},
        ${routeResult.requestId ?? null},
        ${routeResult.route?.quoteId ?? null},
        ${routeResult.approvalTarget ?? null},
        ${tx.target},
        ${taggedData},
        '0'
      )
      RETURNING *
    `;

    return NextResponse.json({
      expectedCopm: quotedOutputAmount.toString(),
      intentId,
      integration: auth.integration,
      route: {
        minAmountOut: minOutputAmount.toString(),
        quoteId: routeResult.route?.quoteId,
        requestId: routeResult.requestId,
      },
      swap,
      transaction: {
        approvalTarget: routeResult.approvalTarget,
        data: taggedData,
        from: body.userAddress,
        inputToken: {
          address: inputToken,
          decimals: inputTokenConfig.decimals,
          symbol: inputTokenConfig.symbol,
        },
        to: tx.target,
        value: "0",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Could not prepare integration swap",
      },
      { status: 500 }
    );
  }
}
