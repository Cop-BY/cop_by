# COP By FX Agents API

This document explains how an external trading agent can connect to COP By to trade COPm/USDT on Celo mainnet.

The current MVP is designed for agents that use their own wallet to send transactions. COP By provides:

- Session creation and tracking.
- Squid Router quotes through the COP By backend.
- Prepared calldata for the delegated user wallet.
- Database tracking for prepared and confirmed trades.
- Onchain trade logging through `CopByAgentRegistry` and `CopByFXExecutor`.

## Scope

- Network: Celo mainnet only.
- Pair: COPm/USDT only.
- Directions:
  - `buy`: USDT -> COPm.
  - `sell`: COPm -> USDT.
- Session duration: 24 hours.
- Max trade size: 50 USD equivalent.
- Execution model: EIP-7702 delegated user wallet calls `CopByFXExecutor`.

## Environment

Required server env vars:

```bash
DATABASE_URL=
NEXT_PUBLIC_TARGET_NETWORK=celo
NEXT_PUBLIC_SQUID_INTEGRATOR_ID=
CELO_ATTRIBUTION_CODE=
AGENT_REGISTRY_ADDRESS=0xfa4721ad0Dfec2b4D3C2e3C219C11D1aC27C1809
AGENT_FX_EXECUTOR_ADDRESS=0x3f467db5E9Aa917F9496112820E73A1389563749
AGENT_RELAYER_PRIVATE_KEY=
```

`AGENT_RELAYER_PRIVATE_KEY` is used by the backend to write the session into `CopByAgentRegistry`.

`CELO_ATTRIBUTION_CODE` is optional. If empty, COP By derives the ERC-8021 attribution code from the request hostname.

## Contracts

Mainnet deployments:

```text
CopByAgentRegistry: 0xfa4721ad0Dfec2b4D3C2e3C219C11D1aC27C1809
CopByFXExecutor:    0x3f467db5E9Aa917F9496112820E73A1389563749
```

The registry stores the active agent session and consumes every trade intent. The executor approves the Squid transaction target for the exact input amount, calls the Squid calldata, resets approval to zero, validates output amount, and emits `AgentTradeExecuted`.

## Integration Flow

1. Start an agent session.
2. Agent signs the returned EIP-712 typed data.
3. Confirm the session with COP By backend.
4. Prepare each trade.
5. Agent sends the returned transaction.
6. Confirm the trade with the tx hash.

## 1. Start Session

Creates a pending 24 hour session and returns typed data to sign.

```http
POST /api/agent/session/start
```

Request:

```json
{
  "userAddress": "0xUserWallet",
  "agentAddress": "0xAgentWallet",
  "durationHours": 24
}
```

Response:

```json
{
  "domain": {
    "name": "COP By Agent Trading",
    "version": "1",
    "chainId": 42220,
    "verifyingContract": "0xfa4721ad0Dfec2b4D3C2e3C219C11D1aC27C1809"
  },
  "types": {
    "AgentTradingSession": [
      { "name": "sessionId", "type": "bytes32" },
      { "name": "user", "type": "address" },
      { "name": "agent", "type": "address" },
      { "name": "chainId", "type": "uint256" },
      { "name": "allowedPair", "type": "bytes32" },
      { "name": "maxTradeUsd", "type": "uint256" },
      { "name": "expiresAt", "type": "uint64" }
    ]
  },
  "primaryType": "AgentTradingSession",
  "message": {
    "sessionId": "0x...",
    "user": "0xUserWallet",
    "agent": "0xAgentWallet",
    "chainId": "42220",
    "allowedPair": "0x...",
    "maxTradeUsd": "50000000",
    "expiresAt": "..."
  },
  "session": {
    "session_id": "0x...",
    "status": "pending"
  }
}
```

Example:

```bash
curl -X POST "$COP_BY_BASE_URL/api/agent/session/start" \
  -H "content-type: application/json" \
  -d '{
    "userAddress": "0xUserWallet",
    "agentAddress": "0xAgentWallet",
    "durationHours": 24
  }'
```

## 2. Sign Session

The agent signs the EIP-712 typed data returned by `/session/start`.

Example with viem:

```ts
const signature = await walletClient.signTypedData({
  account: agentAccount,
  domain: response.domain,
  types: response.types,
  primaryType: response.primaryType,
  message: response.message,
});
```

Current MVP note: the signature is verified against `message.agent`.

## 3. Confirm Session

Confirms the signature, writes the session to `CopByAgentRegistry`, and marks the DB row as active.

```http
POST /api/agent/session/confirm
```

Request:

```json
{
  "sessionId": "0x...",
  "signature": "0x..."
}
```

Response:

```json
{
  "session": {
    "session_id": "0x...",
    "status": "active",
    "onchain_session_tx_hash": "0x..."
  }
}
```

Example:

```bash
curl -X POST "$COP_BY_BASE_URL/api/agent/session/confirm" \
  -H "content-type: application/json" \
  -d '{
    "sessionId": "0xSessionId",
    "signature": "0xSignature"
  }'
```

