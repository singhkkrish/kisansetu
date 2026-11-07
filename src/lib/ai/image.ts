export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const MIN_IMAGE_BYTES = 1024;

export type SniffedImage = { ok: true; mediaType: "image/jpeg" | "image/png" | "image/webp" } | { ok: false; code: "invalid_image" | "unsupported_format" | "too_large" };

/**
 * Decides what an upload really is from its first bytes. The type the browser
 * claims is ignored, so a renamed file cannot slip through.
 */
export function sniffImage(bytes: Uint8Array): SniffedImage {
  if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, code: "too_large" };
  if (bytes.length < MIN_IMAGE_BYTES) return { ok: false, code: "invalid_image" };
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { ok: true, mediaType: "image/jpeg" };
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return { ok: true, mediaType: "image/png" };
  const riff = String.fromCharCode(...bytes.slice(0, 4));
  const webp = String.fromCharCode(...bytes.slice(8, 12));
  if (riff === "RIFF" && webp === "WEBP") return { ok: true, mediaType: "image/webp" };
  // Recognisable but not accepted: GIF, HEIC/HEIF, BMP, TIFF, PDF.
  const head = String.fromCharCode(...bytes.slice(0, 12));
  if (/^(GIF8|BM|II\*|MM\0\*|%PDF)/.test(head) || head.slice(4, 8) === "ftyp") return { ok: false, code: "unsupported_format" };
  return { ok: false, code: "invalid_image" };
}
