import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeRequest, jsonError, readJsonBody } from "@/lib/api/http";
import { paymentErrorResponse } from "@/lib/api/payment-errors";
import { simulateSchema } from "@/lib/payments/schemas";

/**
 * Simulated bank response: marks payments as paid or failed. There is no bank
 * behind this; it lets the office try both outcomes. Only payments of this run
 * that were sent to the bank (processing) can be settled.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeRequest("payment_runs:approve");
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return jsonError(404, "Not found");

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = simulateSchema.safeParse(body.data);
  if (!parsed.success) return jsonError(422, "Choose the payments and an outcome. A failure needs a reason", { reason: "Choose a reason" });

  // The items must belong to the run in the URL.
  const itemIds = [...new Set(parsed.data.itemIds)];
  const { data: owned } = await auth.supabase.from("payment_items").select("id").eq("run_id", id).in("id", itemIds);
  if ((owned ?? []).length !== itemIds.length) return jsonError(404, "Not found");

  const { data, error } = await auth.supabase.rpc("simulate_bank_response", {
    p_item_ids: itemIds,
    p_outcome: parsed.data.outcome,
    p_reason: parsed.data.outcome === "failed" ? parsed.data.reason : null,
  });
  if (error) return paymentErrorResponse(error);
  return NextResponse.json({ updated: data, outcome: parsed.data.outcome });
}
