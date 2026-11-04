import { NextResponse } from "next/server";
import { authorizeRequest, dbErrorResponse, jsonError, readJsonBody } from "@/lib/api/http";
import { istDate } from "@/lib/calculations/format";
import { effectiveDateProblem, saveDraftsSchema } from "@/lib/prices/price-board";
import { listPriceVersions } from "@/lib/services/prices";
import { CROPS, type Crop } from "@/types/domain";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Price history for office managers, newest first. */
export async function GET(request: Request) {
  const auth = await authorizeRequest("prices:write");
  if (!auth.ok) return auth.response;

  const params = new URL(request.url).searchParams;
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  const crop = params.get("crop") ?? "";
  if ((from && !DATE.test(from)) || (to && !DATE.test(to)) || (crop && !(CROPS as readonly string[]).includes(crop))) {
    return jsonError(422, "Some of the filters are not valid");
  }

  const { items, error } = await listPriceVersions(auth.supabase, { from, to, crop: crop as Crop | "" });
  if (error) return jsonError(500, "Could not load prices");
  return NextResponse.json({ items });
}

/**
 * Saves a day's board as unpublished drafts, all rows or none. Nothing here is
 * visible to operators until it is published.
 */
export async function POST(request: Request) {
  const auth = await authorizeRequest("prices:write");
  if (!auth.ok) return auth.response;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;
  const parsed = saveDraftsSchema.safeParse(body.data);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[issue.path.join(".") || "form"] ??= issue.message;
    return jsonError(422, "Some of the details are not valid", fieldErrors);
  }

  const { date, rows, reason } = parsed.data;
  const problem = effectiveDateProblem(date, istDate(new Date().toISOString()));
  if (problem) {
    const message =
      problem === "past" ? "The effective date cannot be in the past" : "The effective date is too far ahead";
    return jsonError(422, message, { date: message });
  }

  const { data, error } = await auth.supabase.rpc("save_price_drafts", {
    p_date: date,
    p_rows: rows,
    p_reason: reason ?? null,
  });
  if (error) {
    // A correction without a reason is the one validation the form can fix itself.
    if (error.code === "22023" && /reason/i.test(error.message ?? "")) {
      return jsonError(422, "A correction needs a reason", { reason: "Write why the published rate is being corrected" });
    }
    return dbErrorResponse(error);
  }
  return NextResponse.json({ date, ...(data as Record<string, number>) }, { status: 201 });
}
