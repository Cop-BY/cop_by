"use client";

import { useEffect, useMemo, useState } from "react";
import {
  erc20Abi,
  formatUnits,
  maxUint256,
  type Address,
  type Hex,
} from "viem";
import { usePublicClient, useSendTransaction, useWriteContract } from "wagmi";
import { ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  BREB_MIN_COP,
  confirmBrebPayoutRequest,
  createBrebPayoutRequest,
  fetchBrebKyc,
  fetchBrebQuote,
  getBrebErrorMessage,
  sendBrebOtp,
  startBrebKyc,
  verifyBrebOtp,
  type BrebKycStatus,
  type BrebPayout,
  type BrebQuote,
} from "@/lib/breb-client";
import type { BrebFromToken } from "@/lib/breb/types";
import { formatPesoAmountFromString } from "@/lib/format-peso";
import type { PortfolioTokenWithOnchain } from "@/hooks/use-token-portfolio";

type SpendStep = "form" | "otp" | "kyc" | "review" | "done";

const FEE_LABELS: Record<string, string> = {
  bridge: "Bridge 0,5%",
  bridge_fx: "Reserva de tasa",
  copby: "COP By 1%",
  swap: "Cambio COPm",
};

function cleanCopInput(value: string) {
  return value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
}

function kycRedirectUri() {
  if (typeof window === "undefined") return undefined;
  return `${window.location.origin}/breb/kyc-done`;
}

