import { createBridgeClient, type BridgeClient } from "./bridge-client";
import { createDefaultCopmQuoter, type CopmQuoter } from "./copm-quote";
import { createMemoryBrebStore } from "./memory-store";
import { createNeonBrebStore } from "./neon-store";
import type { BrebStore } from "./store";

export type BrebContext = {
  bridge: BridgeClient;
  copmQuoter: CopmQuoter;
  now?: () => Date;
  store: BrebStore;
};

let cached: BrebContext | null = null;

export function createBrebContext(overrides: Partial<BrebContext> = {}): BrebContext {
  const store =
    overrides.store ??
    (process.env.DATABASE_URL ? createNeonBrebStore() : createMemoryBrebStore());
  return {
    bridge: overrides.bridge ?? createBridgeClient(),
    copmQuoter: overrides.copmQuoter ?? createDefaultCopmQuoter(),
    now: overrides.now,
    store,
  };
}

export function getBrebContext() {
  cached ??= createBrebContext();
  return cached;
}

export function resetBrebContext() {
  cached = null;
}
