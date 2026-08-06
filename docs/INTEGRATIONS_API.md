# COP By Integrations API

This API lets approved partners prepare COP By swaps for their own UI.
COP By does not custody funds and does not deposit into partner contracts. The user
signs the returned transaction from their own wallet and receives the output token
directly.

## Auth

Send the API key manually issued by COP By:

```http
Authorization: Bearer copby_live_pk_...secret...
```

## Prepare Swap

```http
POST /api/integrations/swaps/prepare
Authorization: Bearer copby_live_pk_...secret...
Content-Type: application/json
```

```json
{
  "userAddress": "0xUser",
  "fromToken": "USDT",
  "toToken": "COPm",
  "fromAmount": "1000000",
  "slippage": 0.3
}
```

Exit example:

```json
{
  "userAddress": "0xUser",
  "fromToken": "COPm",
  "toToken": "USDT",
  "fromAmount": "3000000000000000000000",
  "slippage": 0.3
}
```

Supported pairs:

```txt
USDT -> COPm
USDC -> COPm
USDm -> COPm
COPm -> USDT
```

`fromAmount` must use the token's onchain decimals. USDT and USDC use 6 decimals;
USDm and COPm use 18 decimals.

Response:

```json
{
  "intentId": "0x...",
  "expectedCopm": "3218000000000000000000",
  "expectedOutputAmount": "3218000000000000000000",
  "transaction": {
    "approvalTarget": "0x...",
    "from": "0xUser",
    "inputToken": {
      "address": "0x...",
      "decimals": 6,
      "symbol": "USDT"
    },
    "outputToken": {
      "address": "0x...",
      "decimals": 18,
      "symbol": "COPm"
    },
    "to": "0xSquidTarget",
    "data": "0x...",
    "value": "0"
  }
}
```

`expectedOutputAmount` is always returned. `expectedCopm` is returned only when
the output token is COPm for backwards compatibility.

If the user has not approved the selected input token for `approvalTarget`, the
partner UI must ask the user to approve that token before sending the swap
transaction.

## Confirm Swap

```http
POST /api/integrations/swaps/:intentId/confirm
Authorization: Bearer copby_live_pk_...secret...
Content-Type: application/json
```

```json
{
  "txHash": "0x..."
}
```

The endpoint validates that the transaction matches the prepared swap and that
the user received the expected output token. Confirmed swaps are stored in
`integration_swap_intents` and included in COP By analytics totals.
