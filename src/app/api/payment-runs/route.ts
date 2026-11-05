import { NextResponse } from "next/server";
import { authorizeRequest, jsonError, readJsonBody } from "@/lib/api/http";
import { paymentErrorResponse } from "@/lib/api/payment-errors";
import { createRunSchema } from "@/lib/payments/schemas";

/**
 * Generates a payment run. The caller chooses only dates and centres; the
 * database picks the entries, groups them by farmer, totals them and locks them
 * so they cannot be put in a second run.
 */
export async function POST(request: Request) {
  const auth = await authorizeRequest("payment_runs:create");
  if (!auth.ok) return auth.response;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = createRunSchema.safeParse(body.data);
  if (!parsed.success) return jsonError(422, "Choose a date range and at least one centre");

  const { data, error } = await auth.supabase.rpc("create_payment_run", {
    p_from: parsed.data.from,
    p_to: parsed.data.to,
    p_centre_ids: parsed.data.centreIds,
  });
  if (error) return paymentErrorResponse(error);
  return NextResponse.json(data, { status: 201 });
}
