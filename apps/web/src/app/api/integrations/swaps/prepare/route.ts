import { NextResponse } from "next/server";
import { isAddress, keccak256, toBytes, type Address } from "viem";

import { appendAttributionSuffix } from "@/lib/celo-attribution";
import { ensureIntegrationSwapTable, getSql } from "@/lib/db";
import { requireIntegrationApiKey } from "@/lib/integration-api-keys";
import { getTargetNetwork } from "@/lib/network-config";
import { getSquidCopmRoute } from "@/lib/squid-config";

type PrepareIntegrationSwapBody = {
  fromAmount?: string;
  fromToken?: "COPm" | "USDC" | "USDm" | "USDT";
  slippage?: number;
  toToken?: "COPm" | "USDT";
  userAddress?: string;
};

const SUPPORTED_TOKENS = ["COPm", "USDT", "USDC", "USDm"] as const;
type SupportedToken = (typeof SUPPORTED_TOKENS)[number];

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

function parseToken(value: unknown, fallback: SupportedToken): SupportedToken | null {
  if (!value) return fallback;
  if (SUPPORTED_TOKENS.includes(value as SupportedToken)) {
    return value as SupportedToken;
  }

  return null;
}

function getTokenConfig(targetNetwork: ReturnType<typeof getTargetNetwork>, symbol: SupportedToken) {
  if (symbol === "COPm") return targetNetwork.tokens.copm;
  if (symbol === "USDC") return targetNetwork.tokens.usdc;
  if (symbol === "USDm") return targetNetwork.tokens.usdm;
  return targetNetwork.tokens.usdt;
}

export async function POST(request: Request) {
  try {
    const auth = await requireIntegrationApiKey(request);
    if ("response" in auth) return auth.response;

    const body = (await request.json()) as PrepareIntegrationSwapBody;
    if (!body.userAddress || !isAddress(body.userAddress)) {
      return NextResponse.json({ error: "Invalid user address" }, { status: 400 });
    }
    const inputTokenSymbol = parseToken(body.fromToken, "USDT");
    if (!inputTokenSymbol) {
      return NextResponse.json(
        { error: "Only USDT, USDC, USDm, or COPm is supported" },
        { status: 400 }
      );
    }
    const outputTokenSymbol = parseToken(
      body.toToken,
      inputTokenSymbol === "COPm" ? "USDT" : "COPm"
    );
    if (!outputTokenSymbol) {
      return NextResponse.json(
        { error: "Only COPm or USDT output is supported" },
        { status: 400 }
      );
    }
    const isEntrySwap =
      ["USDT", "USDC", "USDm"].includes(inputTokenSymbol) &&
      outputTokenSymbol === "COPm";
    const isExitSwap = inputTokenSymbol === "COPm" && outputTokenSymbol === "USDT";
    if (!isEntrySwap && !isExitSwap) {
      return NextResponse.json(
        { error: "Supported pairs are USDT/USDC/USDm to COPm and COPm to USDT" },
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

    const inputTokenConfig = getTokenConfig(targetNetwork, inputTokenSymbol);
    const outputTokenConfig = getTokenConfig(targetNetwork, outputTokenSymbol);
    const inputToken = inputTokenConfig.address;
    const outputToken = outputTokenConfig.address;
    if (!inputToken || !outputToken) {
      throw new Error(`Missing ${inputTokenSymbol}/${outputTokenSymbol} token config`);
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
      toToken: outputToken,
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
        ${outputToken},
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
      expectedCopm:
        outputTokenSymbol === "COPm" ? quotedOutputAmount.toString() : undefined,
      expectedOutputAmount: quotedOutputAmount.toString(),
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
        outputToken: {
          address: outputToken,
          decimals: outputTokenConfig.decimals,
          symbol: outputTokenConfig.symbol,
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
