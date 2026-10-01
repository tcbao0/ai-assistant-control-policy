import { z } from "zod";

/**
 * Structured invoice extraction schema.
 * `amount` is human SUI (e.g. 5), converted to MIST on-chain later.
 */
export const ParsedInvoiceSchema = z.object({
  vendorName: z
    .string()
    .min(1)
    .describe("Human-readable vendor / merchant name, e.g. Spotify"),
  vendorAddress: z
    .string()
    .min(1)
    .describe(
      "Sui address to pay. Prefer an explicit 0x address in the invoice; otherwise map from the known vendor list.",
    ),
  amount: z
    .number()
    .positive()
    .describe("Payment amount in SUI (not MIST), e.g. 5 for 5 SUI"),
});

export type ParsedInvoice = z.infer<typeof ParsedInvoiceSchema>;
