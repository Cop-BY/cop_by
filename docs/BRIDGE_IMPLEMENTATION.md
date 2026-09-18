# Plan de implementación — BRE-B con Bridge

> **Objetivo:** un servicio de backend de COP By que convierte USDC o COPm en Celo a COP fiat vía Bridge (Bre-B). Lo consume la miniapp y otras apps.  
> **Estado:** Slice 1–2 listos (mock API + aliases MiniPay + tab Gastar). Siguiente: Slice 3 sandbox Bridge real.
> **Fecha:** septiembre 2026  
> **Docs:** [COP integration](https://apidocs.bridge.xyz/get-started/guides/move-money/cop_integration_guide) · [Transfers](https://apidocs.bridge.xyz/api-reference/transfers/create-a-transfer) · [Fixed outputs](https://apidocs.bridge.xyz/get-started/guides/move-money/fixed_outputs_integration_guide) · [Integrations API](./INTEGRATIONS_API.md)

---

## 1. Qué cubre y qué no

**Done cuando:** cualquier app autorizada pide un monto en COP, el backend devuelve una cotización efectiva (`1 USD = 3000 COP` ya con fees), el usuario (KYC de Bridge) firma COPm o USDC, Bridge paga COP, y COP By **reconcilia** que el depósito y cada fee llegaron a su receptor.

| En alcance (MVP) | Fuera (post-MVP) |
| --- | --- |
| API de backend reutilizable (miniapp + partners) | QR de comercio |
| Source **USDC o COPm** en Celo | Recibir COP P2P (3rd-party individuals no permitidos) |
| Cotización final cacheada (4–6 h) | Cards Visa / recargas |
| Fallback Uniswap V3 si Squid no cotiza | Wallets custodiales Bridge (Celo no soportado) |
| KYC = hosted Bridge (Persona), igual para todas las apps | KYC propio de COP By |
| Conciliación depósito Bridge + fees a wallets | — |
| Pagar a un destino COP conocido: **llave + nombre**, verify Bridge, luego payout | Lookup solo-llave; checkout ecommerce / catálogo / Cards Visa desde Celo |
| Buffer FX = padding de Bridge (~1%); sobrante no se reembolsa | Reembolso payout-a-payout del leftover USDC |
| Portal partner: Clerk Organizations, keys, reporting (Slice 4) | White-label del dashboard / impersonación avanzada |

Orchestration de Bridge **no** es un PSP de comercio ni un pagador de servicios. Es rieles. El MVP reutiliza esos rieles; ver §15.

**Fee COP By: 1% (100 bps)** onchain a `COPBY_FEE_WALLET` (`COPBY_FEE_BPS=100`) **más** **0,5%** `developer_fee` de Bridge (`BRIDGE_DEVELOPER_FEE_PERCENT=0.5`). Base: notional USDC del payout (`netUsdcToBridge`). El padding FX de Bridge (~1%) es otra cosa: cubre la tasa, no es take-rate.

**Mínimo (COP By):** `destinationCop ≥ 4000` **y** USDC a Bridge ≥ **2** (cubre el 1 USDC de routes + el 0,5% developer_fee). El que ate más gana. Quote/payout bajo eso → `400 below_minimum`.

Bridge lo publica así:

- [Guía COP](https://apidocs.bridge.xyz/get-started/guides/move-money/cop_integration_guide): onramp **100 COP**, offramp **4000 COP**. Sin máximo (Bre-B > 11.552.000 COP sale como bank transfer).
- [Payment routes](https://apidocs.bridge.xyz/get-started/introduction/what-we-support/payment-routes): `USDC@Celo` → `Bre-B & Bank Transfer` COP, min **1 USDC** (en moneda source).
- [Transaction minimums](https://apidocs.bridge.xyz/platform/orchestration/fees-and-mins/mins.md): el mínimo se aplica **después** de developer fees. Por debajo, dust: puede no acreditarse ni devolverse.

Env: `BREB_MIN_COP=4000`, `BREB_MIN_USDC=2`. El 1% COP By va a `COPBY_FEE_WALLET` y no cuenta para el mínimo de Bridge; el 0,5% sí.

---

## 2. El producto es un servicio, no un tab

Misma idea que [INTEGRATIONS_API.md](./INTEGRATIONS_API.md): COP By **no custodia**. El backend prepara, cotiza y reconcilia. El usuario firma desde su wallet (MiniPay u otra app).

```
Otras apps ─┐
            ├─►  COP By backend  ─►  Squid / Uniswap V3 (si COPm)
Miniapp ────┘         │              Bridge (KYC + Transfer COP)
                      │
                      ▼
              Neon: quotes, payouts, fee legs
```

- Auth de partners: `Authorization: Bearer copby_live_pk_...` (`requireIntegrationApiKey`).
- Miniapp: primer consumidor, con integration id first-party (`copby`). El browser **nunca** ve `BRIDGE_API_KEY`.
- Dominio compartido: `lib/breb/` (quote, payout, kyc, reconcile). Las rutas HTTP son delgadas.

Rutas canónicas:

```txt
/api/integrations/breb/quote
/api/integrations/breb/kyc
/api/integrations/breb/payouts
/api/integrations/breb/payouts/:id/confirm
POST /api/breb/webhook          ← solo Bridge; no usa API key de partner
```

La miniapp llama aliases `/api/breb/*` (sin Bearer; `integration_id=copby`; `userAddress` obligatorio en list/get/confirm). Partners usan `/api/integrations/breb/*` con key. Ambas delegan a `lib/breb/`. En mock, `POST .../kyc/otp/send` devuelve `debugCode` (`123456` o `BREB_MOCK_OTP`).

Auth **sí** está pensado: reutilizar `requireIntegrationApiKey` y `integration_id` en cada payout. El producto final de plataforma (keys por dashboard/API, soporte interno, y que el integrador consulte sus txs/volumen/fees) está en §16.

---

---

## 3. Flujo de dinero

Bridge solo acepta **USDC** en Celo. COPm se convierte onchain **antes** de llegar a Bridge.

```
Usuario elige: ¿cuántos COP? + llave BRE-B + nombre del titular + asset (USDC | COPm)
        │
        ▼
GET quote (cache 4–6 h para FX; swap fresco o Uniswap fallback)
        │  KYC Bridge si falta (link Persona; igual en miniapp o partner)
        ▼
Crear External Account + POST verify → poll hasta completed_at
        │  matched ≠ true → no payout (409 destination_mismatch)
        │  matched → preview banco / last4; el usuario confirma
        ▼
POST payout → Bridge Transfer (fixed COP) + legs de fee
        │
        ├─ source USDC:  transfer USDC → deposit Bridge (+ fee COP By si aplica)
        └─ source COPm:  Squid (prefer Uniswap V3) o swap Uniswap V3
                         COPm → USDC, output a deposit Bridge
        ▼
confirm(txHash) verifica onchain
        ▼
Webhook Bridge: funds_received → payment_processed
        ▼
Reconcile: depósito Bridge OK + cada fee en su wallet
```

**Rechazado:** mandar COPm a Bridge; wallet custodial Celo; KYC de COP By; cotizar Squid en el browser.

---

## 4. Cotización final

Un endpoint para el usuario y para partners. Ejemplo de lectura:

```txt
1 USD = 3000 COP
```

Esa tasa **ya incluye** swap (si COPm), FX de Bridge, fees de Bridge y fee de COP By. No es el mid-market de Bridge a pelo.

### `GET /api/integrations/breb/quote`

```http
GET /api/integrations/breb/quote?destinationCop=50000&fromToken=COPm
Authorization: Bearer copby_live_pk_...
```

`fromToken`: `USDC` | `COPm`. `destinationCop` opcional; si falta, solo se devuelve la tasa efectiva. Si viene y es `< 4000` COP, o el USDC a Bridge es `< 2`, → `400 below_minimum`.

```json
{
  "quoteId": "q_…",
  "fromToken": "COPm",
  "destinationCop": "50000",
  "effectiveUsdCop": "3000",
  "display": "1 USD = 3000 COP",
  "sourceAmount": "17500000000000000000",
  "sourceAmountUsd": "16.67",
  "netUsdcToBridge": "16.40",
  "swapProvider": "squid",
  "fees": [
    { "code": "swap", "amountUsd": "0.12", "to": null, "status": "quoted" },
    { "code": "bridge_fx", "amountUsd": "0.08", "to": null, "status": "quoted" },
    { "code": "bridge", "amountUsd": "0.08", "to": null, "status": "quoted" },
    { "code": "copby", "amountUsd": "0.16", "to": "0xCopByFeeWallet", "status": "quoted" }
  ],
  "expiresAt": "2026-09-17T22:00:00.000Z",
  "cached": true
}
```

`sourceAmount` en unidades atómicas del token (COPm 18, USDC 6), igual que Integrations swaps.

`copby` = 100 bps de `netUsdcToBridge` (onchain). `bridge` / `developer_fee` = 50 bps que cobra Bridge en el Transfer.

Bridge no lockea FX. Un cache de 4–6 h implica **padding** en la tasa efectiva para que el payout no quede corto si el mercado se mueve. Al crear el payout se usa la tasa cacheada + buffer; si el buffer no alcanza, se rechaza y se pide recotizar.

### Buffer FX (Fase 1): no reembolsar leftover

Decisión: **pedir de más, no devolver**.

- Transfer de **salida fija** (`destination.amount` en COP). Bridge ya calcula el USDC y le pone **~1% de padding**. Eso es el buffer U2, no un segundo % nuestro encima del slippage del DEX.
- El usuario firma el `sourceAmount` cotizado (USDC o COPm equivalente). Si el DEX da más USDC y el output cae en el depósito Bridge, o si el peso se mueve a favor, el extra **no vuelve a MiniPay**.
- Bridge lo acredita a la *Fixed Outputs Excess Funds wallet* de COP By como `developer_exchange_fee`. Ese pool es nuestro (fee + colchón). No es saldo del usuario y no se reembolsa payout a payout.
- Slippage del swap (COPm→USDC, `minOut`) y buffer FX se aplican **aparte**. No sumar 1% Bridge + 1.5% COP By + 1% DEX. Topear el stack; si el mercado está quieto, no inflar.
- Copy de cotización: la tasa efectiva ya incluye buffer FX; el restante no se reembolsa.
- Dust de un swap cuyo destino es la **wallet del user** sí se queda ahí. Eso no es un refund nuestro.
- Post-MVP (fuera de alcance): job de rebate USDC si el leftover supera un umbral. En v1 no: opera custodia, race con `underfunded`, y gas > dust.

### `underfunded` (Fase 1): segundo depósito del user, no perder principal

Regla: **no se pierden fondos del usuario.** El Transfer no se completa en silencio con Excess Funds. El user hace un segundo paso: depositar el faltante `X` en USDC o COPm.

1. Webhook `underfunded` + `additional_funding_instructions.amount`.
2. Payout → `awaiting_topup`. API/UI: “faltan X USDC” (si `fromToken=COPm`, cotizar el COPm equivalente fresco, `minOut` = X).
3. El user firma un segundo envío al mismo Transfer (`destination.payment_rail: bridge_transfer`, mismo `on_behalf_of`). `confirm` del top-up: txHash distinto, no reutilizar el del depósito 1 (U5).
4. Excess Funds: COP By **puede** usarlo para dust / hueco residual después del top-up del user (para no entrar en un loop de `underfunded` por 0,02 USDC). No se usa para cerrar el payout entero sin ese segundo paso.
5. Si el user no deposita: timeout → cancelar / return de Bridge a `userAddress` (`return_instructions`). El USDC original vuelve. No nos lo quedamos. Copy: “tu dinero vuelve a la wallet; el COP no salió”.

`deposit_short` (U3, swap corto) usa el mismo segundo paso: el faltante es `netUsdcToBridge − recibido`.

### Return de crypto: al sender (`userAddress`)

Intención: **refund to sender**. Si el depósito falla, se cancela, o el user no completa el top-up, el USDC vuelve a la wallet que pagó (MiniPay / `userAddress`).

Bridge desaconseja la política **global** `crypto_return_policy.strategy = refund_to_sender` porque muchos mandan desde exchanges (omnibus): el refund se pierde en el pool del exchange. MiniPay no es eso: la `0x` es del user y no se exporta.

Cómo lo implementamos:

- En **cada** Transfer: `return_instructions.return_address = userAddress`, rail Celo, USDC. Bridge usa esto **antes** de la política global.
- No configuramos `refund_to_sender` a nivel developer.
- No devolvemos a una address estática de COP By (eso sí sería custodia del refund).
- Partners: el `from_address` tiene que ser la wallet del user, no Binance/Coinbase. Misma regla que no usar `allow_any_from_address` en MiniPay.

El leftover de un payout **completado** (padding FX) no entra aquí: eso sigue en Excess Funds.

---

## 5. Cache (evitar llamadas de más)

| Dato | TTL | Fuente | Por qué |
| --- | --- | --- | --- |
| Tasa efectiva USD→COP (display + quote) | **4–6 h** (`BREB_FX_TTL_HOURS`, default 6) | Bridge Exchange Rates + fee stack COP By | El usuario no necesita tick a tick; Bridge actualiza ~30 s |
| Customer / KYC / endorsement | Hasta webhook `customer.*` | Bridge + `bridge_customers` | No reconsultar Persona en cada tap |
| External account por llave BRE-B | Hasta que el usuario la borre | `bridge_external_accounts` | Create-once en Bridge |
| Ruta Squid COPm→USDC | **No** cachear 4–6 h para ejecutar | Squid | Las rutas AMM caducan en minutos |
| Precio COPm/USDC Uniswap V3 (slot0 / TWAP) | 4–6 h para **display**; fresco al preparar tx | Pool onchain | Fallback cuando Squid está caído o es fin de semana |

Tabla `breb_quote_cache`:

| Columna | Notas |
| --- | --- |
| `cache_key` | p.ej. `usd_cop_effective` / `copm_usdc_uni_v3` |
| `payload` JSONB | tasa, componentes de fee, provider |
| `fetched_at` / `expires_at` | |
| `source` | `bridge` / `uniswap_v3` / `squid` |

Job: un refresh al expirar (o al primer miss). No polling a Bridge por request de UI.

Al **prepare payout**, si `fromToken=COPm`, se pide ruta Squid **en ese momento** (con `prefer: ["Uniswap V3"]`). Si Squid falla (liquidez, weekend, 5xx), fallback al quoter Uniswap V3 onchain y se arma el swap directo al pool. El `effectiveUsdCop` de display puede seguir viniendo del cache de 4–6 h.

---

## 6. Fallback Uniswap V3

Hoy Squid ya se llama con `prefer: ["Uniswap V3"]` (`lib/squid-config.ts`). Eso **no basta**: si Squid no responde, no hay cotización.

Orden para COPm→USDC:

1. Squid `prefer: ["Uniswap V3"]`
2. Squid sin prefer (mismo patrón que `getSquidCopmRoute`)
3. **Quoter Uniswap V3 onchain** (nuevo `lib/uniswap-v3-quote.ts`) contra el pool COPm/USDC en Celo
4. Si 1–3 fallan: error explícito “mercado de pesos cerrado”; no inventar tasa

El fallback 3 sirve para **quote y para ejecutar** (swap router V3), no solo para pintar un número. Configurar `UNISWAP_V3_COPM_USDC_POOL` + `UNISWAP_V3_SWAP_ROUTER` en env. Hay que fijar el pool en Celo mainnet antes de Slice 1.

---

## 7. KYC = Bridge, para todas las apps

COP By no corre KYC. Devuelve los links hosted de Bridge (`kyc_link`, `tos_link`, endorsement `cop`). Da igual MiniPay u otra app: el usuario completa Persona en Bridge.

`POST /api/integrations/breb/kyc`

```json
{
  "userAddress": "0xUser",
  "fullName": "Ana Pérez",
  "email": "ana@correo.com",
  "redirectUri": "https://partner.app/kyc-done"
}
```

`fullName` y `email` son **obligatorios** (Bridge: `email` + `type`; el guide también manda `full_name`). MiniPay no da email: lo pedimos en el form, igual que cualquier partner. No inventar `user@minipay.local`.

- Si esa `userAddress` ya tiene customer aprobado + `cop`: `{ status: "approved" }`.
- Si no: `{ status: "needs_otp" }` hasta el código. Tras OTP: email con KYC válido → ligar address (`approved`); si no → `kycLink` + `tosLink`.
- Webhooks `customer.*` actualizan `bridge_customers` (email normalizado + hash; no loguear PII completa).
- `POST payout` con KYC incompleto → `409 needs_kyc` + los mismos links.

### OTP del email

COP By manda un **código** (no magic link: en MiniPay el link se abre fuera del WebView). Igual para partners.

```txt
POST /api/integrations/breb/kyc/otp/send     { userAddress, email }
POST /api/integrations/breb/kyc/otp/verify   { userAddress, email, code }
```

- TTL corto, rate limit, un código a la vez.
- OTP **siempre** antes de crear el KYC link o de ligar una `0x` nueva. El email que llega a Bridge ya está verificado.
- Hasta `verify` no se revela si ese correo ya tenía KYC.
- Primera vez y MetaMask con el mismo correo: mismo flujo; tras OTP, o Persona o `approved`.

### `redirect_uri`

Persona al terminar manda a un `http(s)`. Cada cliente pasa el suyo:

| Cliente | `redirectUri` |
| --- | --- |
| Miniapp COP By | `https://<nuestro-origen>/breb/kyc-done` (cierra el loop del WebView MiniPay; poll `GET kyc` / webhook) |
| Partner | URL `https` **suya** (allowlist por `integration_id`). Si falta, fallback a una página hosted de COP By: “ya puedes volver a la app”. |

No iframe de Persona en Fase 1: abrir `kyc_link` + `tos_link` (WebView o browser). MiniPay necesita `allow="camera"` si más adelante se embebe.

El partner abre el link; COP By no embebe un KYC distinto.

### Identidad: customer por address **y** email verificado

El KYC de Bridge vive en el **customer** (`on_behalf_of`). El `from_address` es por Transfer: un customer aprobado puede fondear desde otra `0x`. MiniPay no exporta la wallet, así que MiniPay y MetaMask son addresses distintas de la misma persona.

COP By pide email en todas las apps. Lookup:

1. `userAddress` ya mapeada → ese customer.
2. Si no → OTP al email. Si hay customer `approved` + `cop` → ligar la address. Payout con `from_address` = esta wallet. Sin segundo Persona.
3. Email nuevo (OTP ok) → KYC link (nombre + email + `cop`).
4. Sin OTP **no** se reusa ni se crea customer. Cualquiera pondría el correo de otro.

Índices Neon: `user_address → customer_id` (único) y `email_normalized → customer_id` (único, tras OTP). Miniapp y partners comparten esos índices, no por `integration_id`.

No usamos `allow_any_from_address` en MiniPay: el depósito sale de la `0x` de la sesión.

No fusionamos dos customers de Bridge a mano. Si alguien KYCea un segundo email, es otro customer. Si Persona rechaza por cédula duplicada, que use el email ya aprobado.

---

## 8. Fees y conciliación

Cada payout guarda **legs** con receptor. Confirmar no es solo “la tx existió”.

| Leg | Asset | Receptor | Cómo se verifica |
| --- | --- | --- | --- |
| Depósito Bridge | USDC | `deposit.address` de Bridge | Evento `Transfer` USDC `to=deposit` **y** webhook `funds_received` con `amount >= netUsdcToBridge` |
| Fee COP By | USDC | `COPBY_FEE_WALLET` | `Transfer` USDC = 100 bps de `netUsdcToBridge` |
| Fee swap Squid | según ruta | Integrator Squid (ya 25 bps) | Status Squid / `feeCosts` de la ruta; no es wallet COP By |
| Fee Bridge developer | USD/USDC | Bridge | `developer_fee_percent` = **0,5%**. `receipt.developer_fee` |
| Buffer / leftover FX | USDC | Excess Funds wallet de COP By en Bridge | `receipt.developer_exchange_fee`. No es reembolso al user. Dust residual post top-up, no cierra `underfunded` solo. |
| Swap Uniswap V3 | COPm/USDC | LPs del pool | Slippage vs quote; no hay wallet extra |

### Cobro del fee COP By: misma tx onchain (prioridad)

Bps onchain: **100** (`COPBY_FEE_BPS`). En el Transfer de Bridge, siempre `developer_fee_percent` = **0,5%**.

- **USDC:** multicall / batch: `Transfer` al deposit + `Transfer` al fee wallet. Una confirmación MiniPay.
- **COPm:** misma firma si se puede (swap con recipient Bridge **y** un `Transfer` USDC al fee, o el router parte el output). El 25 bps de Squid es **otro** leg, no sustituye a COP By ni al 0,5%.
- **Fallback** (solo si el 1% onchain obliga a una segunda firma): ese 1% se suma al `developer_fee` de Bridge (**1,5%** en ese payout). El 0,5% no se apaga.

`confirm` exige el `Transfer` a `COPBY_FEE_WALLET` cuando el 1% fue onchain. Si el payout fue por fallback, se reconcilia `receipt.developer_fee` ≈ 1,5%.

`POST .../payouts/:id/confirm` (mismo espíritu que integrations swaps confirm):

1. Recibo existe, es success, `from` = `userAddress`.
2. Si USDC: `Transfer` al deposit Bridge ≥ `netUsdcToBridge`.
3. Si COPm: output USDC de Squid/Uniswap landed en deposit Bridge (no en la wallet del user, salvo dust).
4. Cada fee con `to` onchain: `Transfer` ≥ monto cotizado (tolerancia TBD, p.ej. 1%).
5. Marca `deposit_verified_at`. Fees pendientes → `fees_pending`, no `completed`.

Tras webhook `payment_processed`:

- Marca `bridge_payout_verified_at`.
- Job `reconcileBrebPayout(id)`: si depósito OK, fees OK y Bridge processed → `completed`. Si Bridge pagó y un fee no llegó → `completed_fees_mismatch` + alerta (no silenciar).

No dar por bueno un payout solo porque el usuario pegó un tx hash.

---

## 9. Modelo de datos (extra)

Además de `bridge_customers`, `bridge_external_accounts`, `breb_payouts`:

### `breb_payouts` (campos extra)

| Columna | Notas |
| --- | --- |
| `integration_id` | Partner o `copby` |
| `from_token` | `USDC` / `COPm` |
| `quote_id` | Cache usada |
| `effective_usd_cop` | Tasa mostrada |
| `swap_provider` | `squid` / `uniswap_v3` / `none` |
| `swap_tx_hash` | Si hubo swap |
| `bridge_tx_hash` / `source_tx_hash` | Depósito |
| `net_usdc_to_bridge` | |
| `fees` JSONB | Legs cotizadas vs verificadas |
| `deposit_verified_at` | |
| `fees_verified_at` | |
| `bridge_payout_verified_at` | |

Estados: `needs_kyc` → `awaiting_deposit` → `deposit_verified` → `funds_received` → `processing` → `completed` | `awaiting_topup` | `completed_fees_mismatch` | `failed` | `refunded`

---

## 10. Prepare payout (contrato)

```json
{
  "userAddress": "0xUser",
  "fromToken": "COPm",
  "destinationCop": "50000",
  "breBKey": "3XXXXXXXX",
  "accountOwnerName": "Ana Pérez"
}
```

Response:

```json
{
  "payoutId": "…",
  "status": "awaiting_deposit",
  "quote": { "display": "1 USD = 3000 COP", "effectiveUsdCop": "3000" },
  "fromToken": "COPm",
  "sourceAmount": "…",
  "deposit": { "chain": "celo", "currency": "usdc", "address": "0xBridge", "amount": "16.40" },
  "transaction": {
    "approvalTarget": "0x…",
    "to": "0xSquidOrUniRouter",
    "data": "0x…",
    "value": "0"
  },
  "fees": []
}
```

`breBKey` y `accountOwnerName` son **obligatorios**. Sin nombre no hay payout.

### Destino Bre-B (Fase 1): llave + nombre + verify, luego firmar

No hay lookup anónimo de llave. Bridge exige `bre_b_key` + `account_owner_name` al crear el External Account. `POST .../external_accounts/{id}/verify` compara ese nombre con el titular; es asíncrono (poll `account_verification` hasta `completed_at`).

Orden:

1. Customer KYC’d + endorsement `cop`.
2. Crear EA (`currency: cop`, `account_type: bre_b`, llave, nombre). No pide cédula ni banco.
3. Verify. Si `bre_b.matched !== true` → `409 destination_mismatch`. No crear Transfer. No mostrar el titular real como “ayuda” (eso sería el lookup post-MVP).
4. Si match: preview con `validated_bank_name` y `validated_document_number_last4` (y el nombre que el usuario escribió). Confirmar.
5. Recién entonces devolver `transaction` / crear el Transfer.

`409 needs_kyc` si Bridge no ha aprobado al customer. `409 destination_mismatch` si el verify no matchea.

Post-MVP: probar en sandbox si un nombre placeholder igual rellena `validated_account_owner_name` y se puede hacer UX de “pega la llave”. **No está en la API.** No es Fase 1.

Si `fromToken=USDC`, `transaction` es un multicall: depósito Bridge + fee 1% a `COPBY_FEE_WALLET`. El Transfer Bridge lleva `developer_fee_percent: "0.5"`. Si `fromToken=COPm`, la ruta Squid/Uniswap con **recipient = deposit Bridge** y, en la misma firma, el 1% onchain. Fallback: `developer_fee` 1,5% si el 1% onchain obliga a una segunda confirmación.

---

## 11. Slices

### Slice 0 — Ops

1. Enablement COP en Bridge (`sales@bridge.xyz`).
2. Mínimo: `BREB_MIN_COP=4000`, `BREB_MIN_USDC=2`.
3. `COPBY_FEE_WALLET`, `COPBY_FEE_BPS=100`, `BRIDGE_DEVELOPER_FEE_PERCENT=0.5`.
4. Pool Uniswap V3 COPm/USDC + router.
5. Webhook Bridge → `/api/breb/webhook`.

### Slice 1 — Servicio + cache + mock

- `lib/breb/` + `bridge-client` mock.
- `GET quote` con cache 4–6 h y `display: "1 USD = 3000 COP"`.
- Quoter Uniswap V3 + cadena Squid → Uni.
- Tablas Neon + API integrations (auth key) + aliases MiniPay `/api/breb/*` (`integration_id=copby`, sin Bearer).
- OTP mock: `debugCode` / `123456` (`BREB_MOCK_OTP`).
- Tests: cache hit no llama Bridge; miss sí; quote COPm usa fallback si Squid tira no-route.

### Slice 2 — Miniapp como cliente

- Tab Gastar consume `/api/breb/*` (USDC o COPm).
- Flujo KYC = OTP + abrir link Bridge si hace falta (`/breb/kyc-done`).
- `/activity` tipo `breb`.

### Slice 3 — Sandbox real + conciliación

- Key Bridge real.
- Verify EA Bre-B (`matched`) antes de devolver la tx a firmar.
- `confirm` verifica Transfer a deposit y fee legs.
- Webhooks + job de mismatch de fees.

### Slice 4 — Plataforma de integradores (**Fase 1**)

No es Fase 2. El rail sin portal no es el producto: keys a mano y soporte ciego.

- Admin + partner portal: Clerk Organizations, keys, reporting.
- Documentar BRE-B + reporting en `INTEGRATIONS_API.md`.
- Criterio: un partner puede integrar, operar y conciliar fees sin pedirnos un CSV.
- Orden: schema `integration_id` desde Slice 1; UI Clerk en paralelo o justo después del mock. No bloquea enablement COP.

---

## 12. Seguridad

- `BRIDGE_API_KEY` solo server. Partners solo ven COP By Bearer.
- Firma de webhooks Bridge.
- Idempotency-Key hacia Bridge.
- Dedup webhooks. No loguear llave BRE-B completa.
- Travel Rule: offramp fiat no exige TR on-chain.
- Cada Transfer lleva `return_instructions.return_address = userAddress` (refund al sender; no política global `refund_to_sender`).

---

## 13. Riesgos

| Riesgo | Mitigación |
| --- | --- |
| Cache 4–6 h vs FX live de Bridge | Padding en `effectiveUsdCop`; recotizar al payout si el buffer no cubre |
| Squid down el fin de semana | Fallback Uniswap V3 real (no solo `prefer`) |
| Fees | COP By 100 bps onchain + Bridge developer 50 bps. Padding FX aparte |
| KYC mata conversión | Medir `needs_kyc`; mismo link para todas las apps, sin KYC paralelo |
| Enablement COP | Slices 1–2 con mock |

---

## 14. Abierto (no bloquea Slice 1)

1. Pool Uniswap V3 COPm/USDC (address + fee tier).
2. TTL final: 4 h o 6 h (default 6).
3. Enablement COP en la cuenta (Celo USDC → Bre-B ya figura en payment routes).

---

## Relación con el roadmap

Plan técnico de **Fase 1**. Incluye miniapp **y** portal partner (Clerk). Otras apps entran por la misma Integrations API. [ROADMAP](./ROADMAP.md) sigue siendo la vista de producto.

---

## 15. ¿Sirve para pago de servicios y compras online?

La landing de [Orchestration](https://bridge.xyz/product/orchestration) vende **mover dinero** (onramp, offramp, payouts, remesas, tesorería) y, aparte, **gastar con card** Stripe/Bridge. No vende checkout, convenios ni catálogo de facturas.

| Caso | ¿El diseño actual alcanza? | Qué faltaría |
| --- | --- | --- |
| Remesa / pagar a una persona o negocio con llave BRE-B o cuenta | **Sí. Es el MVP.** Fixed output + External Account. | Nada de producto Bridge |
| “Pago de servicios” si COP By tiene la llave/cuenta del prestador (Claro, EPM, un SaaS local) | **Sí, mismo endpoint.** El partner manda `destinationCop` + destino. | Catálogo y referencias de factura son de COP By, no de Bridge |
| Facturas con convenio / código de barras / PSE checkout | **No.** Bridge no es un biller-switch. `co_bank_transfer` es onramp PSE hacia Bridge, no pagar a un comercio PSE | Reloadly, Bemovil, o un adquirente colombiano (Fase 3) |
| Comprar en internet (Amazon, Rappi, un Stripe Checkout) | **No con Transfers.** El comercio espera Visa/PSE/Nequi, no una Transfer API | Card Bridge/Stripe, o payout a Nequi del user para que pague él |
| Card Visa “gasta donde sea” | Producto Bridge **sí**; **no desde MiniPay Celo** | Cards noncustodial: Tempo, Solana, Base, World Chain, Linea. Wallets custodiales tampoco incluyen Celo. Habría que sacar USDC de Celo |

Lo que **sí** se reutiliza si más adelante se abre otra vertical:

- Quote cacheada + fees + `confirm` + webhooks
- KYC Bridge único (lo que la landing llama “unified KYC”)
- Integrations API (otra app puede ser un pagador de servicios)

Lo que **no** hay que asumir: que Orchestration = pagar Netflix o un carrito web. Eso o es un destino BRE-B que nosotros listamos, o es Cards (otro producto, otra chain).

---

## 16. Plataforma de integradores (idea final)

Tres superficies. Si falta una, no es el producto:

1. **Nosotros damos acceso** a service providers: API keys creadas desde **dashboard y API admin**.
2. **Nosotros monitoreamos** volumen, txs y fallos por integrador para dar soporte.
3. **Ellos consultan** sus txs, volúmenes y fees: **API** (máquinas) y **dashboard** (humanos, Clerk Organizations).

Hoy solo existe (parcial) el punto 3 para swaps: `GET /api/integrations/swaps` lista confirmed del key. Keys se emiten a mano. `/analytics` es interno y no desglosa por partner. BRE-B aún no escribe `integration_id` en código.

### Tres planos de auth

| Plano | Quién | Auth | Para qué |
| --- | --- | --- | --- |
| **Spend** | Usuario MiniPay / wallet de otra app | Wallet (sin Clerk) | Firmar USDC/COPm. KYC es Bridge. |
| **Partner API** | Backend del service provider | `copby_live_pk_…` | quote, payout, confirm, reporting máquina |
| **Dashboard** | Humanos: staff COP By y miembros del partner | **Clerk + Organizations** | Keys, volumen, txs, fees, soporte |

Clerk **no** entra en la miniapp ni en el payout. Es identidad del portal B2B.

### Clerk Organizations

Una **Organization de Clerk = un integrador = un `integration_id`**.

| Clerk | Neon |
| --- | --- |
| `org_xxx` | `integration_api_keys.id` / `integrations.clerk_org_id` |
| Org member (`org:admin` / `org:member`) | Puede entrar al dashboard de **esa** org |
| Usuario COP By (`publicMetadata.role = copby_staff`) | Ve todas las orgs, emite keys, soporte |

Flujo de alta:

1. Staff crea la org en Clerk (o invita al partner a crear la suya).
2. Backend crea la fila `integrations` con `clerk_org_id`.
3. Invite a miembros (email Clerk). Ellos eligen org activa y ven solo su data.
4. Un `org:admin` genera/revoca API keys (secreto una vez). Esas keys las usa su servidor, no el browser.

Roles sugeridos:

- `org:admin` — keys, members, summary, txs, fees
- `org:member` — read-only txs / volumen / fees (soporte del lado partner)
- `copby_staff` — todas las orgs, logs, mismatch de fees, impersonar org para un ticket

Sesión Clerk protege `/dashboard/*`. Las rutas `/api/integrations/*` de transacción siguen exigiendo API key (no se pone la secret en el frontend). El dashboard llama `/api/integrations/me/*` con la sesión Clerk; el server resuelve `org_id` → `integration_id` y nunca confía en un `integration_id` del client.

### 1. Acceso: dashboard Clerk + API admin

Staff (`copby_staff`) y, para su propia org, `org:admin`:

```txt
POST   /api/admin/integrations          crear partner + Clerk org (staff)
POST   /api/admin/integrations/:id/keys emitir key (staff o org:admin)
POST   /api/admin/integrations/:id/keys/:keyId/revoke
PATCH  /api/admin/integrations/:id      pausar, scopes, rate limit
GET    /api/admin/integrations          solo staff (todas)
GET    /api/dashboard/me                org activa → summary
```

Scopes: `swaps`, `breb`, `reporting`. Miniapp = integración first-party `copby`.

El secreto se muestra **una vez** (mismo modelo que Bridge). Se guarda `key_hash`, nunca el plaintext.

### 2. Soporte: consola COP By

Por `integration_id`:

- Volumen (USD in, COP out, count) día / 7d / 30d
- Estados: `completed`, `needs_kyc`, `failed`, `completed_fees_mismatch`
- Fees: COP By vs Bridge vs swap, para saber qué le debemos / qué nos deben
- Request logs: ruta, status, `error_code`, latencia (sin PII ni llave BRE-B)
- Drill-down a un `payout_id` / `intent_id` cuando el partner abre un ticket

Fuente: `breb_payouts` + `integration_swap_intents` + `integration_request_logs`. Slice 1 ya escribe logs; si no, el dashboard de soporte nace vacío.

### 3. Partner: reporting API + dashboard Clerk

Máquinas: misma Bearer de transacción. Humanos: dashboard de la org.

```txt
GET /api/integrations/swaps              API key (ya existe; confirmed)
GET /api/integrations/breb/payouts       API key
GET /api/integrations/me/summary         API key **o** sesión Clerk de esa org
GET /api/integrations/me/fees            API key **o** sesión Clerk de esa org
GET /api/dashboard/payouts               solo Clerk (UI)
```

`GET .../me/summary` (ejemplo):

```json
{
  "integrationId": "neeru",
  "from": "2026-09-01T00:00:00.000Z",
  "to": "2026-09-30T23:59:59.000Z",
  "payouts": { "count": 120, "completed": 114, "failed": 6 },
  "volume": { "destinationCop": "45000000", "sourceUsdc": "15000.00" },
  "fees": {
    "copbyUsd": "37.50",
    "bridgeUsd": "12.00",
    "swapUsd": "8.20"
  }
}
```

Fees “generados” = legs `copby` verificadas (`fees_verified_at`). Un payout `completed_fees_mismatch` no cuenta como fee cobrado hasta reconciliar.

v1 **sí** incluye portal partner (Clerk org) **en Fase 1**. La API de reporting sigue existiendo para su backoffice; el dashboard es para humanos que no quieren pegarle a la API.

Env: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, webhook `organization.created` / `membership` para no desincronizar Neon.

### Qué hay que persistir desde Slice 1

Cada quote/payout/confirm: `integration_id`, montos, `fees[]`, status, error. Sin eso no hay (2) ni (3).

Esto **es** parte del diseño de la API, no un extra de ops. BRE-B y swaps comparten el mismo `integration_id`.

---

## 17. Edge cases (usuario y organizaciones)

Prioridad: **común + grave**. Si no hay mitigación en código, no es go-live. Fee COP By 1% onchain + developer Bridge 0,5%. Mínimo 4000 COP y 2 USDC.

### Usuario (flujo gastar)

| # | Caso | Frecuencia | Gravedad | Qué pasa | Mitigación |
| --- | --- | --- | --- | --- | --- |
| U1 | **Llave BRE-B mala o de otra persona** | Alta | Crítica | Fiat irreversible. El destinatario no es quien el usuario cree. | **Llave + nombre obligatorios.** Crear EA → `verify` → payout solo si `matched`. Preview banco/last4. Sin match → `409 destination_mismatch`, no firmar. No autocompletar clipboard sin review. `Idempotency-Key` no reutiliza destino de otro payout. |
| U2 | **FX cacheada 4–6 h vs tasa live** | Alta | Crítica | Usuario firma USDC cotizado; Bridge exige más. Depósito corto → no se paga / refund. O al revés: overpay silencioso. | Padding ~1% de Bridge. Si igual `underfunded`: **segundo depósito del user** por X (USDC/COPm). Excess Funds solo dust/residual, no cierra el payout en silencio. Si abandona → return a su wallet. Revalidar al `POST payout`; si el cache ya no alcanza → `409 requote`. |
| U3 | **Swap COPm entrega menos USDC que `netUsdcToBridge`** | Alta (finde / slippage) | Crítica | USDC llega a Bridge a medias. Payout colgado. Usuario cree que “se perdió”. | `minOut` onchain ≥ neto. Si el receipt queda corto: `awaiting_topup` + mismo segundo paso que U2 (depositar X). Si abandona → return a la wallet. Uniswap fallback con slippage tope. |
| U4 | **KYC en MiniPay WebView / usuario cierra Persona** | Alta | Alta | `needs_kyc` eterno. Segundo payout crea otro link. Partner no sabe si esperar. | Customer por `user_address` **o** email con OTP. Nombre + email en el form. Reusar `kyc_link` vivo. `redirectUri` del cliente. Poll + webhook. URL Persona caduco (~24 h) → regenerar, no nuevo customer. |
| U5 | **Doble tap / same txHash en dos payouts** | Alta | Crítica | Un depósito acredita el payout A y B, o confirm huérfano. Doble COP o uno robado. | `confirm`: txHash único global. `from`, `to`, `amount` deben matchear **ese** `payout_id`. Segundo confirm → 409. Idempotency en create payout. |
| U6 | **Confirm nunca llega; el usuario sí pagó** | Media | Crítica | UI “falló”; Bridge igual recibe y paga. Soporte ciego. | Indexar depósitos por `deposit.address` + amount. Webhook `funds_received` cierra el payout aunque no haya confirm. Job: `awaiting_deposit` > N min + match onchain. |

Otros que hay que manejar, menos “top”: payout bajo 4000 COP o 2 USDC (`400 below_minimum`); gas CELO a 0 en MiniPay; endorsement `cop` rejected; ToS de Bridge no aceptado. Address nueva + mismo email verificado reusa KYC (§7); sin OTP no se liga.

### Organizaciones (Clerk + keys + reporting)

| # | Caso | Frecuencia | Gravedad | Qué pasa | Mitigación |
| --- | --- | --- | --- | --- | --- |
| O1 | **IDOR / org cruzada** | Alta si se fía del client | Crítica | Partner A pide `integration_id=B` o Clerk org activa ≠ row Neon. Ve txs/fees ajenos. | Server: `orgId` de la sesión Clerk **o** key → `integration_id`. Ignorar `integration_id` del body/query si no coincide (ya en swaps; repetir en breb + `/me`). Tests de aislamiento. |
| O2 | **API key filtrada** | Media | Crítica | Cualquiera paga a nombre del partner, infla volumen, redirige destinos. | Key una vez; hash only. Revoke inmediato en dashboard. Scopes. Rate limit. Alerta de volumen anómalo. Rotación. No loguear Bearer. |
| O3 | **Key revocada con payout en `awaiting_deposit`** | Alta en rotación | Alta | Usuario ya firmó. `confirm` → 401. Fondos en Bridge, partner no puede cerrar. | Revoke no borra payouts abiertos. `confirm` de un payout **existente** de esa integración se permite un grace (o staff lo cierra). Crear payouts nuevos sí se bloquea. |
| O4 | **Clerk org ≠ fila Neon** | Alta en onboarding | Alta | Invite llega, dashboard vacío / 500. O org borrada en Clerk y keys vivas. | Webhooks `organization.*` / `membership.*`. Alta atómica: org + `integrations` row. Soft-delete: pausar keys si la org desaparece. Staff ve “desync”. |
| O5 | **`copby_staff` mal puesto** | Baja | Crítica | Un partner se asigna staff (si se lee `publicMetadata` del JWT sin verificar o se deja editable). Ve todas las orgs. | Rol staff **solo** en `privateMetadata` o allowlist server-side. Nunca `publicMetadata` editable por el user. Clerk Organizations: restricción de quién crea orgs (solo staff). |
| O6 | **Fees en `summary` antes de reconciliar** | Alta | Alta | Partner factura “fees generados” de payouts `completed_fees_mismatch` o aún `processing`. Disputa contable. | `GET .../me/fees` y summary: solo legs `verified`. Estados abiertos en `pendingFees`. Documentar. Dashboard muestra mismatch aparte. |

Otros: miembro Clerk sin org activa; impersonación de staff no cerrada; dos keys de la misma org, una leak. Misma `userAddress` en dos partners → mismo customer Bridge (§7).

### Los 5 que hay que diseñar primero

1. **U1** destino incorrecto — no hay chargeback COP.
2. **U2 + U3** corto de USDC — el fallo de liquidez que ya mató a Abroad, ahora en nuestra cola.
3. **U5 + U6** doble crédito / confirm ausente — contabilidad rota.
4. **O1** fuga de datos entre orgs — mata la plataforma.
5. **O2 + O3** key leak / revoke a mitad de payout — agujero de dinero y de soporte.

Go-live checklist: tests de U5, O1, U2 (requote) y un runbook de U6/O3 (depósito huérfano + key revocada).
