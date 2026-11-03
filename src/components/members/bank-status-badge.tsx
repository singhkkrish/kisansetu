import { BadgeCheck, CircleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export function BankStatusBadge({
  verified,
  labels,
}: {
  verified: boolean;
  labels: { verified: string; unverified: string };
}) {
  return verified ? (
    <Badge tone="success">
      <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
      {labels.verified}
    </Badge>
  ) : (
    <Badge tone="warn">
      <CircleAlert className="h-3.5 w-3.5" aria-hidden="true" />
      {labels.unverified}
    </Badge>
  );
}

export function ActiveBadge({ active, labels }: { active: boolean; labels: { active: string; inactive: string } }) {
  return <Badge tone={active ? "neutral" : "danger"}>{active ? labels.active : labels.inactive}</Badge>;
}
