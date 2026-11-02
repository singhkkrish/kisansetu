import { NextResponse } from "next/server";
import { z } from "zod";
import { requireOperator } from "@/lib/services/operator-context";
import { readSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

const requestSchema = z.object({ deviceId: z.string().min(8).max(64) });

const BLOCK_SIZE = 200;

/** Hands this phone a block of slip numbers so it can keep issuing slips offline. */
export async function POST(request: Request) {
  if (!readSupabaseEnv()) {
    return NextResponse.json({ error: "server is not configured" }, { status: 503 });
  }
  const supabase = await createClient();
  const lookup = await requireOperator(supabase);
  if (!lookup.ok) {
    return NextResponse.json({ error: lookup.error }, { status: lookup.status });
  }

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "deviceId is required" }, { status: 400 });
  }

  const { data, error } = await supabase.rpc("allocate_slip_block", {
    p_centre_id: lookup.operator.centreId,
    p_device_id: parsed.data.deviceId,
    p_size: BLOCK_SIZE,
  });

  const block = Array.isArray(data) ? data[0] : data;
  if (error || !block) {
    console.error("slip block allocation failed", error);
    return NextResponse.json({ error: "could not allocate slip numbers" }, { status: 500 });
  }

  return NextResponse.json({
    centreCode: lookup.operator.centreCode,
    start: block.start_no as number,
    end: block.end_no as number,
  });
}
