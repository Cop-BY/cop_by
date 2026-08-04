import { expect } from "chai";
import hre from "hardhat";
import { encodeFunctionData, zeroAddress } from "viem";

describe("BatchExecutor", function () {
  it("reverts when called directly", async function () {
    const executor = await hre.viem.deployContract("BatchExecutor");

    await expect(
      executor.write.execute([
        [
          {
            data: "0x",
            target: zeroAddress,
            value: 0n,
          },
        ],
      ])
    ).to.be.rejectedWith("OnlySelfDelegated");
  });

  it("encodes execute calldata for delegated EOA transactions", async function () {
    const executor = await hre.viem.deployContract("BatchExecutor");

    const calldata = encodeFunctionData({
      abi: executor.abi,
      functionName: "execute",
      args: [
        [
          {
            data: "0x1234",
            target: executor.address,
            value: 0n,
          },
        ],
      ],
    });

    expect(calldata).to.match(/^0x[0-9a-f]+$/);
    expect(calldata.length).to.be.greaterThan(10);
  });
});
