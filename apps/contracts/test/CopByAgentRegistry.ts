import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { encodePacked, getAddress, keccak256, parseUnits } from "viem";

function id(value: string) {
  return keccak256(encodePacked(["string"], [value]));
}

describe("CopByAgentRegistry", function () {
  async function deployFixture() {
    const [user, agent, other] = await hre.viem.getWalletClients();
    const copm = await hre.viem.deployContract("MockERC20");
    const usdt = await hre.viem.deployContract("MockERC20");
    const registry = await hre.viem.deployContract("CopByAgentRegistry", [
      copm.address,
      usdt.address,
    ]);

    const expiresAt = BigInt((await time.latest()) + 24 * 60 * 60);
    const maxCopmTrade = parseUnits("100000", 18);
    const maxUsdtTrade = parseUnits("50", 6);
    const maxCopmVolume = parseUnits("300000", 18);
    const maxUsdtVolume = parseUnits("150", 6);

    return {
      agent,
      copm,
      expiresAt,
      maxCopmTrade,
      maxCopmVolume,
      maxUsdtTrade,
      maxUsdtVolume,
      other,
      registry,
      usdt,
      user,
    };
  }

  it("starts a public session with token-specific limits", async function () {
    const {
      agent,
      copm,
      expiresAt,
      maxCopmTrade,
      maxCopmVolume,
      maxUsdtTrade,
      maxUsdtVolume,
      registry,
      usdt,
      user,
    } = await deployFixture();

    await registry.write.startSession([
      user.account.address,
      agent.account.address,
      id("session-1"),
      expiresAt,
      maxCopmTrade,
      maxUsdtTrade,
      maxCopmVolume,
      maxUsdtVolume,
    ]);

    expect(
      await registry.read.isSessionActive([
        user.account.address,
        agent.account.address,
      ])
    ).to.equal(true);
    expect(await registry.read.copm()).to.equal(getAddress(copm.address));
    expect(await registry.read.usdt()).to.equal(getAddress(usdt.address));
  });

  it("rejects a second active session for the same user", async function () {
    const {
      agent,
      expiresAt,
      maxCopmTrade,
      maxCopmVolume,
      maxUsdtTrade,
      maxUsdtVolume,
      registry,
      user,
    } = await deployFixture();

    await registry.write.startSession([
      user.account.address,
      agent.account.address,
      id("session-1"),
      expiresAt,
      maxCopmTrade,
      maxUsdtTrade,
      maxCopmVolume,
      maxUsdtVolume,
    ]);

    await expect(
      registry.write.startSession([
        user.account.address,
        agent.account.address,
        id("session-2"),
        expiresAt,
        maxCopmTrade,
        maxUsdtTrade,
        maxCopmVolume,
        maxUsdtVolume,
      ])
    ).to.be.rejectedWith("ActiveSessionExists");
  });

  it("allows only the user or agent to revoke", async function () {
    const {
      agent,
      expiresAt,
      maxCopmTrade,
      maxCopmVolume,
      maxUsdtTrade,
      maxUsdtVolume,
      other,
      registry,
      user,
    } = await deployFixture();
    await registry.write.startSession([
      user.account.address,
      agent.account.address,
      id("session-1"),
      expiresAt,
      maxCopmTrade,
      maxUsdtTrade,
      maxCopmVolume,
      maxUsdtVolume,
    ]);

    const registryAsOther = await hre.viem.getContractAt(
      "CopByAgentRegistry",
      registry.address,
      { client: { wallet: other } }
    );
    await expect(
      registryAsOther.write.revokeSession([user.account.address])
    ).to.be.rejectedWith("NotSessionParty");

    const registryAsAgent = await hre.viem.getContractAt(
      "CopByAgentRegistry",
      registry.address,
      { client: { wallet: agent } }
    );
    await registryAsAgent.write.revokeSession([user.account.address]);

    expect(
      await registry.read.isSessionActive([
        user.account.address,
        agent.account.address,
      ])
    ).to.equal(false);
  });

  it("only lets the user wallet consume a trade", async function () {
    const {
      agent,
      expiresAt,
      maxCopmTrade,
      maxCopmVolume,
      maxUsdtTrade,
      maxUsdtVolume,
      registry,
      usdt,
      user,
    } = await deployFixture();
    const sessionId = id("session-1");

    await registry.write.startSession([
      user.account.address,
      agent.account.address,
      sessionId,
      expiresAt,
      maxCopmTrade,
      maxUsdtTrade,
      maxCopmVolume,
      maxUsdtVolume,
    ]);

    const registryAsAgent = await hre.viem.getContractAt(
      "CopByAgentRegistry",
      registry.address,
      { client: { wallet: agent } }
    );

    await expect(
      registryAsAgent.write.validateAndConsumeTrade([
        user.account.address,
        agent.account.address,
        sessionId,
        id("intent-1"),
        usdt.address,
        parseUnits("1", 6),
      ])
    ).to.be.rejectedWith("OnlyUserWallet");
  });

  it("rejects expired sessions and zero limits", async function () {
    const { agent, registry, user } = await deployFixture();

    await expect(
      registry.write.startSession([
        user.account.address,
        agent.account.address,
        id("expired-session"),
        BigInt(await time.latest()),
        1n,
        1n,
        1n,
        1n,
      ])
    ).to.be.rejectedWith("ExpiredSession");

    await expect(
      registry.write.startSession([
        user.account.address,
        agent.account.address,
        id("zero-limit"),
        BigInt((await time.latest()) + 1_000),
        0n,
        1n,
        1n,
        1n,
      ])
    ).to.be.rejectedWith("ZeroLimit");
  });
});
