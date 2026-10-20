import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AdminSessionWatcher } from "@/components/admin/AdminSessionWatcher";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default function AdminLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="admin-root selection:bg-[#2563EB] selection:text-white min-h-screen" data-admin-root>
      <AdminSessionWatcher />
      {children}
    </div>
  );
}