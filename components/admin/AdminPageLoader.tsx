import React from "react";
import { BarChart3 } from "lucide-react";

interface AdminPageLoaderProps {
  heading: string;
  subtext: string;
}

export default function AdminPageLoader({
  heading,
  subtext,
}: AdminPageLoaderProps) {
  return (
    <main className="min-h-screen bg-[#f5f5f5] px-5 py-10 md:px-10 lg:px-16 flex items-center justify-center">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-black text-white shadow-xl animate-pulse">
          <BarChart3 size={26} className="animate-spin text-violet-400" />
        </div>
        <h2 className="text-xl font-bold tracking-tight text-black">
          {heading}
        </h2>
        <p className="text-xs text-black/45 max-w-sm">
          {subtext}
        </p>
      </div>
    </main>
  );
}
