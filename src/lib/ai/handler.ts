import { NextResponse } from "next/server";
import { createAnthropicVision, readAiConfig, type VisionCall } from "@/lib/ai/anthropic";
import { MAX_IMAGE_BYTES } from "@/lib/ai/image";
import { allowRequest } from "@/lib/ai/rate-limit";
import { readDisplay } from "@/lib/ai/read-display";
import { DISPLAY_KINDS, type DisplayKind, type ReadingResult } from "@/lib/ai/schemas";
import { authorizeRequest, jsonError } from "@/lib/api/http";

const NO_STORE = { "cache-control": "no-store" };

function respond(result: ReadingResult, status = 200) {
  return NextResponse.json({ result }, { status, headers: NO_STORE });
}

/**
 * Operators upload a photo of a scale or moisture meter display and get back a
 * suggestion. The suggestion is only ever shown to the operator, who confirms or
 * corrects it; nothing here approves, saves or pays anything. The image is read
 * into memory, sent to the provider, and dropped.
 */
export async function handleReadDisplay(request: Request, vision: VisionCall = createAnthropicVision()) {
  const auth = await authorizeRequest("ai:read_display");
  if (!auth.ok) return auth.response;

  if (!readAiConfig()) return respond({ status: "failed", code: "not_configured" }, 503);
  if (!allowRequest(auth.user.userId)) return respond({ status: "failed", code: "rate_limited" }, 429);

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES + 100_000) return respond({ status: "failed", code: "too_large" }, 413);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(400, "Could not read the upload");
  }
  const kind = form.get("kind");
  if (typeof kind !== "string" || !(DISPLAY_KINDS as readonly string[]).includes(kind)) {
    return jsonError(422, "Choose scale or moisture");
  }
  const file = form.get("image");
  if (!(file instanceof Blob)) return respond({ status: "failed", kind: kind as DisplayKind, code: "invalid_image" }, 422);
  if (file.size > MAX_IMAGE_BYTES) return respond({ status: "failed", kind: kind as DisplayKind, code: "too_large" }, 413);

  const bytes = new Uint8Array(await file.arrayBuffer());
  return respond(await readDisplay(kind as DisplayKind, bytes, vision));
}
