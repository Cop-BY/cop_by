export type WalletActionFlow = "buy" | "sell" | "transfer" | "spend";

export type WalletActionErrorKind =
  | "default"
  | "user-rejected"
  | "rate-limit"
  | "no-liquidity"
  | "insufficient-balance"
  | "missing-allowance"
  | "pending-transaction"
  | "failed-transaction";

export type WalletActionErrorCopy = {
  kind: WalletActionErrorKind;
  message: string;
  isNoLiquidity: boolean;
  isRateLimit: boolean;
};

function getFlowCopy(flow: WalletActionFlow) {
  switch (flow) {
    case "buy":
      return {
        fallback: "No pudimos completar la compra. Revisa la confirmación en tu wallet e intenta de nuevo.",
        insufficient: "No tienes suficiente saldo para completar esta compra.",
        allowance: "Necesitas autorizar este token antes de comprar COPm.",
        liquidity: "No hay suficiente liquidez en este momento para comprar COPm. Prueba con un monto menor o intenta más tarde.",
        rateLimit: "Estamos recibiendo muchas solicitudes de cotización. Espera unos segundos e intenta de nuevo.",
        pending: "Ya hay una transacción pendiente en tu wallet. Espera a que se confirme o cancela la previa.",
        failed: "La transacción falló. Revisa el estado en tu wallet y vuelve a intentarlo.",
      };
    case "sell":
      return {
        fallback: "No pudimos completar la venta. Revisa la confirmación en tu wallet e intenta de nuevo.",
        insufficient: "No tienes suficiente COPm para completar esta venta.",
        allowance: "Necesitas autorizar COPm antes de venderlo.",
        liquidity: "No hay suficiente liquidez en este momento para vender COPm. Prueba con un monto menor o intenta más tarde.",
        rateLimit: "Estamos recibiendo muchas solicitudes de cotización. Espera unos segundos e intenta de nuevo.",
        pending: "Ya hay una transacción pendiente en tu wallet. Espera a que se confirme o cancela la previa.",
        failed: "La transacción falló. Revisa el estado en tu wallet y vuelve a intentarlo.",
      };
    case "transfer":
      return {
        fallback: "No pudimos completar el envío. Revisa la confirmación en tu wallet e intenta de nuevo.",
        insufficient: "No tienes suficiente COPm para completar este envío.",
        allowance: "No pudimos preparar el permiso necesario para este envío.",
        liquidity: "No hay suficiente liquidez en este momento para completar este envío. Intenta más tarde.",
        rateLimit: "Estamos recibiendo muchas solicitudes. Espera unos segundos e intenta de nuevo.",
        pending: "Ya hay una transacción pendiente en tu wallet. Espera a que se confirme o cancela la previa.",
        failed: "La transacción falló. Revisa el estado en tu wallet y vuelve a intentarlo.",
      };
    case "spend":
      return {
        fallback: "No pudimos completar el gasto. Revisa la confirmación en tu wallet e intenta de nuevo.",
        insufficient: "No tienes suficiente COPm para completar este gasto.",
        allowance: "Necesitas autorizar COPm antes de usarlo para este gasto.",
        liquidity: "No hay suficiente liquidez en este momento para completar este gasto. Intenta más tarde.",
        rateLimit: "Estamos recibiendo muchas solicitudes. Espera unos segundos e intenta de nuevo.",
        pending: "Ya hay una transacción pendiente en tu wallet. Espera a que se confirme o cancela la previa.",
        failed: "La transacción falló. Revisa el estado en tu wallet y vuelve a intentarlo.",
      };
  }
}

export function getWalletActionErrorCopy(
  error: unknown,
  flow: WalletActionFlow = "buy"
): WalletActionErrorCopy {
  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();
  const copy = getFlowCopy(flow);

  if (
    lowerMessage.includes("user rejected") ||
    lowerMessage.includes("user denied") ||
    lowerMessage.includes("rejected the request") ||
    lowerMessage.includes("denied transaction")
  ) {
    return {
      kind: "user-rejected",
      message: "Cancelaste la confirmación en tu wallet.",
      isNoLiquidity: false,
      isRateLimit: false,
    };
  }

  if (
    lowerMessage.includes("too many quote requests") ||
    lowerMessage.includes("rate limit") ||
    lowerMessage.includes("429") ||
    lowerMessage.includes("too many requests") ||
    lowerMessage.includes("cotizaci") ||
    lowerMessage.includes("cotizaciones")
  ) {
    return {
      kind: "rate-limit",
      message: copy.rateLimit,
      isNoLiquidity: false,
      isRateLimit: true,
    };
  }

  if (
    lowerMessage.includes("low liquidity") ||
    lowerMessage.includes("insufficient liquidity") ||
    lowerMessage.includes("no liquidity") ||
    lowerMessage.includes("no route") ||
    lowerMessage.includes("route unavailable") ||
    lowerMessage.includes("liquidez") ||
    lowerMessage.includes("ruta no disponible")
  ) {
    return {
      kind: "no-liquidity",
      message: copy.liquidity,
      isNoLiquidity: true,
      isRateLimit: false,
    };
  }

  if (
    lowerMessage.includes("insufficient balance") ||
    lowerMessage.includes("insufficient funds") ||
    lowerMessage.includes("saldo insuficiente") ||
    lowerMessage.includes("not enough")
  ) {
    return {
      kind: "insufficient-balance",
      message: copy.insufficient,
      isNoLiquidity: false,
      isRateLimit: false,
    };
  }

  if (
    lowerMessage.includes("allowance") ||
    lowerMessage.includes("approval") ||
    lowerMessage.includes("permiso")
  ) {
    return {
      kind: "missing-allowance",
      message: copy.allowance,
      isNoLiquidity: false,
      isRateLimit: false,
    };
  }

  if (
    lowerMessage.includes("pending transaction") ||
    lowerMessage.includes("already pending") ||
    (lowerMessage.includes("pending") && lowerMessage.includes("transaction"))
  ) {
    return {
      kind: "pending-transaction",
      message: copy.pending,
      isNoLiquidity: false,
      isRateLimit: false,
    };
  }

  if (
    lowerMessage.includes("transaction failed") ||
    lowerMessage.includes("execution reverted") ||
    lowerMessage.includes("failed transaction") ||
    (lowerMessage.includes("failed") && lowerMessage.includes("transaction"))
  ) {
    return {
      kind: "failed-transaction",
      message: copy.failed,
      isNoLiquidity: false,
      isRateLimit: false,
    };
  }

  if (lowerMessage.includes("minimum purchase amount")) {
    return {
      kind: "default",
      message: "La compra mínima es de 1 USD aprox.",
      isNoLiquidity: false,
      isRateLimit: false,
    };
  }

  if (message.length > 180 || lowerMessage.includes("request arguments")) {
    return {
      kind: "default",
      message: copy.fallback,
      isNoLiquidity: false,
      isRateLimit: false,
    };
  }

  return {
    kind: "default",
    message: message || copy.fallback,
    isNoLiquidity: false,
    isRateLimit: false,
  };
}
