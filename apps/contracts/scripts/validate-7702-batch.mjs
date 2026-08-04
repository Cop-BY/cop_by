import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  getAddress,
  http,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";

const batchExecutorAbi = parseAbi([
  "function execute((address target,uint256 value,bytes data)[] calls) payable",
]);
const erc20Abi = parseAbi(["function balanceOf(address account) view returns (uint256)"]);

function getEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function normalizeKey(value) {
  return value.startsWith("0x") ? value : `0x${value}`;
}

function getUserPrivateKey() {
  if (process.env.AGENT_7702_TEST_PRIVATE_KEY) {
    return normalizeKey(process.env.AGENT_7702_TEST_PRIVATE_KEY);
  }
  if (process.env.ALLOW_PRIVATE_KEY_7702_TEST === "true" && process.env.PRIVATE_KEY) {
    return normalizeKey(process.env.PRIVATE_KEY);
  }
  throw new Error(
    "Set AGENT_7702_TEST_PRIVATE_KEY with a funded test wallet. " +
      "Refusing to use PRIVATE_KEY unless ALLOW_PRIVATE_KEY_7702_TEST=true."
  );
}

function getRelayerPrivateKey() {
  return normalizeKey(
    process.env.AGENT_RELAYER_PRIVATE_KEY ??
      process.env.BACKEND_LOGGER_PRIVATE_KEY ??
      getEnv("PRIVATE_KEY")
  );
}

function formatError(error) {
  const details = [
    error?.shortMessage,
    error?.details,
    error?.cause?.shortMessage,
    error?.cause?.details,
    error?.message,
  ].filter(Boolean);
  return [...new Set(details)].join(" | ");
}

async function getDelegation(publicClient, address) {
  if (typeof publicClient.getDelegation === "function") {
    return publicClient.getDelegation({ address }).catch(() => undefined);
  }
  const code = await publicClient.getCode({ address }).catch(() => undefined);
  return code?.startsWith("0xef0100") ? `0x${code.slice(-40)}` : undefined;
}

async function setDelegation({
  batchExecutor,
  executor,
  publicClient,
  relayer,
  user,
  walletClient,
}) {
  const authorization = await walletClient.signAuthorization({
    account: user,
    contractAddress: batchExecutor,
    executor,
  });
  const hash = await walletClient.sendTransaction({
    account: walletClient.account,
    authorizationList: [authorization],
    gas: 100_000n,
    to: relayer.address,
    value: 0n,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return { hash, status: receipt.status };
}

async function sendBatch({
  batchData,
  executorLabel,
  publicClient,
  user,
  walletClient,
}) {
  const hash = await walletClient.sendTransaction({
    account: walletClient.account,
    data: batchData,
    to: user.address,
    value: 0n,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return {
    executor: executorLabel,
    hash,
    status: receipt.status,
  };
}

async function main() {
  const rpcUrl = process.env.NEXT_PUBLIC_CELO_RPC_URL ?? "https://forno.celo.org";
  const batchExecutor = getAddress(getEnv("BATCH_EXECUTOR_ADDRESS"));
  const copm = getAddress(
    process.env.COPM_ADDRESS ?? "0x8A567e2aE79CA692Bd748aB832081C45de4041eA"
  );
  const user = privateKeyToAccount(getUserPrivateKey());
  const relayer = privateKeyToAccount(getRelayerPrivateKey());

  const publicClient = createPublicClient({
    chain: celo,
    transport: http(rpcUrl),
  });
  const userWallet = createWalletClient({
    account: user,
    chain: celo,
    transport: http(rpcUrl),
  });
  const relayerWallet = createWalletClient({
    account: relayer,
    chain: celo,
    transport: http(rpcUrl),
  });

  const balanceOfData = encodeFunctionData({
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [user.address],
  });
  const batchData = encodeFunctionData({
    abi: batchExecutorAbi,
    functionName: "execute",
    args: [
      [
        {
          data: balanceOfData,
          target: copm,
          value: 0n,
        },
      ],
    ],
  });

  console.log("Network: Celo mainnet");
  console.log("User:", user.address);
  console.log("Relayer:", relayer.address);
  console.log("BatchExecutor:", batchExecutor);
  const previousDelegation = await getDelegation(publicClient, user.address);
  console.log("Delegation before:", previousDelegation ?? "none");

  const results = [];

  try {
    const delegationTx = await setDelegation({
      batchExecutor,
      executor: "self",
      publicClient,
      relayer,
      user,
      walletClient: userWallet,
    });
    console.log(`Set delegation: ok ${delegationTx.hash} ${delegationTx.status}`);
    console.log("Delegation set:", (await getDelegation(publicClient, user.address)) ?? "none");

    for (const test of [
      {
        executorLabel: "A:self",
        walletClient: userWallet,
      },
      {
        executorLabel: "B:relayer",
        walletClient: relayerWallet,
      },
    ]) {
      try {
        const result = await sendBatch({
          batchData,
          executorLabel: test.executorLabel,
          publicClient,
          user,
          walletClient: test.walletClient,
        });
        console.log(`${result.executor}: ok ${result.hash} ${result.status}`);
        results.push(result);
      } catch (error) {
        console.log(`${test.executorLabel}: failed ${formatError(error)}`);
        results.push({
          error: formatError(error),
          executor: test.executorLabel,
          status: "failed",
        });
      }
    }
  } finally {
    if (
      previousDelegation &&
      previousDelegation.toLowerCase() !== batchExecutor.toLowerCase()
    ) {
      try {
        const restoreTx = await setDelegation({
          batchExecutor: previousDelegation,
          executor: relayer,
          publicClient,
          relayer,
          user,
          walletClient: relayerWallet,
        });
        console.log(`Restore delegation: ok ${restoreTx.hash} ${restoreTx.status}`);
      } catch (error) {
        console.log(`Restore delegation: failed ${formatError(error)}`);
      }
    }
  }

  console.log("Delegation after:", (await getDelegation(publicClient, user.address)) ?? "none");
  console.log(JSON.stringify({ results }, null, 2));
}

main().catch((error) => {
  console.error(formatError(error));
  process.exit(1);
});
