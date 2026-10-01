import { createHash, randomBytes } from "node:crypto";
import { verifyPersonalMessageSignature } from "@mysten/sui/verify";
import type { NextRequest } from "next/server";
import { challenges, sessions } from "@/services/mongo.service";
import { getReadOnlySuiClient } from "@/services/sui.service";

export const SESSION_COOKIE = "subscription_session";
const SESSION_MS = 24 * 60 * 60 * 1000;
function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }

export function sessionCookie(maxAge: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge,
  };
}

export async function logoutSession(token: string | undefined) {
  if (!token) return;
  await (await sessions()).deleteOne({ tokenHash: hash(token) });
}

export async function createChallenge(address: string, origin: string) {
  const nonce = randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + 5 * 60_000);
  const message = `Subscription Manager login\nOrigin: ${origin}\nAddress: ${address}\nNonce: ${nonce}\nExpires: ${expiresAt.toISOString()}`;
  await (await challenges()).insertOne({ address: address.toLowerCase(), nonce, message, expiresAt });
  return { nonce, message };
}

export async function verifyChallenge(address: string, nonce: string, signature: string) {
  const challenge = await (await challenges()).findOneAndDelete({
    address: address.toLowerCase(), nonce, expiresAt: { $gt: new Date() },
  });
  if (!challenge) throw new Error("Challenge expired or already used");
  await verifyPersonalMessageSignature(new TextEncoder().encode(challenge.message), signature, {
    client: getReadOnlySuiClient(),
    address: address.toLowerCase(),
  });
  const token = randomBytes(32).toString("hex");
  await (await sessions()).insertOne({ tokenHash: hash(token), owner: address.toLowerCase(), expiresAt: new Date(Date.now() + SESSION_MS) });
  return token;
}

export async function requireOwner(req: NextRequest): Promise<string> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) throw new Error("Sign in with the vault owner wallet");
  const session = await (await sessions()).findOne({ tokenHash: hash(token), expiresAt: { $gt: new Date() } });
  if (!session) throw new Error("Session expired or owner changed");
  return session.owner;
}

export function assertSameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) throw new Error("Cross-origin request rejected");
}
