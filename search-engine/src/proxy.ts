import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@search/lib/rate-limit";

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (!forwarded) return "unknown";
  return forwarded.split(",")[0]?.trim() || "unknown";
}

export function proxy(req: NextRequest) {
  if (!req.nextUrl.pathname.startsWith("/api")) {
    return NextResponse.next();
  }

  const ip = getClientIp(req);
  const rate = checkRateLimit(ip, 30, 60_000);

  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: {
          "X-RateLimit-Remaining": String(rate.remaining),
          "X-RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)),
        },
      }
    );
  }

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-ratelimit-remaining", String(rate.remaining));
  requestHeaders.set("x-ratelimit-reset", String(rate.resetAt));
  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

export const config = {
  matcher: ["/api/:path*"],
};