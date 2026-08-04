import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const COPM_MAINNET = "0x8A567e2aE79CA692Bd748aB832081C45de4041eA";
const USDT_MAINNET = "0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e";

const CopByAgentFxContractsModule = buildModule(
  "CopByAgentFxContractsModule",
  (m) => {
    const copm = m.getParameter(
      "copm",
      process.env.AGENT_REGISTRY_COPM_ADDRESS ?? COPM_MAINNET
    );
    const usdt = m.getParameter(
      "usdt",
      process.env.AGENT_REGISTRY_USDT_ADDRESS ?? USDT_MAINNET
    );

    const agentRegistry = m.contract("CopByAgentRegistry", [copm, usdt]);
    const fxExecutor = m.contract("CopByFXExecutor", [
      agentRegistry,
      copm,
      usdt,
    ]);

    return { agentRegistry, fxExecutor };
  }
);

export default CopByAgentFxContractsModule;
