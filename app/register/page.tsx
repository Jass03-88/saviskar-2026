import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft, ArrowUpRight } from "lucide-react";
import RegistrationForm from "@/components/registration/RegistrationForm";

function RegistrationFormLoading() {
  return (
    <section className="px-6 py-24 md:px-10">
      <div className="mx-auto max-w-[1200px]">
        <p className="text-sm text-black/40">Loading registration...</p>
      </div>
    </section>
  );
}

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const params = await searchParams;
  const fromAdmin = params.from === "admin";
  return (
    <main className="min-h-screen bg-[#f5f5f7] text-black">
      {/* Top Navigation */}
      <header className="px-6 py-7 md:px-10">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between">
          {fromAdmin ? (
  <Link
    href="/admin"
    className="flex items-center gap-2 text-sm text-black/45 transition hover:text-black"
  >
    <ArrowLeft size={15} />
    Back to Admin
  </Link>
) : (
  <Link
    href="/"
    className="flex items-center gap-2 text-sm text-black/45 transition hover:text-black"
  >
    <ArrowLeft size={15} />
    Saviskar
  </Link>
)}

          <span className="text-[11px] font-semibold uppercase tracking-[0.2em]">
            Registration
          </span>

          <Link
            href="/events"
            className="hidden items-center gap-1 text-sm text-black/45 transition hover:text-black sm:flex"
          >
            Events
            <ArrowUpRight size={14} />
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="px-6 pb-20 pt-20 md:px-10 md:pb-28 md:pt-28">
        <div className="mx-auto max-w-[1200px]">
          <p className="mb-7 text-[11px] font-semibold uppercase tracking-[0.24em] text-black/35">
            Saviskar 2026
          </p>

          <h1 className="max-w-[1000px] text-[clamp(4.2rem,10vw,10rem)] font-semibold leading-[0.82] tracking-[-0.075em]">
            Your stage
            <br />
            starts here.
          </h1>

          <div className="mt-12 flex justify-end">
            <p className="max-w-md text-base leading-7 text-black/45">
              Choose your event, enter your details and get ready to become
              part of Saviskar 2026.
            </p>
          </div>
        </div>
      </section>

      {/* Form */}
      <Suspense fallback={<RegistrationFormLoading />}>
        <RegistrationForm />
      </Suspense>

      {/* Bottom */}
      <section className="bg-black px-6 py-20 text-white md:px-10">
        <div className="mx-auto flex max-w-[1200px] flex-col gap-8 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="mb-4 text-[10px] uppercase tracking-[0.22em] text-white/35">
              Need help?
            </p>

            <h2 className="text-3xl font-semibold tracking-[-0.04em] md:text-5xl">
              We&apos;ve got you.
            </h2>
          </div>

          <p className="max-w-sm text-sm leading-6 text-white/40">
            Registration support and official coordinator contact details will
            be added once the Saviskar 2026 information is finalized.
          </p>
        </div>
      </section>
    </main>
  );
}