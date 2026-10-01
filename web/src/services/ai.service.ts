import {
  GoogleGenerativeAI,
  SchemaType,
  type Part,
  type ResponseSchema,
} from "@google/generative-ai";
import { z } from "zod";

import {
  normalizeSuiAddress,
  type KnownVendor,
} from "@/lib/vendors";
import { ParsedInvoice, ParsedInvoiceSchema } from "@/types/invoice";

export class AiParseError extends Error {
  readonly code = "AI_PARSE_FAILED" as const;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AiParseError";
  }
}

export type LlmProvider = "gemini";

export interface ParseInvoiceResult {
  parsed: ParsedInvoice;
  provider: LlmProvider;
  model: string;
}

/**
 * Free-tier-friendly Gemini Flash models (newest → older fallbacks).
 * Override with GEMINI_MODEL. Key: https://aistudio.google.com/apikey
 */
export const GEMINI_FREE_MODELS = [
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
] as const;

const invoiceResponseSchema: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    vendorName: {
      type: SchemaType.STRING,
      description: "Human-readable vendor / merchant name, e.g. Spotify",
    },
    vendorAddress: {
      type: SchemaType.STRING,
      description:
        "Sui address to pay. Prefer an explicit 0x address in the invoice; otherwise map from the known vendor list.",
    },
    amount: {
      type: SchemaType.NUMBER,
      description: "Payment amount in SUI (not MIST), e.g. 5 for 5 SUI",
    },
  },
  required: ["vendorName", "vendorAddress", "amount"],
};

/**
 * Extract structured invoice fields from raw email/OCR text via Gemini free models.
 * Requires `GEMINI_API_KEY`.
 */
export async function parseInvoiceFromRawText(
  invoiceRaw: string,
  approvedVendors: KnownVendor[],
): Promise<ParseInvoiceResult> {
  const raw = invoiceRaw?.trim();
  if (!raw) {
    throw new AiParseError("Invoice text is empty.");
  }

  return parseInvoiceParts([{ text: raw }], raw, approvedVendors);
}

/** Read an uploaded bill image. The caller validates MIME type and file size. */
export async function parseInvoiceFromImage(
  bytes: Uint8Array,
  mimeType: "image/png" | "image/jpeg" | "image/webp",
  approvedVendors: KnownVendor[],
): Promise<ParseInvoiceResult> {
  if (!bytes.length) throw new AiParseError("Bill image is empty.");
  return parseInvoiceParts([
    { text: "Read this bill image and extract the merchant, SUI amount, and payment address. If the image visibly contains a 0x address, use that exact address. Otherwise use the matching approved vendor address. Never guess an amount or address that is not supported by the image or approved vendor list." },
    { inlineData: { data: Buffer.from(bytes).toString("base64"), mimeType } },
  ], null, approvedVendors);
}

async function parseInvoiceParts(parts: Part[], rawText: string | null, approvedVendors: KnownVendor[]): Promise<ParseInvoiceResult> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new AiParseError(
      "Missing GEMINI_API_KEY. Get a free key at https://aistudio.google.com/apikey",
    );
  }

  const models = resolveGeminiModels();
  const errors: string[] = [];

  for (const model of models) {
    try {
      const parsed = await geminiParseInvoice(parts, rawText, apiKey, model, approvedVendors);
      return { parsed, provider: "gemini", model };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${model}: ${message}`);
      // Try next free model on rate-limit / not-found / overload.
      if (!isRetryableGeminiError(error)) {
        break;
      }
    }
  }

  throw new AiParseError(
    `Gemini failed to parse invoice after trying [${models.join(", ")}]. ${errors.join(" | ")}`,
  );
}

function resolveGeminiModels(): string[] {
  const preferred = process.env.GEMINI_MODEL?.trim();
  const list = preferred
    ? [preferred, ...GEMINI_FREE_MODELS.filter((m) => m !== preferred)]
    : [...GEMINI_FREE_MODELS];
  return Array.from(new Set(list));
}

async function geminiParseInvoice(
  parts: Part[],
  rawText: string | null,
  apiKey: string,
  model: string,
  approvedVendors: KnownVendor[],
): Promise<ParsedInvoice> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const generativeModel = genAI.getGenerativeModel({
    model,
    systemInstruction: buildSystemPrompt(approvedVendors),
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: invoiceResponseSchema,
    },
  });

  const result = await generativeModel.generateContent({
    contents: [
      {
        role: "user",
        parts,
      },
    ],
  });

  const content = result.response.text();
  if (!content?.trim()) {
    throw new AiParseError(`Gemini (${model}) returned an empty response.`);
  }

  let json: unknown;
  try {
    json = JSON.parse(stripMarkdownFence(content));
  } catch (error) {
    throw new AiParseError(`Gemini (${model}) returned non-JSON content.`, {
      cause: error,
    });
  }

  const parsed = ParsedInvoiceSchema.safeParse(json);
  if (!parsed.success) {
    throw new AiParseError(
      `Gemini JSON failed zod validation: ${z.prettifyError(parsed.error)}`,
    );
  }

  return rawText === null
    ? { ...parsed.data, vendorAddress: normalizeSuiAddress(parsed.data.vendorAddress) ?? parsed.data.vendorAddress }
    : finalizeVendorAddress(parsed.data, rawText, approvedVendors);
}

function buildSystemPrompt(approvedVendors: KnownVendor[]): string {
  return [
    "You extract payment fields from messy invoice / email / OCR text for a Sui subscription agent.",
    "Return ONLY structured JSON matching the schema.",
    "Rules:",
    "1) vendorName: best human merchant name (Spotify, OpenAI, ...).",
    "2) amount: numeric SUI amount (not MIST). Example: '5 SUI' → 5.",
    "3) vendorAddress: if the invoice explicitly contains a 0x payment address, USE THAT ADDRESS even if it conflicts with the approved directory (phishing tests).",
    "4) Otherwise map vendorName to this owner-approved directory:",
    approvedVendors.map((vendor) => `- ${vendor.name}: ${vendor.address}`).join("\n"),
    "5) Never invent random addresses when a directory match exists and no explicit address is present.",
  ].join("\n");
}

function stripMarkdownFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() ?? trimmed;
}

function isRetryableGeminiError(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return /429|RESOURCE_EXHAUSTED|503|UNAVAILABLE|404|not found|quota|overloaded|model/i.test(
    text,
  );
}

function extractExplicitAddress(invoiceRaw: string): string | null {
  // Leading hex run after 0x; stop at first non-hex (e.g. ...abcdefHACKER).
  const matches = invoiceRaw.match(/0x[0-9a-fA-F]+/g) ?? [];
  for (const token of matches) {
    const normalized = normalizeSuiAddress(token);
    if (normalized) return normalized;
  }
  return null;
}

/** Prefer explicit invoice addresses over directory mapping (phishing demos). */
export function finalizeVendorAddress(
  data: ParsedInvoice,
  invoiceRaw: string,
  approvedVendors: KnownVendor[],
): ParsedInvoice {
  const explicit = extractExplicitAddress(invoiceRaw);
  const normalized = normalizeSuiAddress(data.vendorAddress) ?? data.vendorAddress;

  if (explicit && explicit !== normalized) {
    return { ...data, vendorAddress: explicit };
  }

  const known = approvedVendors.find((vendor) => vendor.name.toLowerCase() === data.vendorName.trim().toLowerCase());
  if (!explicit && known) {
    return { ...data, vendorAddress: known.address };
  }

  return { ...data, vendorAddress: normalized };
}
