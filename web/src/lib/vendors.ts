export interface KnownVendor {
  name: string;
  aliases: string[];
  address: string;
}

/** Normalize / pad a hex address-like string into a 0x + 64 hex form when possible. */
export function normalizeSuiAddress(input: string): string | null {
  const cleaned = input.trim().toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]+$/.test(cleaned)) {
    return null;
  }
  if (cleaned.length > 64) {
    return null;
  }
  return `0x${cleaned.padStart(64, "0")}`;
}
