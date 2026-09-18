# COP By — Roadmap de producto

> **Última actualización:** septiembre 2026  
> **Enfoque:** usabilidad y tracción (revenue secundario por ahora)  
> **Fase 0:** ✅ completada (jun 2026) — QA MiniPay aprobado, merge en `main` + fix Squid `prefer` Uniswap V3  
> **Rail fiat:** Bridge (COP Bre-B). Abroad descartado por falta de liquidez.

---

## North Star

**Hacer que COPm / pesos digitales sean la forma más fácil de gastar desde MiniPay para usuarios en Colombia.**

### Métrica principal

**COP gastado o enviado por usuario activo semanal** (no solo comprado).

| Métrica | Rol |
| --- | --- |
| Conversión completada (compra COPm) | Activación |
| Gasto o envío completado (transfer / BRE-B) | Retención |
| Retorno en 7 días | Tracción |
| Compartidos / referidos | Crecimiento orgánico |

---

## Usuario objetivo

| Atributo | Definición |
| --- | --- |
| **Quién** | Usuarios de MiniPay en Colombia |
| **Entrada** | Reciben USD (USDC, USDT, etc.) en su wallet |
| **Necesidad** | Convertir y **gastar en pesos colombianos** |
| **Perfil** | No crypto-nativo; quiere pesos usables, no un flujo técnico |

### Mensaje de producto

> *"Convierte tus dólares de MiniPay en pesos que puedes usar."*

COPm es el motor onchain; el usuario no tiene que entender tokens. El gasto fiat sale en **USDC en Celo** hacia Bridge (Bridge no lista COPm).

---

## Estado actual (ya construido)

| Capacidad | Estado |
| --- | --- |
| Comprar COPm desde saldos en wallet (Squid) | ✅ |
| Enviar COPm a otra wallet | ✅ |
| Comprar COPm y recibirlo en otra wallet | ✅ |
| Fee Squid visible en UI | ✅ |
| Analytics (swaps + transfers) | ✅ |
| Logging onchain + Neon | ✅ |
| **Fase 0 — copy pesos-first, onboarding, flujo simplificado** | ✅ |
| **Historial `/activity` (swaps + transfers)** | ✅ |
| **Comprobante compartible (imagen + texto)** | ✅ |
| **Destinatarios guardados (alias, máx. 5, eliminar)** | ✅ |
| **Squid `prefer` Uniswap V3** (fallback si no hay ruta) | ✅ |

---

## Arquitectura de rails (visión)

Dos vías complementarias, no excluyentes:

```
MiniPay wallet
    ├─ Comprar COPm (Squid)      → pesos en wallet, P2P, ecosistema Celo
    └─ Pagar vía BRE-B (Bridge)  → pesos al mundo real (banco, Nequi, comercio)
```

