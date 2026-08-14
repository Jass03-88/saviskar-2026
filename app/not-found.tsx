import Link from "next/link";

export default function NotFound() {
  return (
    <main
      className="flex min-h-screen items-center justify-center bg-[#f5f5f7] px-6"
    >
      <div className="text-center">
        <p className="mb-6 text-[10px] font-semibold uppercase tracking-[0.2em] text-black/35">
          Saviskar 2026
        </p>

        <h1 className="text-[clamp(3rem,8vw,6rem)] font-semibold leading-none tracking-[-0.06em] text-black">
          404
        </h1>

        <p className="mt-4 text-sm leading-7 text-black/45">
          The page you&apos;re looking for doesn&apos;t exist.
        </p>

        <Link
          href="/"
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-black px-7 py-3.5 text-sm font-medium text-white transition hover:scale-[1.03]"
        >
          Back to home
        </Link>
      </div>
    </main>
  );
}
