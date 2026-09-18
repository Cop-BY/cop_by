import {
  createPublicClient,
  encodeFunctionData,
  getAddress,
  http,
  parseAbi,
  type Address,
} from "viem";

import { getTargetNetwork } from "../network-config";

import { getBrebConfig, getBrebTokenAddresses } from "./config";
import { BrebError } from "./errors";
import { addBps } from "./money";
import type { CopmQuoteResult, PreparedTx } from "./types";

const FEE_TIERS = [500, 3000, 10000] as const;

const quoterV2Abi = parseAbi([
  "function quoteExactOutputSingle((address tokenIn, address tokenOut, uint256 amount, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountIn, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)",
]);

const swapRouter02Abi = parseAbi([
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) payable returns (uint256 amountOut)",
  "function multicall(bytes[] data) payable returns (bytes[] results)",
]);

const poolAbi = parseAbi([
  "function fee() view returns (uint24)",
  "function token0() view returns (address)",
  "function token1() view returns (address)",
]);

function getPublicClient() {
  const network = getTargetNetwork();
  return createPublicClient({
    chain: network.chain,
    transport: http(network.rpcUrl),
  });
}

async function resolvePoolFee(client: ReturnType<typeof getPublicClient>) {
  const config = getBrebConfig();
  if (config.uniswapPoolFee) return config.uniswapPoolFee;
  if (!config.uniswapPool) return null;

  try {
    return Number(
      await client.readContract({
        abi: poolAbi,
        address: config.uniswapPool,
        functionName: "fee",
      })
    );
  } catch {
    return null;
  }
}

export function encodeUniswapV3CopmSwaps(input: {
  copmInDeposit: bigint;
  copmInFee?: bigint;
  depositAddress: Address;
  fee: number;
  feeWallet?: Address;
  minUsdcDeposit: bigint;
  minUsdcFee?: bigint;
}): PreparedTx {
  const tokens = getBrebTokenAddresses();
  const config = getBrebConfig();
  const depositCall = encodeFunctionData({
    abi: swapRouter02Abi,
    args: [
      {
        amountIn: input.copmInDeposit,
        amountOutMinimum: input.minUsdcDeposit,
        fee: input.fee,
        recipient: input.depositAddress,
        sqrtPriceLimitX96: 0n,
        tokenIn: tokens.copm,
        tokenOut: tokens.usdc,
      },
    ],
    functionName: "exactInputSingle",
  });

  const calls = [depositCall];
  if (input.copmInFee && input.feeWallet && input.minUsdcFee) {
    calls.push(
      encodeFunctionData({
        abi: swapRouter02Abi,
        args: [
          {
            amountIn: input.copmInFee,
            amountOutMinimum: input.minUsdcFee,
            fee: input.fee,
            recipient: input.feeWallet,
            sqrtPriceLimitX96: 0n,
            tokenIn: tokens.copm,
            tokenOut: tokens.usdc,
          },
        ],
        functionName: "exactInputSingle",
      })
    );
  }

  const data =
    calls.length === 1
      ? calls[0]
      : encodeFunctionData({
          abi: swapRouter02Abi,
          args: [calls],
          functionName: "multicall",
        });

  return {
    approvalTarget: getAddress(config.uniswapRouter),
    data,
    to: getAddress(config.uniswapRouter),
    value: "0",
  };
}

export async function quoteUniswapV3CopmInForUsdcOut(
  usdcOut: bigint
): Promise<{ copmIn: bigint; fee: number }> {
  const tokens = getBrebTokenAddresses();
  const config = getBrebConfig();
  const client = getPublicClient();
  const poolFee = await resolvePoolFee(client);
  const fees = poolFee ? [poolFee] : [...FEE_TIERS];
  let lastError: unknown;

  for (const fee of fees) {
    try {
      const { result } = await client.simulateContract({
        abi: quoterV2Abi,
        address: config.uniswapQuoter,
        args: [
          {
            amount: usdcOut,
            fee,
            sqrtPriceLimitX96: 0n,
            tokenIn: tokens.copm,
            tokenOut: tokens.usdc,
          },
        ],
        functionName: "quoteExactOutputSingle",
      });
      const quoted = result as unknown;
      const amountIn = Array.isArray(quoted) ? BigInt(quoted[0]) : BigInt(quoted as bigint);
      if (amountIn > 0n) return { copmIn: amountIn, fee };
    } catch (error) {
      lastError = error;
    }
  }

  throw new BrebError(
    "mercado_cerrado",
    "mercado de pesos cerrado",
    503,
    { cause: lastError instanceof Error ? lastError.message : undefined }
  );
}

export async function getUniswapV3CopmQuote(input: {
  copbyFeeAtomic?: bigint;
  depositAddress: Address;
  feeWallet?: Address;
  netUsdcAtomic: bigint;
}): Promise<CopmQuoteResult> {
  const config = getBrebConfig();
  const depositQuote = await quoteUniswapV3CopmInForUsdcOut(input.netUsdcAtomic);
  const feeQuote =
    input.copbyFeeAtomic && input.feeWallet
      ? await quoteUniswapV3CopmInForUsdcOut(input.copbyFeeAtomic)
      : null;
  const copmDeposit = addBps(depositQuote.copmIn, config.swapSlippageBps);
  const copmFee = feeQuote ? addBps(feeQuote.copmIn, config.swapSlippageBps) : 0n;

  return {
    approvalTarget: getAddress(config.uniswapRouter),
    copmIn: copmDeposit + copmFee,
    provider: "uniswap_v3",
    transaction: encodeUniswapV3CopmSwaps({
      copmInDeposit: copmDeposit,
      copmInFee: feeQuote ? copmFee : undefined,
      depositAddress: input.depositAddress,
      fee: depositQuote.fee,
      feeWallet: input.feeWallet,
      minUsdcDeposit: input.netUsdcAtomic,
      minUsdcFee: input.copbyFeeAtomic,
    }),
  };
}
