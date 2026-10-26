import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  compress: true,
  poweredByHeader: false,
  images: {
    formats: ["image/avif", "image/webp"],
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    imageSizes: [16, 32, 48, 64, 96, 128, 256, 384],
    remotePatterns: [
      {
        protocol: "https",
        hostname: "img.youtube.com",
      },
      {
        protocol: "https",
        hostname: "i.ytimg.com",
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
      {
        protocol: "https",
        hostname: "drive.google.com",
      },
    ],
  },
  ...(process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_SUPABASE_URL
    ? {
        env: {
          NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || "",
          NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
        },
      }
    : {}),
  async headers() {
    const isLocalSupabase =
      process.env.NODE_ENV === "development" &&
      Boolean(
        process.env.NEXT_PUBLIC_SUPABASE_URL?.includes("127.0.0.1:54321") ||
        process.env.NEXT_PUBLIC_SUPABASE_URL?.includes("localhost:54321")
      );
    const localConnectSrc = isLocalSupabase ? " http://127.0.0.1:* ws://127.0.0.1:* http://localhost:* ws://localhost:*" : "";
    const localImgSrc = isLocalSupabase ? " http://127.0.0.1:* http://localhost:*" : "";

    const cspHeader = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      `img-src 'self' data: blob: https://*.supabase.co https://img.youtube.com https://i.ytimg.com https://lh3.googleusercontent.com https://drive.google.com${localImgSrc}`,
      `connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.resend.com https://secure.payu.in https://test.payu.in https://info.payu.in https://api.payu.in https://*.payu.in https://payu.in${localConnectSrc}`,
      "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://secure.payu.in https://test.payu.in https://api.payu.in https://*.payu.in https://payu.in",
      "worker-src 'self' blob:",
      "object-src 'none'",
      "base-uri 'self'",
      // Critical for PayU hosted checkout: permits browser form POST to PayU gateways and redirects to api.payu.in
      "form-action 'self' https://secure.payu.in https://test.payu.in https://api.payu.in https://*.payu.in https://payu.in https://*.payubiz.in https://payubiz.in https://*.payumoney.com https://payumoney.com",
    ].join("; ");

    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: cspHeader,
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(), geolocation=(), payment=(self)",
          },
          {
            key: "X-DNS-Prefetch-Control",
            value: "on",
          },
        ],
      },
      // Long-lived immutable cache for public image and video directories.
      // Next.js handles /_next/static/ automatically; these patterns cover
      // /public/images/, /public/PreLoader/, and static root media.
      // max-age=31536000 (1 year) + immutable: browser never revalidates static assets.
      {
        source: "/images/(.*)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/PreLoader/(.*)",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/logo.png",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
