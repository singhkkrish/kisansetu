import { NextResponse } from "next/server";
import { authorizeRequest, dbErrorResponse, jsonError, readJsonBody } from "@/lib/api/http";
import { parseMemberFilters } from "@/lib/services/member-filters";
import { MEMBER_PAGE_SIZE, searchMembers } from "@/lib/services/members";
import { issuesToFieldErrors, memberCreateSchema, toFarmerPayload } from "@/lib/validation/member";

/** Search the registry. Any signed-in staff member; bank details are never included. */
export async function GET(request: Request) {
  const auth = await authorizeRequest("members:read");
  if (!auth.ok) return auth.response;

  const params = Object.fromEntries(new URL(request.url).searchParams);
  const filters = parseMemberFilters(params);
  const result = await searchMembers(auth.supabase, filters);
  if (result.failed) return jsonError(500, "Could not load members");

  return NextResponse.json({
    rows: result.rows,
    total: result.total,
    page: filters.page,
    pageSize: MEMBER_PAGE_SIZE,
  });
}

/** Register a farmer. Office managers only. */
export async function POST(request: Request) {
  const auth = await authorizeRequest("members:write");
  if (!auth.ok) return auth.response;

  const body = await readJsonBody(request);
  if (!body.ok) return body.response;

  const parsed = memberCreateSchema.safeParse(body.data);
  if (!parsed.success) {
    return jsonError(422, "Please correct the highlighted fields", issuesToFieldErrors(parsed.error));
  }

  const { data, error } = await auth.supabase.rpc("register_farmer", {
    p: toFarmerPayload(parsed.data),
  });
  if (error) return dbErrorResponse(error);

  const created = data as { id: string; member_code: string };
  return NextResponse.json({ id: created.id, memberCode: created.member_code }, { status: 201 });
}
