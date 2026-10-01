import { NextRequest, NextResponse } from "next/server";

import { allowRequest, clientKey, limitFor } from "@/lib/rate-limit";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (!pathname.startsWith("/api/")) return NextResponse.next();
  const { limit, windowMs } = limitFor(req.method, pathname);
  const key = `${clientKey(req.headers)}:${req.method}:${pathname}`;
  const result = allowRequest(key, limit, windowMs);
  if (result.ok) return NextResponse.next();
  return NextResponse.json(
    { error: "Too many requests. Slow down and retry." },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfterSec),
        "cache-control": "no-store",
      },
    },
  );
}

export const config = {
  matcher: "/api/:path*",
};
