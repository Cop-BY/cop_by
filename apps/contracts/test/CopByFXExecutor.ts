import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { encodeFunctionData, encodePacked, keccak256, parseUnits } from "viem";

function id(value: string) {
  return keccak256(encodePacked(["string"], [value]));
}

describe("CopByFXExecutor", function () {
  async function deployFixture() {
    const [deployer, agent, other, thief] = await hre.viem.getWalletClients();
    const copm = await hre.viem.deployContract("MockERC20");
    const usdt = await hre.viem.deployContract("MockERC20");
    const router = await hre.viem.deployContract("MockFXRouter");
    const otherRouter = await hre.viem.deployContract("MockFXRouter");
    const wallet = await hre.viem.deployContract("MockDelegatedWallet");
    const registry = await hre.viem.deployContract("CopByAgentRegistry", [
      copm.address,
      usdt.address,
    ]);
    const executor = await hre.viem.deployContract("CopByFXExecutor", [
      registry.address,
      copm.address,
      usdt.address,
    ]);

    const sessionId = id("session-1");
    const expiresAt = BigInt((await time.latest()) + 24 * 60 * 60);
    await registry.write.startSession([
      wallet.address,
      agent.account.address,
      sessionId,
      expiresAt,
      parseUnits("100000", 18),
      parseUnits("50", 6),
      parseUnits("200000", 18),
      parseUnits("100", 6),
    ]);

    await copm.write.mint([wallet.address, parseUnits("150000", 18)]);
    await usdt.write.mint([wallet.address, parseUnits("200", 6)]);
    await copm.write.mint([router.address, parseUnits("500000", 18)]);
    await usdt.write.mint([router.address, parseUnits("500", 6)]);
    await copm.write.mint([otherRouter.address, parseUnits("500000", 18)]);
    await usdt.write.mint([otherRouter.address, parseUnits("500", 6)]);

    const walletAsAgent = await hre.viem.getContractAt(
      "MockDelegatedWallet",
      wallet.address,
      { client: { wallet: agent } }
    );
    const walletAsOther = await hre.viem.getContractAt(
      "MockDelegatedWallet",
      wallet.address,
      { client: { wallet: other } }
    );

    return {
      agent,
      copm,
      deployer,
      executor,
      other,
      otherRouter,
      registry,
      router,
      sessionId,
      thief,
      usdt,
      wallet,
      walletAsAgent,
      walletAsOther,
    };
  }

  function routerSwapData({
    amountIn,
    amountOut,
    recipient,
    router,
    tokenIn,
    tokenOut,
  }: {
    amountIn: bigint;
    amountOut: bigint;
    recipient: `0x${string}`;
    router: { abi: any };
    tokenIn: `0x${string}`;
    tokenOut: `0x${string}`;
  }) {
    return encodeFunctionData({
      abi: router.abi,
      functionName: "swap",
      args: [tokenIn, tokenOut, amountIn, amountOut, recipient],
    });
  }

  function tradeData({
    amountIn,
    deadline,
    executor,
    intent,
    minAmountOut,
    sessionId,
    swapData,
    swapTarget,
    tokenIn,
  }: {
    amountIn: bigint;
    deadline: bigint;
    executor: { abi: any };
    intent: string;
    minAmountOut: bigint;
    sessionId: `0x${string}`;
    swapData: `0x${string}`;
    swapTarget: `0x${string}`;
    tokenIn: `0x${string}`;
  }) {
    return encodeFunctionData({
      abi: executor.abi,
      functionName: "executeTrade",
      args: [
        sessionId,
        id(intent),
        tokenIn,
        amountIn,
        minAmountOut,
        swapTarget,
        swapData,
        deadline,
      ],
    });
  }

  it("lets the authorized agent trade USDT to COPm through delegated wallet context", async function () {
    const { copm, executor, router, sessionId, usdt, wallet, walletAsAgent } =
      await deployFixture();
    const amountIn = parseUnits("10", 6);
    const amountOut = parseUnits("34000", 18);
    const deadline = BigInt((await time.latest()) + 300);

    const data = tradeData({
      amountIn,
      deadline,
      executor,
      intent: "buy-1",
      minAmountOut: amountOut,
      sessionId,
      swapData: routerSwapData({
        amountIn,
        amountOut,
        recipient: wallet.address,
        router,
        tokenIn: usdt.address,
        tokenOut: copm.address,
      }),
      swapTarget: router.address,
      tokenIn: usdt.address,
    });

    await walletAsAgent.write.execute([executor.address, data]);

    expect(await usdt.read.balanceOf([wallet.address])).to.equal(parseUnits("190", 6));
    expect(await copm.read.balanceOf([wallet.address])).to.equal(
      parseUnits("184000", 18)
    );
  });

  it("lets the authorized agent trade COPm to USDT", async function () {
    const { copm, executor, registry, router, sessionId, usdt, wallet, walletAsAgent } =
      await deployFixture();
    const amountIn = parseUnits("50000", 18);
    const amountOut = parseUnits("15", 6);
    const deadline = BigInt((await time.latest()) + 300);

    await walletAsAgent.write.execute([
      executor.address,
      tradeData({
        amountIn,
        deadline,
        executor,
        intent: "sell-1",
        minAmountOut: amountOut,
        sessionId,
        swapData: routerSwapData({
          amountIn,
          amountOut,
          recipient: wallet.address,
          router,
          tokenIn: copm.address,
          tokenOut: usdt.address,
        }),
        swapTarget: router.address,
        tokenIn: copm.address,
      }),
    ]);

    expect(await copm.read.balanceOf([wallet.address])).to.equal(
      parseUnits("100000", 18)
    );
    expect(await usdt.read.balanceOf([wallet.address])).to.equal(parseUnits("215", 6));
    expect(await registry.read.totalTrades()).to.equal(1n);
  });

  it("rejects unauthorized agents, expired sessions, and revoked sessions", async function () {
    const {
      agent,
      copm,
      executor,
      registry,
      router,
      sessionId,
      usdt,
      wallet,
      walletAsAgent,
      walletAsOther,
    } = await deployFixture();
    const amountIn = parseUnits("1", 6);
    const amountOut = parseUnits("3400", 18);
    const deadline = BigInt((await time.latest()) + 300);
    const data = tradeData({
      amountIn,
      deadline,
      executor,
      intent: "auth-1",
      minAmountOut: amountOut,
      sessionId,
      swapData: routerSwapData({
        amountIn,
        amountOut,
        recipient: wallet.address,
        router,
        tokenIn: usdt.address,
        tokenOut: copm.address,
      }),
      swapTarget: router.address,
      tokenIn: usdt.address,
    });

    await expect(walletAsOther.write.execute([executor.address, data])).to.be.rejectedWith(
      "InvalidAgent"
    );

    const registryAsAgent = await hre.viem.getContractAt(
      "CopByAgentRegistry",
      registry.address,
      { client: { wallet: agent } }
    );
    await registryAsAgent.write.revokeSession([wallet.address]);
    await expect(walletAsAgent.write.execute([executor.address, data])).to.be.rejectedWith(
      "InvalidSession"
    );
  });

  it("enforces trade limit, session volume, and unique intents", async function () {
    const { copm, executor, registry, router, sessionId, usdt, wallet, walletAsAgent } =
      await deployFixture();
    const deadline = BigInt((await time.latest()) + 300);

    const tooLarge = parseUnits("51", 6);
    await expect(
      walletAsAgent.write.execute([
        executor.address,
        tradeData({
          amountIn: tooLarge,
          deadline,
          executor,
          intent: "too-large",
          minAmountOut: 1n,
          sessionId,
          swapData: routerSwapData({
            amountIn: tooLarge,
            amountOut: parseUnits("170000", 18),
            recipient: wallet.address,
            router,
            tokenIn: usdt.address,
            tokenOut: copm.address,
          }),
          swapTarget: router.address,
          tokenIn: usdt.address,
        }),
      ])
    ).to.be.rejectedWith("TradeAmountExceeded");

    const amountIn = parseUnits("50", 6);
    const amountOut = parseUnits("170000", 18);
    const firstTrade = tradeData({
      amountIn,
      deadline,
      executor,
      intent: "limit-1",
      minAmountOut: amountOut,
      sessionId,
      swapData: routerSwapData({
        amountIn,
        amountOut,
        recipient: wallet.address,
        router,
        tokenIn: usdt.address,
        tokenOut: copm.address,
      }),
      swapTarget: router.address,
      tokenIn: usdt.address,
    });
    await walletAsAgent.write.execute([executor.address, firstTrade]);

    await expect(walletAsAgent.write.execute([executor.address, firstTrade])).to.be.rejectedWith(
      "IntentAlreadyUsed"
    );

    const secondTrade = tradeData({
      amountIn,
      deadline,
      executor,
      intent: "limit-2",
      minAmountOut: amountOut,
      sessionId,
      swapData: routerSwapData({
        amountIn,
        amountOut,
        recipient: wallet.address,
        router,
        tokenIn: usdt.address,
        tokenOut: copm.address,
      }),
      swapTarget: router.address,
      tokenIn: usdt.address,
    });
    await walletAsAgent.write.execute([executor.address, secondTrade]);

    await expect(
      walletAsAgent.write.execute([
        executor.address,
        tradeData({
          amountIn: parseUnits("1", 6),
          deadline,
          executor,
          intent: "volume-3",
          minAmountOut: 1n,
          sessionId,
          swapData: routerSwapData({
            amountIn: parseUnits("1", 6),
            amountOut: parseUnits("3400", 18),
            recipient: wallet.address,
            router,
            tokenIn: usdt.address,
            tokenOut: copm.address,
          }),
          swapTarget: router.address,
          tokenIn: usdt.address,
        }),
      ])
    ).to.be.rejectedWith("SessionVolumeExceeded");

    const session = await registry.read.sessions([wallet.address]);
    expect(session[8]).to.equal(amountIn * 2n);
  });

  it("accepts any swap target that satisfies balance checks", async function () {
    const {
      copm,
      executor,
      otherRouter,
      sessionId,
      usdt,
      wallet,
      walletAsAgent,
    } = await deployFixture();
    const amountIn = parseUnits("1", 6);
    const amountOut = parseUnits("3400", 18);
    const deadline = BigInt((await time.latest()) + 300);

    await walletAsAgent.write.execute([
      executor.address,
      tradeData({
        amountIn,
        deadline,
        executor,
        intent: "any-router",
        minAmountOut: amountOut,
        sessionId,
        swapData: routerSwapData({
          amountIn,
          amountOut,
          recipient: wallet.address,
          router: otherRouter,
          tokenIn: usdt.address,
          tokenOut: copm.address,
        }),
        swapTarget: otherRouter.address,
        tokenIn: usdt.address,
      }),
    ]);

    expect(await usdt.read.balanceOf([wallet.address])).to.equal(parseUnits("199", 6));
    expect(await copm.read.balanceOf([wallet.address])).to.equal(
      parseUnits("153400", 18)
    );
  });

  it("rejects zero swap target, malicious recipient, low output, and expired deadline", async function () {
    const {
      copm,
      executor,
      router,
      sessionId,
      thief,
      usdt,
      wallet,
      walletAsAgent,
    } = await deployFixture();
    const amountIn = parseUnits("1", 6);
    const amountOut = parseUnits("3400", 18);
    const deadline = BigInt((await time.latest()) + 300);

    await expect(
      walletAsAgent.write.execute([
        executor.address,
        tradeData({
          amountIn,
          deadline,
          executor,
          intent: "zero-router",
          minAmountOut: amountOut,
          sessionId,
          swapData: "0x",
          swapTarget: "0x0000000000000000000000000000000000000000",
          tokenIn: usdt.address,
        }),
      ])
    ).to.be.rejectedWith("ZeroAddress");

    await expect(
      walletAsAgent.write.execute([
        executor.address,
        tradeData({
          amountIn,
          deadline,
          executor,
          intent: "bad-recipient",
          minAmountOut: amountOut,
          sessionId,
          swapData: routerSwapData({
            amountIn,
            amountOut,
            recipient: thief.account.address,
            router,
            tokenIn: usdt.address,
            tokenOut: copm.address,
          }),
          swapTarget: router.address,
          tokenIn: usdt.address,
        }),
      ])
    ).to.be.rejectedWith("SlippageExceeded");

    await expect(
      walletAsAgent.write.execute([
        executor.address,
        tradeData({
          amountIn,
          deadline,
          executor,
          intent: "low-output",
          minAmountOut: amountOut + 1n,
          sessionId,
          swapData: routerSwapData({
            amountIn,
            amountOut,
            recipient: wallet.address,
            router,
            tokenIn: usdt.address,
            tokenOut: copm.address,
          }),
          swapTarget: router.address,
          tokenIn: usdt.address,
        }),
      ])
    ).to.be.rejectedWith("SlippageExceeded");

    await expect(
      walletAsAgent.write.execute([
        executor.address,
        tradeData({
          amountIn,
          deadline: BigInt(await time.latest()) - 1n,
          executor,
          intent: "expired-deadline",
          minAmountOut: amountOut,
          sessionId,
          swapData: routerSwapData({
            amountIn,
            amountOut,
            recipient: wallet.address,
            router,
            tokenIn: usdt.address,
            tokenOut: copm.address,
          }),
          swapTarget: router.address,
          tokenIn: usdt.address,
        }),
      ])
    ).to.be.rejectedWith("DeadlineExpired");
  });

  it("does not consume volume when the swap reverts", async function () {
    const { executor, registry, router, sessionId, usdt, wallet, walletAsAgent } =
      await deployFixture();
    const amountIn = parseUnits("1", 6);
    const deadline = BigInt((await time.latest()) + 300);
    const swapData = encodeFunctionData({
      abi: router.abi,
      functionName: "fail",
    });

    await expect(
      walletAsAgent.write.execute([
        executor.address,
        tradeData({
          amountIn,
          deadline,
          executor,
          intent: "router-fails",
          minAmountOut: 1n,
          sessionId,
          swapData,
          swapTarget: router.address,
          tokenIn: usdt.address,
        }),
      ])
    ).to.be.rejectedWith("mock swap failed");

    const session = await registry.read.sessions([wallet.address]);
    expect(session[8]).to.equal(0n);
    expect(await registry.read.usedIntents([id("router-fails")])).to.equal(false);
  });
});
