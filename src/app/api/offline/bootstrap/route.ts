import { NextResponse } from "next/server";
import { istDate } from "@/lib/calculations/format";
import type { BootstrapMember, BootstrapPage } from "@/lib/offline/reference-data";
import { requireOperator } from "@/lib/services/operator-context";
import { readSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import type { Crop, Grade } from "@/types/domain";

const PAGE_SIZE = 1000;
const PRICE_HISTORY_DAYS = 3;

/**
 * Reference data for offline use: active farmers (no bank details) and the
 * recent published rates. Paged by member code so 6,000+ members download in a
 * few small requests that a weak connection can finish.
 */
export async function GET(request: Request) {
  if (!readSupabaseEnv()) {
    return NextResponse.json({ error: "server is not configured" }, { status: 503 });
  }
  const supabase = await createClient();
  const lookup = await requireOperator(supabase);
  if (!lookup.ok) {
    return NextResponse.json({ error: lookup.error }, { status: lookup.status });
  }

  const cursor = new URL(request.url).searchParams.get("cursor");
  if (cursor !== null && !/^FM[0-9]{5}$/.test(cursor)) {
    return NextResponse.json({ error: "invalid cursor" }, { status: 400 });
  }

  let query = supabase
    .from("farmer_members")
    .select("id, member_code, full_name, village, phone, land_acres, centre_id, crops")
    .eq("active", true)
    .order("member_code")
    .limit(PAGE_SIZE + 1);
  if (cursor) query = query.gt("member_code", cursor);

  const { data, error } = await query;
  if (error) {
    console.error("bootstrap members failed", error);
    return NextResponse.json({ error: "could not load farmers" }, { status: 500 });
  }

  const rows = data ?? [];
  const hasMore = rows.length > PAGE_SIZE;
  const pageRows = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

  const members: BootstrapMember[] = pageRows.map((m) => ({
    id: m.id as string,
    memberCode: m.member_code as string,
    fullName: m.full_name as string,
    village: m.village as string,
    phone: (m.phone as string | null) ?? null,
    landAcres: Number(m.land_acres),
    centreId: (m.centre_id as string | null) ?? null,
    crops: ((m.crops as Crop[] | null) ?? []) as Crop[],
  }));

  const page: BootstrapPage = {
    members,
    nextCursor: hasMore ? members[members.length - 1].memberCode : null,
    serverTime: new Date().toISOString(),
  };

  if (!cursor) {
    const since = istDate(new Date(Date.now() - PRICE_HISTORY_DAYS * 86_400_000).toISOString());
    const { data: prices, error: priceError } = await supabase
      .from("daily_prices")
      .select("price_date, crop, grade, rate_per_quintal")
      .gte("price_date", since);
    if (priceError) {
      console.error("bootstrap prices failed", priceError);
      return NextResponse.json({ error: "could not load rates" }, { status: 500 });
    }
    page.prices = (prices ?? []).map((p) => ({
      priceDate: p.price_date as string,
      crop: p.crop as Crop,
      grade: p.grade as Grade,
      ratePerQuintal: Number(p.rate_per_quintal).toFixed(2),
    }));
  }

  return NextResponse.json(page, { headers: { "Cache-Control": "no-store" } });
}
