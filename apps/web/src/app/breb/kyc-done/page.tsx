import Link from "next/link";

export default function BrebKycDonePage() {
  return (
    <main className="min-h-[calc(100vh-3rem)] bg-[#F7F8F5] text-[#17211B]">
      <section className="mx-auto w-full max-w-md px-4 py-10 sm:max-w-lg">
        <div className="rounded-[8px] border border-[#DDE4DC] bg-white p-5">
          <h1 className="text-xl font-semibold">Verificación enviada</h1>
          <p className="mt-2 text-sm text-[#66736B]">
            Ya puedes volver a COP By y continuar el envío a tu cuenta.
          </p>
          <Link
            href="/?mode=spend"
            className="mt-5 inline-flex h-12 w-full items-center justify-center rounded-[8px] bg-[#6D45B8] text-base font-semibold text-white"
          >
            Volver a Gastar
          </Link>
        </div>
      </section>
    </main>
  );
}
