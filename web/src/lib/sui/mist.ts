const MIST_PER_SUI = 1_000_000_000n;

/**
 * Convert a human SUI amount to MIST (bigint) without float drift.
 * Accepts numbers like 5 or 5.5 (up to 9 decimal places).
 */
export function suiToMist(amountSui: number): bigint {
  if (!Number.isFinite(amountSui) || amountSui <= 0) {
    throw new Error(`Invalid SUI amount: ${amountSui}`);
  }

  const text = amountSui.toString();
  if (text.includes("e") || text.includes("E")) {
    // Scientific notation — fall back carefully via rounded integer MIST.
    const mist = Math.round(amountSui * 1e9);
    if (!Number.isSafeInteger(mist) || mist <= 0) {
      throw new Error(`SUI amount out of safe MIST range: ${amountSui}`);
    }
    return BigInt(mist);
  }

  const [wholeRaw, fracRaw = ""] = text.split(".");
  const whole = BigInt(wholeRaw);
  const fracPadded = `${fracRaw}000000000`.slice(0, 9);
  return whole * MIST_PER_SUI + BigInt(fracPadded);
}

export function mistToString(mist: bigint): string {
  return mist.toString();
}

/** Format MIST as a SUI decimal string with trailing zeros stripped. */
export function formatSuiFromMist(mist: string | bigint): string {
  let amount: bigint;
  try { amount = typeof mist === "bigint" ? mist : BigInt(mist); }
  catch { return "0"; }
  const negative = amount < 0n;
  if (negative) amount = -amount;
  const decimal = (amount % MIST_PER_SUI).toString().padStart(9, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${amount / MIST_PER_SUI}${decimal ? `.${decimal}` : ""}`;
}
