import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function shortenAddress(address: string, size = 4): string {
  if (address.length <= size * 2 + 2) return address;
  return `${address.slice(0, size + 2)}…${address.slice(-size)}`;
}

export function shortenDigest(digest: string, size = 8): string {
  if (digest.length <= size * 2) return digest;
  return `${digest.slice(0, size)}…${digest.slice(-size)}`;
}