export function SpendPanel({
  copm,
  explorerUrl,
  isConnected,
  onBack,
  usdc,
  userAddress,
}: {
  copm?: PortfolioTokenWithOnchain;
  explorerUrl: string;
  isConnected: boolean;
  onBack: () => void;
  usdc?: PortfolioTokenWithOnchain;
  userAddress?: Address;
}) {
  const publicClient = usePublicClient();
  const { sendTransactionAsync } = useSendTransaction();
  const { writeContractAsync } = useWriteContract();
  const [step, setStep] = useState<SpendStep>("form");
  const [amount, setAmount] = useState("10000");
  const [fromToken, setFromToken] = useState<BrebFromToken>("USDC");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [breBKey, setBreBKey] = useState("");
  const [otp, setOtp] = useState("");
  const [debugCode, setDebugCode] = useState<string | null>(null);
  const [kyc, setKyc] = useState<BrebKycStatus | null>(null);
  const [quote, setQuote] = useState<BrebQuote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [payout, setPayout] = useState<BrebPayout | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);

  const selectedToken = fromToken === "COPm" ? copm : usdc;
  const destinationCop = Number(amount || "0");
  const sourceNeeded = quote?.sourceAmount
    ? BigInt(quote.sourceAmount)
    : null;
  const hasEnough =
    !sourceNeeded ||
    selectedToken?.balance === undefined ||
    selectedToken.balance >= sourceNeeded;

  const sourceLabel = useMemo(() => {
    if (!quote?.sourceAmount || !selectedToken) return null;
    return `${formatUnits(BigInt(quote.sourceAmount), selectedToken.decimals)} ${fromToken}`;
  }, [fromToken, quote?.sourceAmount, selectedToken]);

  useEffect(() => {
    if (!userAddress) return;
    void fetchBrebKyc(userAddress)
      .then(setKyc)
      .catch(() => undefined);
  }, [userAddress]);

  useEffect(() => {
    if (destinationCop < BREB_MIN_COP) {
      setQuote(null);
      setQuoteError(`El mínimo es ${BREB_MIN_COP} COP.`);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      void fetchBrebQuote({
        destinationCop: amount,
        fromToken,
        userAddress,
      })
        .then((next) => {
          if (cancelled) return;
          setQuote(next);
          setQuoteError(null);
        })
        .catch((quoteErr) => {
          if (cancelled) return;
          setQuote(null);
          setQuoteError(getBrebErrorMessage(quoteErr));
        });
    }, 350);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [amount, destinationCop, fromToken, userAddress]);

  const continueFromForm = async () => {
    if (!userAddress) {
      setError("Conecta tu wallet para gastar.");
      return;
    }
    if (!fullName.trim() || !email.includes("@") || !breBKey.trim()) {
      setError("Nombre, correo y llave Bre-B son obligatorios.");
      return;
    }
    if (!quote || quoteError || !hasEnough) {
      setError(quoteError ?? "Revisa el monto y tu saldo.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const status = await startBrebKyc({
        email,
        fullName,
        redirectUri: kycRedirectUri(),
        userAddress,
      });
      setKyc(status);
      if (status.status === "approved") {
        await createPayout();
        return;
      }
      if (status.status === "needs_kyc") {
        setStep("kyc");
        return;
      }
      const sent = await sendBrebOtp({ email, userAddress });
      setDebugCode(sent.debugCode ?? null);
      setKyc(sent);
      setStep("otp");
    } catch (continueError) {
      setError(getBrebErrorMessage(continueError));
      if (
        continueError &&
        typeof continueError === "object" &&
        "errorCode" in continueError &&
        continueError.errorCode === "destination_mismatch"
      ) {
        setStep("form");
      }
    } finally {
      setBusy(false);
    }
  };

  const createPayout = async () => {
    if (!userAddress || !quote) return;
    const created = await createBrebPayoutRequest({
      accountOwnerName: fullName.trim(),
      breBKey: breBKey.trim(),
      destinationCop: amount,
      fromToken,
      quoteId: quote.quoteId,
      userAddress,
    });
    setPayout(created);
    setStep("review");
  };

  const handleVerifyOtp = async () => {
    if (!userAddress) return;
    setBusy(true);
    setError(null);
    try {
      const verified = await verifyBrebOtp({
        code: otp.trim(),
        email,
        fullName,
        redirectUri: kycRedirectUri(),
        userAddress,
      });
      setKyc(verified);
      if (verified.status === "needs_kyc") {
        setStep("kyc");
        return;
      }
      await createPayout();
    } catch (verifyError) {
      setError(getBrebErrorMessage(verifyError));
      if (
        verifyError &&
        typeof verifyError === "object" &&
        "errorCode" in verifyError &&
        verifyError.errorCode === "destination_mismatch"
      ) {
        setStep("form");
      }
    } finally {
      setBusy(false);
    }
  };

  const refreshKyc = async () => {
    if (!userAddress) return;
    setBusy(true);
    setError(null);
    try {
      const status = await fetchBrebKyc(userAddress);
      setKyc(status);
      if (status.status === "approved") {
        await createPayout();
      }
    } catch (refreshError) {
      setError(getBrebErrorMessage(refreshError));
    } finally {
      setBusy(false);
    }
  };

  const pay = async () => {
    if (!userAddress || !payout?.transaction) {
      setError("No hay transacción lista para firmar.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (payout.transaction.approvalTarget && selectedToken?.address) {
        const hash = await writeContractAsync({
          address: selectedToken.address,
          abi: erc20Abi,
          functionName: "approve",
          args: [payout.transaction.approvalTarget, maxUint256],
        });
        await publicClient?.waitForTransactionReceipt({ hash });
      }

      const depositHash = await sendTransactionAsync({
        to: payout.transaction.to,
        data: payout.transaction.data,
        value: BigInt(payout.transaction.value ?? "0"),
      });
      await publicClient?.waitForTransactionReceipt({ hash: depositHash });

      if (payout.feeTransaction) {
        const feeHash = await sendTransactionAsync({
          to: payout.feeTransaction.to,
          data: payout.feeTransaction.data,
          value: BigInt(payout.feeTransaction.value ?? "0"),
        });
        await publicClient?.waitForTransactionReceipt({ hash: feeHash });
      }

      const confirmed = await confirmBrebPayoutRequest({
        payoutId: payout.payoutId,
        txHash: depositHash as Hex,
        userAddress,
      });
      setPayout(confirmed);
      setTxHash(depositHash);
      setStep("done");
    } catch (payError) {
      setError(getBrebErrorMessage(payError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col">
      <button
        type="button"
        onClick={onBack}
        className="mb-3 inline-flex w-fit items-center gap-1 rounded-full bg-white px-3 py-2 text-sm font-semibold text-[#66736B] shadow-sm"
      >
        <ChevronRight className="h-4 w-4 rotate-180" />
        Volver
      </button>

      {step === "form" && (
        <div className="rounded-[8px] border border-[#DDE4DC] bg-white p-4">
          <h2 className="text-lg font-semibold">Gastar en Colombia</h2>
          <p className="mt-1 text-sm text-[#66736B]">
            Envía COP a cualquier llave Bre-B. Mínimo {BREB_MIN_COP} COP.
          </p>

          <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-[#66736B]">
            Cuánto COP
          </label>
          <input
            value={amount}
            inputMode="numeric"
            onChange={(event) => {
              setAmount(cleanCopInput(event.target.value));
              setError(null);
            }}
            className="mt-1 h-12 w-full rounded-[8px] border border-[#DDE4DC] bg-[#F7F8F5] px-3 text-lg font-semibold outline-none focus:border-[#6D45B8]"
          />

          <div className="mt-3 grid grid-cols-2 gap-2">
            {(["USDC", "COPm"] as const).map((token) => {
              const item = token === "COPm" ? copm : usdc;
              return (
                <button
                  key={token}
                  type="button"
                  onClick={() => setFromToken(token)}
                  className={`rounded-[8px] border px-3 py-2 text-left ${
                    fromToken === token
                      ? "border-[#6D45B8] bg-[#E9DFFC]"
                      : "border-[#DDE4DC] bg-[#F7F8F5]"
                  }`}
                >
                  <p className="text-sm font-semibold">{token}</p>
                  <p className="text-[11px] text-[#66736B]">
                    {item?.balanceDisplay ?? "0"}
                  </p>
                </button>
              );
            })}
          </div>

          <div className="mt-3 rounded-[8px] bg-[#F7F8F5] p-3 text-sm">
            {quote ? (
              <>
                <p className="font-semibold">{quote.display}</p>
                <p className="mt-1 text-[#66736B]">
                  Pagas {sourceLabel ?? quote.sourceAmountUsd} USD
                </p>
                <ul className="mt-2 space-y-1 text-xs text-[#66736B]">
                  {quote.fees.map((fee) => (
                    <li key={fee.code}>
                      {FEE_LABELS[fee.code] ?? fee.code}: ${fee.amountUsd}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-[#66736B]">
                {quoteError ?? "Escribe un monto para ver la tasa."}
              </p>
            )}
            {quote && !hasEnough && (
              <p className="mt-2 text-xs font-medium text-[#8A1F1F]">
                Saldo insuficiente en {fromToken}.
              </p>
            )}
          </div>

          <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-[#66736B]">
            Nombre del titular
          </label>
          <input
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            placeholder="Ana Pérez"
            className="mt-1 h-11 w-full rounded-[8px] border border-[#DDE4DC] px-3 text-sm outline-none focus:border-[#6D45B8]"
          />

          <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-[#66736B]">
            Correo
          </label>
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="ana@correo.com"
            className="mt-1 h-11 w-full rounded-[8px] border border-[#DDE4DC] px-3 text-sm outline-none focus:border-[#6D45B8]"
          />

          <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-[#66736B]">
            Llave Bre-B
          </label>
          <input
            value={breBKey}
            onChange={(event) => setBreBKey(event.target.value)}
            placeholder="31234567890"
            className="mt-1 h-11 w-full rounded-[8px] border border-[#DDE4DC] px-3 text-sm outline-none focus:border-[#6D45B8]"
          />

          {!isConnected && (
            <p className="mt-3 text-xs font-medium text-[#92610a]">
              Conecta tu wallet para continuar.
            </p>
          )}
          {error && (
            <p className="mt-3 text-xs font-medium text-[#8A1F1F]">{error}</p>
          )}

          <Button
            className="mt-4 h-12 w-full rounded-[8px] bg-[#6D45B8] text-base font-semibold text-white hover:bg-[#56359A] disabled:bg-[#C8B9E8]"
            disabled={busy || !isConnected}
            onClick={() => void continueFromForm()}
          >
            {busy ? "Preparando..." : "Continuar"}
          </Button>
        </div>
      )}

      {step === "otp" && (
        <div className="rounded-[8px] border border-[#DDE4DC] bg-white p-4">
          <h2 className="text-lg font-semibold">Confirma tu correo</h2>
          <p className="mt-1 text-sm text-[#66736B]">
            Escribe el código de 6 dígitos que enviamos a {email}.
          </p>
          {debugCode && (
            <p className="mt-2 rounded-[8px] bg-[#FEFCE8] px-3 py-2 text-xs text-[#854D0E]">
              Mock: el código es {debugCode}
            </p>
          )}
          <input
            value={otp}
            inputMode="numeric"
            maxLength={6}
            onChange={(event) => setOtp(event.target.value.replace(/\D/g, ""))}
            className="mt-4 h-12 w-full rounded-[8px] border border-[#DDE4DC] bg-[#F7F8F5] px-3 text-center text-xl font-semibold tracking-[0.4em] outline-none focus:border-[#6D45B8]"
          />
          {error && (
            <p className="mt-3 text-xs font-medium text-[#8A1F1F]">{error}</p>
          )}
          <Button
            className="mt-4 h-12 w-full rounded-[8px] bg-[#6D45B8] text-base font-semibold text-white hover:bg-[#56359A] disabled:bg-[#C8B9E8]"
            disabled={busy || otp.length < 6}
            onClick={() => void handleVerifyOtp()}
          >
            {busy ? "Verificando..." : "Verificar"}
          </Button>
        </div>
      )}

      {step === "kyc" && (
        <div className="rounded-[8px] border border-[#DDE4DC] bg-white p-4">
          <h2 className="text-lg font-semibold">Verificación Bridge</h2>
          <p className="mt-1 text-sm text-[#66736B]">
            Completa Persona y los términos. Luego vuelve aquí.
          </p>
          <div className="mt-4 space-y-2">
            {kyc?.kycLink && (
              <a
                href={kyc.kycLink}
                target="_blank"
                rel="noreferrer"
                className="flex h-11 items-center justify-center rounded-[8px] bg-[#6D45B8] text-sm font-semibold text-white"
              >
                Abrir verificación
              </a>
            )}
            {kyc?.tosLink && (
              <a
                href={kyc.tosLink}
                target="_blank"
                rel="noreferrer"
                className="flex h-11 items-center justify-center rounded-[8px] bg-[#E9DFFC] text-sm font-semibold text-[#6D45B8]"
              >
                Aceptar términos
              </a>
            )}
          </div>
          {error && (
            <p className="mt-3 text-xs font-medium text-[#8A1F1F]">{error}</p>
          )}
          <Button
            className="mt-4 h-12 w-full rounded-[8px] bg-[#6D45B8] text-base font-semibold text-white hover:bg-[#56359A]"
            disabled={busy}
            onClick={() => void refreshKyc()}
          >
            {busy ? "Revisando..." : "Ya terminé"}
          </Button>
        </div>
      )}

      {step === "review" && payout && (
        <div className="rounded-[8px] border border-[#DDE4DC] bg-white p-4">
          <h2 className="text-lg font-semibold">Confirma el envío</h2>
          <div className="mt-4 rounded-[8px] bg-[#F7F8F5] p-3.5">
            <p className="text-xs font-medium uppercase tracking-wide text-[#66736B]">
              Vas a enviar
            </p>
            <p className="mt-1 text-2xl font-bold">
              {formatPesoAmountFromString(payout.destinationCop ?? amount)} COP
            </p>
            <p className="mt-1 text-sm text-[#66736B]">
              {payout.quote.display} · {sourceLabel}
            </p>
          </div>
          <div className="mt-3 rounded-[8px] bg-[#F7F8F5] p-3.5 text-sm">
            <p className="font-semibold">
              {payout.destinationPreview?.accountOwnerName ?? fullName}
            </p>
            {payout.destinationPreview?.bankName && (
              <p className="text-[#66736B]">{payout.destinationPreview.bankName}</p>
            )}
            <p className="text-xs text-[#66736B]">
              Llave ···{payout.breBKeyLast4 ?? breBKey.slice(-4)}
            </p>
          </div>
          {payout.feeTransaction && (
            <p className="mt-3 text-xs text-[#66736B]">
              MiniPay pedirá 2 confirmaciones: depósito y fee COP By.
            </p>
          )}
          {error && (
            <p className="mt-3 text-xs font-medium text-[#8A1F1F]">{error}</p>
          )}
          <Button
            className="mt-4 h-12 w-full rounded-[8px] bg-[#6D45B8] text-base font-semibold text-white hover:bg-[#56359A] disabled:bg-[#C8B9E8]"
            disabled={busy}
            onClick={() => void pay()}
          >
            {busy ? "Confirma en tu wallet" : "Pagar"}
          </Button>
        </div>
      )}

      {step === "done" && (
        <div className="rounded-[8px] border border-[#DDE4DC] bg-white p-4">
          <h2 className="text-lg font-semibold">Envío en camino</h2>
          <p className="mt-2 text-sm text-[#66736B]">
            {formatPesoAmountFromString(payout?.destinationCop ?? amount)} COP para{" "}
            {payout?.destinationPreview?.accountOwnerName ?? fullName}.
          </p>
          <p className="mt-2 text-xs font-semibold text-[#0E7C4F]">
            {payout?.status === "deposit_verified"
              ? "Depósito confirmado"
              : "Esperando depósito"}
          </p>
          {txHash && (
            <a
              href={`${explorerUrl}/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block text-sm font-semibold text-[#6D45B8] underline-offset-2 hover:underline"
            >
              Ver transacción
            </a>
          )}
          <Button
            className="mt-4 h-12 w-full rounded-[8px] bg-[#6D45B8] text-base font-semibold text-white hover:bg-[#56359A]"
            onClick={onBack}
          >
            Listo
          </Button>
        </div>
      )}
    </div>
  );
}
