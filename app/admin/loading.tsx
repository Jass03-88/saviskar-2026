export default function AdminLoading() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f5f5]">
      <div className="text-center">
        <div className="mx-auto mb-5 h-8 w-8 animate-spin rounded-full border-[3px] border-black/10 border-t-black" />
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-black/30">
          Loading
        </p>
      </div>
    </main>
  );
}
