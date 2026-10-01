export function amountMistFromCommand(command: string): bigint {
  const matches = [...command.matchAll(/([+-]?[0-9]+(?:[.,][0-9]+)?(?:e[+-]?[0-9]+)?)\s*SUI\b/gi)];
  if (matches.length !== 1) throw new Error("State exactly one amount, for example: Chuyển 0.5 SUI cho An");
  if (!/^[0-9]+(?:[.,][0-9]{1,9})?$/.test(matches[0][1])) throw new Error("Amount must be a positive decimal with at most 9 places");
  const decimal = matches[0][1].replace(",", ".");
  const [whole, fraction = ""] = decimal.split(".");
  const mist = BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, "0"));
  if (mist <= 0n || mist > 18_446_744_073_709_551_615n) throw new Error("Transfer amount is outside the Sui u64 range");
  return mist;
}
