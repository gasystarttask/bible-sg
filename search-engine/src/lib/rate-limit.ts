import { NextRequest } from "next/server";

type Entry = { count: number; resetAt: number };

const store = new Map<string, Entry>();

export function checkRateLimit(
  key: string,
  maxRequests = 30,
  windowMs = 60_000
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const existing = store.get(key);

  if (!existing || now > existing.resetAt) {
    const resetAt = now + windowMs;
    store.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: maxRequests - 1, resetAt };
  }

  if (existing.count >= maxRequests) {
    return { allowed: false, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count += 1;
  store.set(key, existing);

  return {
    allowed: true,
    remaining: Math.max(0, maxRequests - existing.count),
    resetAt: existing.resetAt,
  };
}

const WINDOW_MS = 60_000; // 1 minute
const MAX_REQUESTS = 20;  // max requests per window per IP

const ipRequestMap = new Map<string, number[]>();

export function rateLimit(req: NextRequest): { success: boolean } {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";

  const now = Date.now();
  const timestamps = (ipRequestMap.get(ip) ?? []).filter(
    (t) => now - t < WINDOW_MS
  );

  if (timestamps.length >= MAX_REQUESTS) {
    return { success: false };
  }

  timestamps.push(now);
  ipRequestMap.set(ip, timestamps);
  return { success: true };
}