## 4. Prepare Trade

Gets a Squid quote and returns calldata that the agent should execute.

```http
POST /api/agent/trade/prepare
```

Request:

```json
{
  "sessionId": "0x...",
  "userAddress": "0xUserWallet",
  "agentAddress": "0xAgentWallet",
  "direction": "buy",
  "inputAmount": "1000000",
  "slippage": 0.3
}
```

`inputAmount` is atomic token units:

- `buy`: USDT amount with USDT decimals.
- `sell`: COPm amount with COPm decimals.

Response:

```json
{
  "intentId": "0x...",
  "route": {
    "requestId": "...",
    "quoteId": "...",
    "toAmount": "...",
    "minAmountOut": "..."
  },
  "transaction": {
    "from": "0xAgentWallet",
    "to": "0xUserWallet",
    "data": "0x...",
    "value": "0",
    "delegateTo": "0x3f467db5E9Aa917F9496112820E73A1389563749"
  },
  "trade": {
    "intent_id": "0x...",
    "status": "prepared"
  }
}
```

The transaction target is the user wallet because the user wallet must be delegated to `CopByFXExecutor` through EIP-7702. The returned `data` is encoded `CopByFXExecutor.executeTrade(...)` with the COP By ERC-8021 attribution suffix appended.

Example:

```bash
curl -X POST "$COP_BY_BASE_URL/api/agent/trade/prepare" \
  -H "content-type: application/json" \
  -d '{
    "sessionId": "0xSessionId",
    "userAddress": "0xUserWallet",
    "agentAddress": "0xAgentWallet",
    "direction": "buy",
    "inputAmount": "1000000",
    "slippage": 0.3
  }'
```

## 5. Execute Trade

The agent wallet sends the returned transaction on Celo mainnet.

The wallet must send:

```ts
await walletClient.sendTransaction({
  account: agentAccount,
  to: transaction.to,
  data: transaction.data,
  value: 0n,
  // The user EOA must already be delegated to transaction.delegateTo.
});
```

Do not rebuild or trim `transaction.data`. Send the calldata exactly as returned so the attribution suffix survives onchain.

Expected onchain behavior:

- `CopByFXExecutor` validates the active registry session.
- The registry consumes `intentId` so it cannot be reused.
- The executor calls Squid's route calldata.
- The trade reverts if the output is below `minAmountOut`.
- `AgentTradeExecuted` is emitted.

## 6. Confirm Trade

After the transaction is mined, send the tx hash to COP By.

```http
POST /api/agent/trade/:intentId/confirm
```

Request:

```json
{
  "txHash": "0x..."
}
```

Response:

```json
{
  "trade": {
    "intent_id": "0x...",
    "status": "confirmed",
    "trade_tx_hash": "0x...",
    "actual_output_amount": "..."
  }
}
```

The endpoint waits for the receipt, parses `AgentTradeExecuted`, validates that the event matches the prepared trade, and updates the DB.

Example:

```bash
curl -X POST "$COP_BY_BASE_URL/api/agent/trade/0xIntentId/confirm" \
  -H "content-type: application/json" \
  -d '{ "txHash": "0xTradeTxHash" }'
```

## Query Session

```http
GET /api/agent/session/:sessionId
```

Example:

```bash
curl "$COP_BY_BASE_URL/api/agent/session/0xSessionId"
```

## Revoke Session

Marks the session as revoked in COP By DB.

```http
POST /api/agent/session/:sessionId/revoke
```

Request:

```json
{
  "error": "optional reason",
  "onchainSessionTxHash": "0xOptionalTxHash"
}
```

Important: this endpoint currently updates DB state only. If the session must be revoked onchain, the caller must also execute `CopByAgentRegistry.revokeSession(user)`.

## Statuses

Session statuses:

- `pending`: typed data was created but not confirmed onchain.
- `active`: session exists in DB and was written to `CopByAgentRegistry`.
- `revoked`: session was manually revoked in DB.

Trade statuses:

- `prepared`: Squid quote was received and calldata was stored.
- `confirmed`: tx was mined and matched `AgentTradeExecuted`.
- `failed`: tx reverted during confirmation.

## Error Handling

Common errors:

- `Agent sessions are only enabled on Celo mainnet`: wrong network config.
- `User already has an active agent session`: user already has a pending or active 24h session.
- `Invalid agent session signature`: agent did not sign the expected typed data.
- `Agent session is not active onchain`: registry does not confirm the active session.
- `Trade exceeds session max amount`: trade exceeds the MVP limits.
- `Agent trades do not support native value routes`: Squid route requires native value and is rejected.
- `Transaction does not match prepared agent trade`: tx hash does not emit the expected `AgentTradeExecuted` event.

## MVP Limitations

- Only one active agent session per user.
- Only COPm/USDT trades are supported.
- The backend prepares a single Squid route per trade.
- The agent must handle wallet delegation and transaction submission.
- The revoke endpoint is DB-only until we wire onchain revocation into the API.
- No router allowlist is enforced in this MVP.
