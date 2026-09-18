import { encodeFunctionData, getAddress, parseAbi, type Address } from "viem";

import { appendAttributionSuffix } from "../celo-attribution";

import { getBrebTokenAddresses } from "./config";
import type { PreparedTx } from "./types";

const erc20Abi = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
]);

export function encodeUsdcTransfer(to: Address, amount: bigint): PreparedTx {
  const tokens = getBrebTokenAddresses();
  return {
    data: encodeFunctionData({
      abi: erc20Abi,
      args: [getAddress(to), amount],
      functionName: "transfer",
    }),
    to: tokens.usdc,
    value: "0",
  };
}

export function tagPreparedTx(tx: PreparedTx, hostname?: string): PreparedTx {
  return {
    ...tx,
    data: appendAttributionSuffix(tx.data, hostname),
  };
}
