import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";

const baseUrl = process.env.COP_BY_APP_URL ?? "http://localhost:3000";
const privateKey = process.env.TEST_AGENT_PRIVATE_KEY;
const thresholdBps = process.env.FX_AGENT_EDGE_THRESHOLD_BPS ?? "100";

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
const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);

async function request(method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { "content-type": "application/json" } : undefined,
    method,
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${path} failed ${response.status}: ${JSON.stringify(data)}`);
  }
  return data;
}

function post(path, body) {
  return request("POST", path, body);
}

function get(path) {
  return request("GET", path);
}

async function startAndConfirmSession() {
  const started = await post("/api/agent/session/start", {
    agentAddress: account.address,
    durationHours: 24,
    userAddress: account.address,
  });

  const sessionId = started.session.session_id;
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

  await post("/api/agent/session/confirm", { sessionId, signature });
  return sessionId;
}

async function getSessionId() {
  try {
    return await startAndConfirmSession();
  } catch (error) {
    if (!String(error.message).includes("User already has an active agent session")) {
      throw error;
    }
    const current = await get(
      `/api/agent/session/active?userAddress=${account.address}&agentAddress=${account.address}`
    );
    if (current.session?.status === "active") return current.session.session_id;
    throw new Error("Agent session exists but is not active.");
  }
}

async function getBalance(token) {
  return publicClient.readContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [account.address],
  });
}

function formatBps(value) {
  return value === null || value === undefined
    ? "unavailable"
    : `${(value / 100).toFixed(2)}%`;
}

function formatTokenAmount(value, decimals, maxFractionDigits = 4) {
  const padded = value.toString().padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  const trimmedFraction = fraction.slice(0, maxFractionDigits);
  return trimmedFraction ? `${whole}.${trimmedFraction}` : whole;
}

function getHoldAsset(market) {
  const buyEdge = market.signals.buyEdgeBps;
  const sellEdge = market.signals.sellEdgeBps;
  if (buyEdge !== null && sellEdge !== null) {
    return buyEdge > sellEdge ? "USDT" : "COPm";
  }
  if (buyEdge !== null) return "USDT";
  if (sellEdge !== null) return "COPm";
  return "current balances";
}

function logMarketDetails(market) {
  console.log(
    `Reference API: 1 USD = ${market.reference.copPerUsd.toFixed(4)} COP (${market.reference.source}, ${market.reference.date ?? "latest"}).`
  );
  for (const reference of market.reference.references ?? []) {
    console.log(
      `  ${reference.source}: 1 USD = ${reference.copPerUsd.toFixed(4)} COP (${reference.date ?? "latest"})`
    );
  }
  if (market.quotes.buy) {
    console.log(
      [
        `Squid buy quote: ${formatTokenAmount(BigInt(market.quotes.buy.inputUsdt), 6, 6)} USDT -> ${formatTokenAmount(BigInt(market.quotes.buy.outputCopm), 18, 4)} COPm`,
        `  implied: 1 USDT = ${market.quotes.buy.copmPerUsdt.toFixed(4)} COPm`,
        `  requestId: ${market.quotes.buy.requestId ?? "n/a"}`,
        `  quoteId: ${market.quotes.buy.quoteId ?? "n/a"}`,
      ].join("\n")
    );
  } else {
    console.log("Squid buy quote: unavailable");
  }
  if (market.quotes.sell) {
    console.log(
      [
        `Squid sell quote: ${formatTokenAmount(BigInt(market.quotes.sell.inputCopm), 18, 4)} COPm -> ${formatTokenAmount(BigInt(market.quotes.sell.outputUsdt), 6, 6)} USDT`,
        `  implied: reference COPm basket = ${market.quotes.sell.usdtForReferenceCopm.toFixed(6)} USDT`,
        `  requestId: ${market.quotes.sell.requestId ?? "n/a"}`,
        `  quoteId: ${market.quotes.sell.quoteId ?? "n/a"}`,
      ].join("\n")
    );
  } else {
    console.log("Squid sell quote: unavailable");
  }
}

async function runTrade({ direction, inputAmount }) {
  const prepared = await post("/api/agent/trade/prepare", {
    agentAddress: account.address,
    direction,
    inputAmount,
    sessionId,
    slippage: 0.3,
    userAddress: account.address,
  });
  const tx = prepared.transaction;
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
  const hash = await walletClient.sendTransaction({
    ...sendArgs,
    gas: (estimatedGas * 130n) / 100n,
  });
  await publicClient.waitForTransactionReceipt({ hash });
  const confirmed = await post(`/api/agent/trade/${prepared.intentId}/confirm`, {
    txHash: hash,
  });
  return { hash, intentId: prepared.intentId, trade: confirmed.trade };
}

console.log("Agent wallet:", account.address);
console.log("Base URL:", baseUrl);

const market = await get(
  `/api/agent/market?userAddress=${account.address}&thresholdBps=${thresholdBps}`
);
logMarketDetails(market);
console.log(
  `Market: buy edge ${formatBps(market.signals.buyEdgeBps)}, sell edge ${formatBps(
    market.signals.sellEdgeBps
  )}, threshold ${formatBps(market.signals.thresholdBps)}.`
);

if (market.signals.recommendation === "hold") {
  console.log(`Decision: hold ${getHoldAsset(market)}. No trade executed.`);
  console.log(
    `Reason: buy edge ${formatBps(market.signals.buyEdgeBps)}, sell edge ${formatBps(
      market.signals.sellEdgeBps
    )}, threshold ${formatBps(market.signals.thresholdBps)}.`
  );
  process.exit(0);
}

const quote = market.quotes[market.signals.recommendation];
const direction = market.signals.recommendation;
const inputAmount = direction === "buy" ? quote.inputUsdt : quote.inputCopm;
const inputToken = direction === "buy" ? "USDT" : "COPm";
const tokenAddress =
  direction === "buy"
    ? "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e"
    : "0x8A567e2aE79CA692Bd748aB832081C45de4041eA";
const balance = await getBalance(tokenAddress);

if (balance < BigInt(inputAmount)) {
  console.log(
    `Decision: hold ${inputToken}. ${direction.toUpperCase()} signal skipped because balance is insufficient.`
  );
  console.log(
    `Reason: ${inputToken} balance ${balance.toString()}, required ${inputAmount}.`
  );
  process.exit(0);
}

const sessionId = await getSessionId();
console.log(`Decision: ${direction.toUpperCase()}. Executing ${inputAmount}.`);
const result = await runTrade({ direction, inputAmount });
const spent =
  direction === "buy"
    ? `${formatTokenAmount(BigInt(result.trade.input_amount), 6, 6)} USDT`
    : `${formatTokenAmount(BigInt(result.trade.input_amount), 18, 4)} COPm`;
const received =
  direction === "buy"
    ? `${formatTokenAmount(BigInt(result.trade.actual_output_amount), 18, 4)} COPm`
    : `${formatTokenAmount(BigInt(result.trade.actual_output_amount), 6, 6)} USDT`;

console.log(
  [
    `Reason: ${direction} edge ${formatBps(
      direction === "buy"
        ? market.signals.buyEdgeBps
        : market.signals.sellEdgeBps
    )} > threshold ${formatBps(market.signals.thresholdBps)}.`,
    `Spent: ${spent}`,
    `Received: ${received}`,
    `Intent: ${result.intentId}`,
    `Tx: ${result.hash}`,
  ].join("\n")
);