| Rail | Proveedor | Caso de uso |
| --- | --- | --- |
| Onchain COPm | Squid Router | Balance en MiniPay, transferencias P2P |
| Fiat COP vía BRE-B | [Bridge](https://apidocs.bridge.xyz/get-started/guides/move-money/cop_integration_guide) | Pagos a cuentas y comercios en Colombia |

**Descartado:** [Abroad](https://docs.abroad.finance/) — sin liquidez, no hay payout.

---

## Distribución

| Canal | Táctica |
| --- | --- |
| **MiniPay** | Flujo corto (&lt;3 taps visibles), montos en COP, copy en español colombiano |
| **Comunidades Colombia** | Un caso de uso claro por activación (*"paga en Colombia desde MiniPay"*) |
| **Boca a boca** | Comprobante compartible (WhatsApp), referidos, envío a familia |

**Mensaje sugerido para comunidades:**

> *"¿Recibes dólares en MiniPay? Con COP By los conviertes en pesos y los mandas a cualquier cuenta en Colombia."*

---

## Fases del roadmap

### Fase 0 — Alinear producto con el usuario ✅ Completada

**Duración:** jun 2026  
**Objetivo general:** Que quien llegue una vez entienda el valor en segundos y tenga razones para volver.

| # | Tarea | Estado |
| --- | --- | --- |
| 0.1 | Reposicionar copy | ✅ |
| 0.2 | Simplificar flujo de compra | ✅ |
| 0.3 | Historial de actividad | ✅ |
| 0.4 | Pantalla de éxito mejorada | ✅ (+ imagen compartible) |
| 0.5 | "Enviar pesos" prominente | ✅ |
| 0.6 | Destinatarios con contexto | ✅ (guardado explícito, máx. 5) |
| 0.7 | Onboarding de 1 pantalla | ✅ |

**Criterio de éxito Fase 0** (medir post-deploy)

- Tasa de completación del flujo de compra &gt; 70%
- Usuarios que vuelven en 7 días &gt; 25%

**Extra post-Fase 0:** fix de routing Squid con `prefer: ["Uniswap V3"]` para evitar fallos de liquidez cuando Mento cierra mercado FX (vier–dom).

---

### Fase 1 — Primer gasto real: BRE-B con Bridge

**Duración estimada:** 4–8 semanas (depende de enablement COP en Bridge)  
**Objetivo general:** Dar una razón concreta para volver después de convertir USD — gastar en el mundo real colombiano.

**Proveedor:** [Bridge](https://apidocs.bridge.xyz/get-started/guides/move-money/cop_integration_guide) — USDC o COPm en Celo → COP fiat vía Bre-B. COPm se swappea a USDC (Squid, fallback Uniswap V3) antes de Bridge. COP está en beta; hay que pedir acceso a `sales@bridge.xyz`.

**Forma:** servicio de backend (Integrations API). Lo consume la miniapp y otras apps. KYC es de Bridge (Persona), no de COP By.

**Plan técnico:** [BRIDGE_IMPLEMENTATION.md](./BRIDGE_IMPLEMENTATION.md) — API, cotización 4–6 h, fee COP By 1% + developer Bridge 0,5%, mínimo 4000 COP / 2 USDC.

| # | Tarea | Detalle general | Objetivo |
| --- | --- | --- | --- |
| 1.1 | Enablement COP | Solicitar sandbox, API keys y activación del rail COP a Bridge sales. | Desbloquear integración |
| 1.2 | Validar compliance y UX KYC | KYC por usuario (Persona) + endorsement `cop`. Confirmar mínimos, límites y settlement. | Diseñar UX sin sorpresas regulatorias |
| 1.3 | Flujo técnico MVP | Servicio backend: quote cacheada → verify destino (llave + nombre) → payout Bridge. Source USDC o COPm. Frontend miniapp y otras apps consumen la misma API. | Primer pago BRE-B end-to-end |
| 1.4 | Tab "Gastar" en UI | Evolucionar `Comprar \| Transferir` hacia `Comprar \| Enviar \| Gastar`. Incluir paso KYC Bridge. | Unificar conversión + gasto en una app |
| 1.5 | Persistencia y analytics | Registrar payouts BRE-B en DB (similar a swaps/transfers). | Medir adopción y depurar fallos |
| 1.6 | Manejo de errores y estados | Estados claros: cotizando, KYC pendiente, procesando, completado, fallido + mensajes en español. | Confianza en pagos fiat |
| 1.7 | Portal partner (Clerk) | Organizations = `integration_id`. Staff y partners: keys, volumen, txs, fees. API de reporting + dashboard. | Plataforma, no solo miniapp |

**Flujo objetivo**

```
[¿Cuántos pesos?] → [¿A quién? llave BRE-B + nombre del titular]
    → [KYC Bridge si falta] → [Verify Bridge] → [Confirmar banco / last4]
    → [USDC desde MiniPay en Celo] → [COP vía Bridge / BRE-B]
```

Si el usuario paga con COPm, el backend cotiza COPm→USDC (Squid, fallback Uniswap V3) y el USDC neto llega al depósito de Bridge. KYC es hosted de Bridge, igual desde la miniapp o desde otra app.

**Pagos con QR:** Bridge no tiene QR nativo para COP (sí para PIX/BRL). Escanear un QR de comercio es capa UX de COP By: parsear llave Bre-B → External Account → Transfer. No es el MVP; va después del rail live. Recibir P2P vía QR no encaja: depósitos COP de terceros individuos no están permitidos.

**Preguntas abiertas con Bridge (bloqueantes para go-live)**

- ¿Enablement COP + sandbox en la cuenta de COP By?
- ¿Fricción real del KYC Persona en MiniPay (tasa de completación)?

#### Avance sin enablement COP (en curso / preparación)

Tareas que no requieren credenciales de Bridge y desbloquean el MVP cuando llegue el acceso:

| # | Tarea | Detalle | Esfuerzo |
| --- | --- | --- | --- |
| 1.2a | Spec de compliance (desk research) | Documentar desde [docs Bridge COP](https://apidocs.bridge.xyz/get-started/guides/move-money/cop_integration_guide) KYC/endorsements, límites, webhooks y Travel Rule; lista de preguntas para sales. | Bajo |
| 1.3a | Modelo de datos BRE-B | Tabla `breb_payouts` en Neon (quote/transfer id, destinatario, estado, tx onchain, webhook ids) — espejo de swaps/transfers. | Medio |
| 1.3b | Capa `lib/bridge-client.ts` | Tipos TypeScript + cliente HTTP con mock adapter (`BRIDGE_MOCK=true`) para desarrollo local. | Medio |
| 1.3c | Endpoints stub | `POST /api/breb/quote`, `POST /api/breb/payout`, `POST /api/breb/webhook` — validación de input, estados, sin llamada real. | Medio |
| 1.4a | Tab **Gastar** + UI shell | Tercer tab `Obtener \| Enviar \| Gastar`; formulario monto + llave BRE-B + **nombre del titular** + confirmación (verify mock) + placeholder KYC. | Medio |
| 1.5a | Actividad unificada | Incluir payouts BRE-B en `/activity` cuando exista la tabla. | Bajo |
| 1.6a | Copy de errores fiat | Mensajes en español para cotización fallida, KYC pendiente, payout rechazado (reutilizar patrón swap/transfer). | Bajo |
| — | Mensaje mercado Mento cerrado | Si Squid falla fin de semana tras `prefer`, aviso UX “mercado de pesos cerrado” (complemento al fix Uniswap). | Bajo |

**Bloqueado hasta enablement COP:** Transfer/Liquidation Address real, webhooks firmados, KYC embebido, go-live BRE-B.

**Criterio de éxito Fase 1**

- &gt; 15% de usuarios activos completan al menos un gasto BRE-B
- &gt; 1.2 transacciones de gasto por usuario activo semanal

---

### Fase 2 — Loops de tracción

**Duración estimada:** 6–8 semanas (puede solaparse con cierre de Fase 1)  
**Objetivo general:** Crecimiento orgánico en MiniPay, comunidades colombianas y WhatsApp.

| # | Tarea | Detalle general | Objetivo |
| --- | --- | --- | --- |
| 2.1 | Hero "Envía pesos a Colombia" | Landing / primera pantalla centrada en remesas y pagos a familia. | Viralidad en comunidades |
| 2.2 | Comprobante compartible | Imagen o link post-tx optimizado para WhatsApp. | Boca a boca con prueba social |
| 2.3 | Cashback offchain | Bonus COPm en DB (ej. primera recarga BRE-B o primera compra). Sin contratos onchain. | Incentivo de primera repetición |
| 2.4 | Referidos simples | Código o link; ambos reciben beneficio en próxima operación (offchain). | Medir y escalar crecimiento |
| 2.5 | Contenido para comunidades | Video corto (~30 s) + copy para grupos Telegram/WhatsApp. | Activación en canales CO |

**Criterio de éxito Fase 2**

- &gt; 10% de compras/envíos a terceros
- Baseline de referidos activados medido y en crecimiento

---

### Fase 3 — Segunda vertical de gasto

**Duración:** cuando Fase 1 tenga datos de uso  
**Objetivo general:** Expandir casos de gasto solo si hay demanda validada.

| Vertical | Proveedor | Cuándo abordar |
| --- | --- | --- |
| Pagar QR de comercio | COP By (parseo) + Bridge payout a llave Bre-B | Tras Fase 1 live; no es API nativa de Bridge |
| Recargas telefónicas | Por definir (Bemovil, Reloadly, etc.) | Cuando exista API y Fase 1 &gt; 15% adopción |
| Gift cards (Netflix, etc.) | Por definir | Tras elegir catálogo CO |
| Vouchers (Rappi, Uber, Didi) | Por definir | Si hay partner o margen claro |
| Tarjeta Visa | Bridge Cards | No desde MiniPay: Celo no está en cards noncustodial |

**Regla:** no abrir una nueva vertical hasta que la anterior supere ~15% de usuarios activos usándola.

---

## Congelado (no construir hasta presión real)

| Ítem | Criterio para desbloquear |
| --- | --- |
| **Swap & stake COPm** | Partner de yield + modelo legal claro |
| **Multi-approve / Permit2 onchain** | &gt; 30% abandono en paso "Activar" en producción |
| **Cashback onchain** | Auditoría, grant (Talent) o requisito regulatorio |
| **4 verticales de pago en paralelo** | Descartado — una vertical a la vez |
| **Abroad Finance** | Descartado — sin liquidez COP, no hay payout |

---

## Backlog priorizado (próximas 4–8 semanas)

| Prioridad | Tarea | Esfuerzo | Impacto tracción |
| --- | --- | --- | --- |
| 1 | Contactar Bridge → enablement COP + sandbox | Ops | Crítico |
| 2 | Spec + schema BRE-B (1.2a, 1.3a) | Bajo–Medio | Alto |
| 3 | Tab Gastar + UI shell con mock y KYC (1.4a) | Medio | Alto |
| 4 | Cliente Bridge + endpoints stub (1.3b–c) | Medio | Alto |
| 5 | Medir métricas Fase 0 en producción | Bajo | Alto |
| 6 | MVP BRE-B end-to-end (con enablement COP) | Alto | Muy alto |
| 7 | Portal partner Clerk (1.7) | Medio–Alto | Alto |
| 8 | Referidos offchain (Fase 2) | Medio | Medio |
| 9 | Recargas telefónicas | — | Bloqueado (sin proveedor) |

---

## Journey del usuario (objetivo)

```
Llega (MiniPay / comunidad)
        │
        ▼
   ¿Qué necesito?
    ┌───┼───┐
    ▼   ▼   ▼
 Convertir  Enviar  Pagar en Colombia
    │       │           │
    ▼       ▼           ▼
 COPm     Transfer    BRE-B
(Squid)   o BRE-B    (Bridge)
    │       │           │
    └───────┴───────────┘
              │
              ▼
    Comprobante compartible
              │
              ▼
       Vuelve en 7 días
```

---

## Decisiones de producto tomadas

| Decisión | Elección |
| --- | --- |
| Usuario principal | MiniPay CO que recibe USD y quiere gastar en COP |
| Revenue | COP By 1% onchain + 0,5% developer_fee Bridge; Squid 25 bps extra si hay swap COPm |
| Cotización | Tasa efectiva cacheada 4–6 h; mínimo **4000 COP y 2 USDC** |
| Primera vertical de gasto | BRE-B vía Bridge (USDC en Celo → COP). Abroad descartado por liquidez |
| Asset de payout | USDC o COPm en Celo. COPm se convierte a USDC onchain; Bridge no lista COPm |
| KYC | Hosted Bridge (Persona + endorsement `cop`), igual para miniapp y partners |
| Superficie | **Fase 1:** servicio backend + miniapp **+** portal partner (Clerk orgs, keys, reporting) |
| QR comercio | Capa UX después del rail live; no es MVP ni API nativa de Bridge |
| Cashback | Offchain primero; onchain solo si se exige |
| Distribución | MiniPay + comunidades Colombia + boca a boca |

---

## Próximos pasos inmediatos

1. ~~Ejecutar **Fase 0**~~ ✅ Completada y en producción.
2. **Contactar Bridge** (`sales@bridge.xyz`) para enablement COP y sandbox (1.1).
3. **En paralelo (sin enablement):** spec compliance, schema DB, tab Gastar con mock, cliente Bridge stub.
4. **Con acceso COP:** conectar Transfer o Liquidation Address + webhooks y cerrar MVP BRE-B (1.3).
5. **Medir** completación de compra y retorno 7d post-Fase 0.
