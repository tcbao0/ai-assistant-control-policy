export const MAX_BILL_IMAGE_BYTES = 8 * 1024 * 1024;
export type BillImageMime = "image/png" | "image/jpeg" | "image/webp";

export function validateBillImage(bytes: Uint8Array, mimeType: string): asserts mimeType is BillImageMime {
  if (!bytes.length) throw new Error("Bill image is empty");
  if (bytes.length > MAX_BILL_IMAGE_BYTES) throw new Error("Bill image must be 8 MB or smaller");
  const png = bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const webp = bytes.length >= 12 && [82, 73, 70, 70].every((value, index) => bytes[index] === value) &&
    [87, 69, 66, 80].every((value, index) => bytes[index + 8] === value);
  if (!((mimeType === "image/png" && png) || (mimeType === "image/jpeg" && jpeg) || (mimeType === "image/webp" && webp))) {
    throw new Error("Upload a valid PNG, JPEG, or WebP bill image");
  }
}
