export const CROPS = ["soybean", "tur"] as const;
export type Crop = (typeof CROPS)[number];

export const GRADES = ["A", "B", "C"] as const;
export type Grade = (typeof GRADES)[number];

export type UserRole = "centre_operator" | "office_manager";
export type ApprovalStatus = "approved" | "held" | "rejected";
export type PaymentStatus = "unpaid" | "in_run" | "paid" | "failed";
export type SyncOutcome = "accepted" | "duplicate" | "rejected" | "flagged";

/** Reasons an entry can be held for manager review. Purchases are never cancelled. */
export const FLAG_REASONS = [
  "rate_mismatch",
  "no_price_for_day",
  "clock_ahead",
  "chain_gap",
  "clock_skew",
  "manual_hold",
  "superseded_rate",
  "weight_vs_land",
  "repeat_within_hour",
  "uniform_moisture",
  "weight_pattern_change",
  "moisture_pattern_change",
] as const;
export type FlagReason = (typeof FLAG_REASONS)[number];

export interface Profile {
  id: string;
  full_name: string;
  role: UserRole;
  centre_id: string | null;
  preferred_lang: "mr" | "en";
}

export interface Centre {
  id: string;
  code: string;
  name: string;
  village: string;
}

export interface FarmerMember {
  id: string;
  member_code: string;
  full_name: string;
  village: string;
  phone: string | null;
  land_acres: number;
  active: boolean;
}

export interface DailyPrice {
  price_date: string;
  crop: Crop;
  grade: Grade;
  rate_per_quintal: string;
}
