import type { SupabaseClient } from "@supabase/supabase-js";
import type { NewSms, SmsPatch, SmsRecord, SmsRepository, SmsSource, SmsStatus } from "@/lib/services/sms-service";
import type { SmsLanguage } from "@/lib/sms/message";
import type { Crop, Grade, PaymentStatus } from "@/types/domain";

type Raw = Record<string, unknown>;
const one = <T,>(v: unknown): T | null => (Array.isArray(v) ? ((v[0] as T) ?? null) : ((v as T) ?? null));

export const SMS_COLUMNS =
  "id, entry_id, status, language, recipient_masked, body, failure_reason, provider_ref, attempts, created_at, sent_at, status_at";

export function toSmsRecord(r: Raw): SmsRecord {
  return {
    id: r.id as string,
    entryId: r.entry_id as string,
    status: r.status as SmsStatus,
    language: r.language as SmsLanguage,
    recipientMasked: r.recipient_masked as string,
    body: r.body as string,
    failureReason: (r.failure_reason as string | null) ?? null,
    providerRef: (r.provider_ref as string | null) ?? null,
    attempts: Number(r.attempts),
    createdAt: r.created_at as string,
    sentAt: (r.sent_at as string | null) ?? null,
    statusAt: r.status_at as string,
  };
}

/** Supabase storage for the SMS service. It runs as the signed-in user, so row level security applies. */
export function createSupabaseSmsRepository(supabase: SupabaseClient): SmsRepository {
  return {
    async loadSource(entryClientId): Promise<SmsSource | null> {
      const { data, error } = await supabase
        .from("procurement_entries")
        .select(
          "id, slip_no, farmer_id, centre_id, crop, grade, gross_kg, tare_kg, moisture_pct, net_kg, rate_per_quintal, amount, " +
            "rate_price_date, rate_version, device_recorded_at, server_received_at, payment_status, " +
            "farmer_members(full_name, member_code, village, phone), centres(code, name)",
        )
        .eq("client_id", entryClientId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;

      const r = data as unknown as Raw;
      const farmer = one<{ full_name: string; member_code: string; village: string; phone: string | null }>(r.farmer_members);
      const centre = one<{ code: string; name: string }>(r.centres);
      if (!farmer || !centre) return null;

      return {
        entryId: r.id as string,
        farmerId: r.farmer_id as string,
        centreId: r.centre_id as string,
        phone: farmer.phone,
        slip: {
          slipNo: r.slip_no as string,
          farmerName: farmer.full_name,
          farmerCode: farmer.member_code,
          village: farmer.village,
          centreName: centre.name,
          centreCode: centre.code,
          crop: r.crop as Crop,
          grade: r.grade as Grade,
          grossKg: Number(r.gross_kg).toFixed(1),
          tareKg: Number(r.tare_kg).toFixed(1),
          moisturePct: Number(r.moisture_pct).toFixed(1),
          ratePerQuintal: Number(r.rate_per_quintal).toFixed(2),
          netKg: Number(r.net_kg).toFixed(1),
          amount: Number(r.amount).toFixed(2),
          rateDate: (r.rate_price_date as string | null) ?? null,
          rateVersion: (r.rate_version as number | null) ?? null,
          recordedAt: r.device_recorded_at as string,
          serverReceivedAt: r.server_received_at as string,
          paymentStatus: r.payment_status as PaymentStatus,
        },
      };
    },

    async findByEntryId(entryId) {
      const { data, error } = await supabase.from("sms_messages").select(SMS_COLUMNS).eq("entry_id", entryId).maybeSingle();
      if (error) throw error;
      return data ? toSmsRecord(data as unknown as Raw) : null;
    },

    async getById(id) {
      const { data, error } = await supabase.from("sms_messages").select(SMS_COLUMNS).eq("id", id).maybeSingle();
      if (error) throw error;
      return data ? toSmsRecord(data as unknown as Raw) : null;
    },

    async create(row: NewSms) {
      const { data, error } = await supabase
        .from("sms_messages")
        .insert({
          entry_id: row.entryId,
          farmer_id: row.farmerId,
          centre_id: row.centreId,
          language: row.language,
          recipient_masked: row.recipientMasked,
          body: row.body,
          created_by: row.createdBy,
          created_at: row.createdAt,
        })
        .select(SMS_COLUMNS)
        .single();
      if (error) {
        if (error.code === "23505") return null;
        throw error;
      }
      return toSmsRecord(data as unknown as Raw);
    },

    async update(id, patch: SmsPatch) {
      const values: Record<string, unknown> = { status: patch.status, status_at: patch.statusAt };
      if (patch.failureReason !== undefined) values.failure_reason = patch.failureReason;
      if (patch.providerRef !== undefined) values.provider_ref = patch.providerRef;
      if (patch.attempts !== undefined) values.attempts = patch.attempts;
      if (patch.sentAt !== undefined) values.sent_at = patch.sentAt;

      const { data, error } = await supabase.from("sms_messages").update(values).eq("id", id).select(SMS_COLUMNS).single();
      if (error) throw error;
      return toSmsRecord(data as unknown as Raw);
    },
  };
}
