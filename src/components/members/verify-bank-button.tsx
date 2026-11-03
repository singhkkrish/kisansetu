"use client";

import { BadgeCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

interface VerifyBankButtonProps {
  memberId: string;
  labels: { verify: string; busy: string; failed: string };
}

export function VerifyBankButton({ memberId, labels }: VerifyBankButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function verify() {
    setBusy(true);
    setFailed(false);
    const response = await fetch(`/api/members/${memberId}/verify-bank`, { method: "POST" }).catch(() => null);
    if (response?.ok) {
      router.refresh();
    } else {
      setFailed(true);
    }
    setBusy(false);
  }

  return (
    <div className="space-y-3">
      <Button variant="secondary" onClick={verify} disabled={busy}>
        <BadgeCheck className="h-5 w-5" aria-hidden="true" />
        {busy ? labels.busy : labels.verify}
      </Button>
      {failed && <Notice tone="error">{labels.failed}</Notice>}
    </div>
  );
}
