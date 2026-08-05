# COP By Integrations API

This API lets approved partners prepare a `USDT -> COPm` swap for their own UI.
COP By does not custody funds and does not deposit into partner contracts. The user
signs the returned transaction from their own wallet and receives COPm directly.

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
  "fromAmount": "1000000",
  "slippage": 0.3
}
```

Response:

```json
{
  "intentId": "0x...",
  "expectedCopm": "3218000000000000000000",
  "transaction": {
    "approvalTarget": "0x...",
    "from": "0xUser",
    "to": "0xSquidTarget",
    "data": "0x...",
    "value": "0"
  }
}
```

If the user has not approved USDT for `approvalTarget`, the partner UI must ask
the user to approve USDT before sending the swap transaction.

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
the user received COPm. Confirmed swaps are stored in `integration_swap_intents`
and shown in analytics as integration volume.
