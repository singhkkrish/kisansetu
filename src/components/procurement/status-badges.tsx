import { Badge } from "@/components/ui/badge";
import type { Messages } from "@/lib/i18n/messages";
import type { ApprovalStatus, PaymentStatus } from "@/types/domain";

export function ApprovalBadge({ status, t }: { status: ApprovalStatus; t: Messages["procurement"] }) {
  const tone = status === "approved" ? "success" : status === "held" ? "warn" : "danger";
  return <Badge tone={tone}>{t.approvalState[status]}</Badge>;
}

export function PaymentBadge({ status, t }: { status: PaymentStatus; t: Messages["procurement"] }) {
  const tone = status === "paid" ? "success" : status === "failed" ? "danger" : "neutral";
  return <Badge tone={tone}>{t.paymentState[status]}</Badge>;
}
