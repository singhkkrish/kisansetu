import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeRequest, jsonError, readJsonBody } from "@/lib/api/http";
import { paymentErrorResponse } from "@/lib/api/payment-errors";

const reviewSchema = z.strictObject({
  decision: z.enum(["approve", "hold", "reject"]),
  note: z.string().trim().max(500).optional(),
});

/**
 * Approve, hold or reject an entry. Office managers only. This is the single
 * way an entry's approval changes: purchase figures are immutable, and the
 * database records who made each change and why.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeRequest("procurement:approve");
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return jsonError(404, "Not found");

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = reviewSchema.safeParse(body.data);
  if (!parsed.success) return jsonError(422, "Some of the details are not valid");

  const { decision, note } = parsed.data;
  if (decision !== "approve" && (note ?? "").length < 5) {
    return jsonError(422, "A reason of at least 5 characters is required", { note: "Write a reason" });
  }

  const { error } = await auth.supabase.rpc("review_entry", {
    p_id: id,
    p_decision: decision,
    p_note: note ?? null,
  });
  if (error) return paymentErrorResponse(error);

  return NextResponse.json({ id, decision });
}
