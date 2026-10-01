import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Collection } from "mongodb";
import { database } from "@/services/mongo.service";

const scrypt = promisify(scryptCallback);
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;

interface PasscodeRecord {
  owner: string;
  vaultId: string;
  salt: string;
  digest: string;
  failedAttempts: number;
  lockedUntil: Date | null;
  updatedAt: Date;
}

async function collection(): Promise<Collection<PasscodeRecord>> {
  const rows = (await database()).collection<PasscodeRecord>("owner_passcodes");
  await rows.createIndex({ owner: 1, vaultId: 1 }, { unique: true });
  return rows;
}

async function derive(passcode: string, salt: string): Promise<Buffer> {
  return await scrypt(passcode, Buffer.from(salt, "hex"), 64) as Buffer;
}

function assertLength(passcode: string): void {
  if (passcode.length < 12 || passcode.length > 128) {
    throw new Error("Passcode must contain 12–128 characters");
  }
}

export async function passcodeConfigured(owner: string, vaultId: string): Promise<boolean> {
  return !!await (await collection()).findOne({ owner, vaultId }, { projection: { _id: 1 } });
}

export async function createPasscode(owner: string, vaultId: string, passcode: string): Promise<void> {
  assertLength(passcode);
  const salt = randomBytes(32).toString("hex");
  const digest = (await derive(passcode, salt)).toString("hex");
  try {
    await (await collection()).insertOne({
      owner, vaultId, salt, digest, failedAttempts: 0, lockedUntil: null, updatedAt: new Date(),
    });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === 11000) {
      throw new Error("Passcode already exists; use change to update it");
    }
    throw error;
  }
}

export async function verifyPasscode(owner: string, vaultId: string, passcode: string): Promise<void> {
  const rows = await collection();
  const key = { owner, vaultId };
  const now = new Date();
  const existing = await rows.findOne(key);
  if (!existing) throw new Error("Create a passcode before managing recipients");
  if (existing.lockedUntil && existing.lockedUntil > now) {
    throw new Error("Too many attempts; try again in 15 minutes");
  }
  if (existing.lockedUntil && existing.lockedUntil <= now) {
    await rows.updateOne({ ...key, lockedUntil: { $lte: now } },
      { $set: { failedAttempts: 0, lockedUntil: null } });
  }
  // Reserve an attempt atomically so concurrent requests cannot bypass the limit.
  const record = await rows.findOneAndUpdate({ ...key, failedAttempts: { $lt: MAX_FAILURES }, lockedUntil: null },
    { $inc: { failedAttempts: 1 }, $set: { updatedAt: now } },
    { returnDocument: "after" });
  if (!record) throw new Error("Too many attempts; try again in 15 minutes");
  const submitted = await derive(passcode, record.salt);
  const expected = Buffer.from(record.digest, "hex");
  if (submitted.length !== expected.length || !timingSafeEqual(submitted, expected)) {
    if (record.failedAttempts >= MAX_FAILURES) {
      await rows.updateOne(key, { $set: { lockedUntil: new Date(Date.now() + LOCK_MS) } });
    }
    throw new Error("Incorrect passcode");
  }
  await rows.updateOne(key, { $set: { failedAttempts: 0, lockedUntil: null, updatedAt: new Date() } });
}

export async function changePasscode(owner: string, vaultId: string, current: string, next: string): Promise<void> {
  assertLength(next);
  await verifyPasscode(owner, vaultId, current);
  const salt = randomBytes(32).toString("hex");
  const digest = (await derive(next, salt)).toString("hex");
  await (await collection()).updateOne({ owner, vaultId }, {
    $set: { salt, digest, failedAttempts: 0, lockedUntil: null, updatedAt: new Date() },
  });
}
