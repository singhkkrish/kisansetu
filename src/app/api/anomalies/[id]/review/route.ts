import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeRequest, jsonError, readJsonBody } from "@/lib/api/http";
import { paymentErrorResponse } from "@/lib/api/payment-errors";

const schema = z.strictObject({
  action: z.enum(["reviewed", "confirmed", "false_positive", "note"]),
  note: z.string().trim().max(500).optional(),
});

/**
 * A manager reviews one anomaly. This changes the flag only: it never approves,
 * rejects or pays the purchase. The database audits every action.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeRequest("anomalies:review");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return jsonError(404, "Not found");

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = schema.safeParse(body.data);
  if (!parsed.success) return jsonError(422, "Some of the details are not valid");

  const { action, note } = parsed.data;
  if (action !== "reviewed" && (note ?? "").length < 5) {
    return jsonError(422, "A note of at least 5 characters is required", { note: "Write a note" });
  }

  const { error } = await auth.supabase.rpc("review_anomaly", { p_flag_id: id, p_action: action, p_note: note ?? null });
  if (error) return paymentErrorResponse(error);
  return NextResponse.json({ id, action });
}
