import { Badge } from "@/components/ui/badge";
import type { ItemStatus, RunStatus } from "@/lib/services/payments";

export function RunStatusBadge({ status, labels }: { status: RunStatus; labels: Record<string, string> }) {
  const tone = status === "completed" ? "success" : status === "cancelled" ? "danger" : status === "draft" ? "warn" : "neutral";
  return <Badge tone={tone} data-testid="run-status" data-status={status}>{labels[status] ?? status}</Badge>;
}

export function ItemStatusBadge({ status, labels }: { status: ItemStatus; labels: Record<string, string> }) {
  const tone = status === "paid" ? "success" : status === "failed" ? "danger" : status === "processing" ? "warn" : "neutral";
  return <Badge tone={tone} data-status={status}>{labels[status] ?? status}</Badge>;
}
