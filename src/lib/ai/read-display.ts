import type { VisionCall } from "@/lib/ai/anthropic";
import { sniffImage } from "@/lib/ai/image";
import { interpretModelOutput } from "@/lib/ai/interpret";
import type { DisplayKind, ReadingResult } from "@/lib/ai/schemas";

/**
 * Validates the image, asks the model, and interprets the answer. Whatever goes
 * wrong, the result says so; a value is never made up. Nothing is stored.
 */
export async function readDisplay(kind: DisplayKind, bytes: Uint8Array, vision: VisionCall): Promise<ReadingResult> {
  const sniffed = sniffImage(bytes);
  if (!sniffed.ok) return { status: "failed", kind, code: sniffed.code };

  const outcome = await vision({ kind, mediaType: sniffed.mediaType, base64: Buffer.from(bytes).toString("base64") });
  if (!outcome.ok) return { status: "failed", kind, code: outcome.code };
  return interpretModelOutput(kind, outcome.output);
}
