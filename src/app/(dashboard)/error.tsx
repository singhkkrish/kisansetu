"use client";

import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { en } from "@/lib/i18n/messages";

export default function DashboardError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="mx-auto max-w-md space-y-4 py-12">
      <Notice tone="error">
        <p className="font-semibold">{en.errors.title}</p>
        <p className="mt-1">{en.errors.body}</p>
      </Notice>
      <Button onClick={reset}>{en.errors.retry}</Button>
    </div>
  );
}
