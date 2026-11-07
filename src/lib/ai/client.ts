import { MAX_IMAGE_BYTES } from "@/lib/ai/image";
import { readingResultSchema, type DisplayKind, type ReadingResult } from "@/lib/ai/schemas";

const MAX_SIDE = 1600;

/**
 * Re-draws the photo onto a canvas before upload. That shrinks it and drops
 * everything that is not pixels, including EXIF data such as GPS location.
 */
export async function prepareImage(file: File): Promise<{ ok: true; blob: Blob } | { ok: false; code: "invalid_image" | "unsupported_format" | "too_large" }> {
  if (file.size === 0) return { ok: false, code: "invalid_image" };
  if (file.size > 25 * 1024 * 1024) return { ok: false, code: "too_large" };
  if (file.type && !file.type.startsWith("image/")) return { ok: false, code: "invalid_image" };
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return { ok: false, code: /heic|heif|gif|bmp|tiff/i.test(file.type) ? "unsupported_format" : "invalid_image" };
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.85, 0.7, 0.5]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= MAX_IMAGE_BYTES) return { ok: true, blob };
  }
  return { ok: false, code: "too_large" };
}

/** Sends the prepared image to our own server. The browser never sees the provider key. */
export async function requestReading(kind: DisplayKind, image: Blob, fetchImpl: typeof fetch = fetch): Promise<ReadingResult> {
  const body = new FormData();
  body.set("kind", kind);
  body.set("image", image, "display.jpg");
  try {
    const response = await fetchImpl("/api/ai/read-display", { method: "POST", body, credentials: "same-origin" });
    const json: unknown = await response.json().catch(() => null);
    const parsed = readingResultSchema.safeParse((json as { result?: unknown } | null)?.result);
    if (parsed.success) return parsed.data;
    return { status: "failed", kind, code: response.status === 401 || response.status === 403 ? "not_configured" : "api_error" };
  } catch {
    // No network (the phone is offline) or the request failed: the operator types the value.
    return { status: "failed", kind, code: "api_error" };
  }
}
