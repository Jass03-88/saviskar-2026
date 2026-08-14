import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Saviskar 2026",
    template: "%s | Saviskar 2026",
  },
  description:
    "Official registration portal for Saviskar 2026 — the inter-college fest. Register for technical, cultural, non-technical and sports events.",
  metadataBase: new URL("https://saviskar-2026.vercel.app"),
  openGraph: {
    title: "Saviskar 2026",
    description:
      "Register for Saviskar 2026 — technical, cultural, non-technical and sports events.",
    siteName: "Saviskar 2026",
    type: "website",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        
        {children}
      </body>
    </html>
  );
}
