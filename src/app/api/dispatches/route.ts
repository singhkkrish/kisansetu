import { NextResponse } from "next/server";
import { authorizeRequest, jsonError, readJsonBody } from "@/lib/api/http";
import { paymentErrorResponse } from "@/lib/api/payment-errors";
import { dispatchSchema } from "@/lib/payments/schemas";

/** Records a dispatch. Stock before and after are worked out inside the database, under a lock. */
export async function POST(request: Request) {
  const auth = await authorizeRequest("dispatch:write");
  if (!auth.ok) return auth.response;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = dispatchSchema.safeParse(body.data);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0] ?? "form")] ??= issue.message;
    return jsonError(422, "Some of the details are not valid", fieldErrors);
  }

  const v = parsed.data;
  const { data, error } = await auth.supabase.rpc("record_dispatch", {
    p_centre: v.centreId,
    p_crop: v.crop,
    p_weight: v.weightKg,
    p_book: v.bookKg ?? v.weightKg,
    p_destination: v.destination,
    p_truck: v.truckNo,
    p_dispatched_at: v.dispatchedAt ?? null,
  });
  if (error) return paymentErrorResponse(error);
  return NextResponse.json(data, { status: 201 });
}
