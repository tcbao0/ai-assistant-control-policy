/** In-memory sliding window. Fine for a single Next.js process (local demo / one instance). */

type Bucket = { timestamps: number[] };

const buckets = new Map<string, Bucket>();

export function clientKey(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "local";
}

export function allowRequest(key: string, limit: number, windowMs: number, now = Date.now()): {
  ok: boolean;
  retryAfterSec: number;
  remaining: number;
} {
  const start = now - windowMs;
  const bucket = buckets.get(key) ?? { timestamps: [] };
  bucket.timestamps = bucket.timestamps.filter((time) => time > start);
  if (bucket.timestamps.length >= limit) {
    const retryAfterSec = Math.max(1, Math.ceil((bucket.timestamps[0]! + windowMs - now) / 1000));
    buckets.set(key, bucket);
    return { ok: false, retryAfterSec, remaining: 0 };
  }
  bucket.timestamps.push(now);
  buckets.set(key, bucket);
  if (buckets.size > 2_000) prune(now - windowMs);
  return { ok: true, retryAfterSec: 0, remaining: limit - bucket.timestamps.length };
}

export function limitFor(method: string, pathname: string): { limit: number; windowMs: number } {
  const windowMs = 60_000;
  if (method === "GET" && pathname === "/api/chat") return { limit: 12, windowMs };
  if (method === "GET" && pathname === "/api/workspace") return { limit: 30, windowMs };
  if (method === "GET") return { limit: 40, windowMs };
  if (pathname === "/api/chat" || pathname.startsWith("/api/chat/")) return { limit: 15, windowMs };
  return { limit: 40, windowMs };
}

function prune(cutoff: number) {
  for (const [key, bucket] of buckets) {
    bucket.timestamps = bucket.timestamps.filter((time) => time > cutoff);
    if (bucket.timestamps.length === 0) buckets.delete(key);
  }
}
