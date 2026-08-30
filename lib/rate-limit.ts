/**
 * In-memory sliding window rate limiter helper.
 *
 * NOTE ON DISTRIBUTED PRODUCTION LIMITATIONS:
 * This in-memory rate limiter operates per Node.js / serverless container instance.
 * For true distributed multi-region rate limiting on Vercel Edge/Serverless,
 * an external distributed store (e.g. Upstash Redis / Vercel KV) would be required.
 * Within a single instance/container, this provides robust throttling against burst attacks.
 */

import { NextRequest } from "next/server";

type RateLimitEntry = {
  count: number;
  resetAt: number;
};

// Global rate limit store across hot reloads in dev
const rateLimitStore = new Map<string, RateLimitEntry>();

const CLEANUP_INTERVAL_MS = 60 * 1000;
let lastCleanup = Date.now();

export function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp?.trim()) return realIp.trim();
  return "127.0.0.1";
}

export function checkRateLimit(
  key: string,
  maxRequests: number = 20,
  windowMs: number = 60 * 1000
): { allowed: boolean; retryAfter: number } {
  const now = Date.now();

  // Periodic garbage collection of expired buckets
  if (now - lastCleanup > CLEANUP_INTERVAL_MS) {
    lastCleanup = now;
    for (const [k, entry] of rateLimitStore) {
      if (entry.resetAt <= now) {
        rateLimitStore.delete(k);
      }
    }
  }

  const current = rateLimitStore.get(key);

  if (!current || current.resetAt <= now) {
    rateLimitStore.set(key, {
      count: 1,
      resetAt: now + windowMs,
    });
    return { allowed: true, retryAfter: 0 };
  }

  if (current.count >= maxRequests) {
    return {
      allowed: false,
      retryAfter: Math.max(1, Math.ceil((current.resetAt - now) / 1000)),
    };
  }

  current.count += 1;
  return { allowed: true, retryAfter: 0 };
}

export function resetRateLimitStore(): void {
  rateLimitStore.clear();
}
