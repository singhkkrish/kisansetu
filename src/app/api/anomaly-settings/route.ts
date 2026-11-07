import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeRequest, jsonError, readJsonBody } from "@/lib/api/http";
import { paymentErrorResponse } from "@/lib/api/payment-errors";

const schema = z.strictObject({
  key: z.string().regex(/^[a-z_]{3,60}$/),
  value: z.number().finite(),
});

/** Changes one anomaly threshold. Managers only; the database range-checks and logs it. */
export async function POST(request: Request) {
  const auth = await authorizeRequest("anomalies:review");
  if (!auth.ok) return auth.response;
  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = schema.safeParse(body.data);
  if (!parsed.success) return jsonError(422, "Some of the details are not valid");
  const { error } = await auth.supabase.rpc("update_anomaly_setting", { p_key: parsed.data.key, p_value: parsed.data.value });
  if (error) return paymentErrorResponse(error);
  return NextResponse.json({ key: parsed.data.key, value: parsed.data.value });
}
