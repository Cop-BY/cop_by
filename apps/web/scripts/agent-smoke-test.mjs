import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";

const baseUrl = process.env.COP_BY_APP_URL ?? "http://localhost:3000";
const privateKey = process.env.TEST_AGENT_PRIVATE_KEY;
const runSell = process.env.TEST_AGENT_RUN_SELL === "true";
const buyAmount = process.env.TEST_AGENT_BUY_USDT_ATOMIC ?? "1000000";
const sellAmount = process.env.TEST_AGENT_SELL_COPM_ATOMIC ?? "3000000000000000000000";
const usdtAddress = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e";
const copmAddress = "0x8A567e2aE79CA692Bd748aB832081C45de4041eA";
const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);

if (!privateKey) throw new Error("Missing TEST_AGENT_PRIVATE_KEY");

const account = privateKeyToAccount(
  privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`
);
const publicClient = createPublicClient({
  chain: celo,
  transport: http(process.env.CELO_RPC_URL ?? "https://forno.celo.org"),
});
const walletClient = createWalletClient({
  account,
  chain: celo,
  transport: http(process.env.CELO_RPC_URL ?? "https://forno.celo.org"),
});

async function post(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${path} failed ${response.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function get(path) {
  const response = await fetch(`${baseUrl}${path}`);
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${path} failed ${response.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

async function startAndConfirmSession() {
  const started = await post("/api/agent/session/start", {
    agentAddress: account.address,
    durationHours: 24,
    userAddress: account.address,
  });

  const nextSessionId = started.session.session_id;
  console.log("Session:", nextSessionId);

  const signature = await walletClient.signTypedData({
    account,
    domain: started.domain,
    message: {
      ...started.message,
      chainId: BigInt(started.message.chainId),
      expiresAt: BigInt(started.message.expiresAt),
      maxTradeUsd: BigInt(started.message.maxTradeUsd),
    },
    primaryType: started.primaryType,
    types: started.types,
  });

  const confirmedSession = await post("/api/agent/session/confirm", {
    sessionId: nextSessionId,
    signature,
  });
  console.log(
    "Session active:",
    confirmedSession.session.status,
    confirmedSession.session.onchain_session_tx_hash
  );

  return nextSessionId;
}

async function runTrade({ direction, inputAmount }) {
  console.log(`Preparing ${direction} trade...`);
  const prepared = await post("/api/agent/trade/prepare", {
    agentAddress: account.address,
    direction,
    inputAmount,
    sessionId,
    slippage: 0.3,
    userAddress: account.address,
  });

  console.log(`${direction} intentId: ${prepared.intentId}`);
  const tx = prepared.transaction;
  if (!tx.delegateTo) {
    throw new Error("Prepared transaction is missing delegateTo.");
  }
  const authorization = await walletClient.signAuthorization({
    account,
    contractAddress: tx.delegateTo,
    executor: "self",
  });
  const sendArgs = {
    account,
    authorizationList: [authorization],
    data: tx.data,
    to: tx.to,
    value: BigInt(tx.value ?? "0"),
  };
  const estimatedGas = await publicClient.estimateGas(sendArgs);
  const gas = (estimatedGas * 130n) / 100n;
  const hash = await walletClient.sendTransaction({
    ...sendArgs,
    gas,
  });
  console.log(`${direction} tx: ${hash}`);

  await publicClient.waitForTransactionReceipt({ hash });
  const confirmed = await post(
    `/api/agent/trade/${prepared.intentId}/confirm`,
    { txHash: hash }
  );
  console.log(`${direction} confirmed:`, JSON.stringify(confirmed.trade, null, 2));
}

async function getTokenBalance(token) {
  return publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  });
}

console.log("Agent wallet:", account.address);
console.log("Base URL:", baseUrl);

let sessionId;
try {
  sessionId = await startAndConfirmSession();
} catch (error) {
  if (!String(error.message).includes("User already has an active agent session")) {
    throw error;
  }

  const current = await get(
    `/api/agent/session/active?userAddress=${account.address}&agentAddress=${account.address}`
  );
  if (!current.session?.session_id) {
    throw new Error("Current session exists but could not be loaded.");
  }
  if (current.session.status === "pending") {
    console.log("Revoking stale pending session:", current.session.session_id);
    await post(`/api/agent/session/${current.session.session_id}/revoke`, {
      error: "agent smoke test reset stale pending session",
    });
    sessionId = await startAndConfirmSession();
  } else {
    sessionId = current.session.session_id;
    console.log("Reusing active session:", sessionId);
  }
}

const usdtBalance = await getTokenBalance(usdtAddress);
if (usdtBalance >= BigInt(buyAmount)) {
  await runTrade({ direction: "buy", inputAmount: buyAmount });
} else if (runSell) {
  console.log(
    `Skipping buy: USDT balance ${usdtBalance.toString()} is below buy amount ${buyAmount}.`
  );
} else {
  throw new Error(
    `Insufficient USDT for buy smoke test. Balance ${usdtBalance.toString()}, required ${buyAmount}.`
  );
}

if (runSell) {
  const copmBalance = await getTokenBalance(copmAddress);
  if (copmBalance < BigInt(sellAmount)) {
    throw new Error(
      `Insufficient COPm for sell smoke test. Balance ${copmBalance.toString()}, required ${sellAmount}.`
    );
  }
  await runTrade({ direction: "sell", inputAmount: sellAmount });
}

console.log("Agent smoke test complete.");
