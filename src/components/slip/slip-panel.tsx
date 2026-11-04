"use client";

import { Printer } from "lucide-react";
import { useState } from "react";
import { useOffline } from "@/components/offline/offline-provider";
import { SmsPanel } from "@/components/sms/sms-panel";
import { SlipCard, type SlipLanguage } from "@/components/slip/slip-card";
import { Button } from "@/components/ui/button";
import type { CachedMember, LocalEntry } from "@/lib/db/local";
import type { Part4Messages } from "@/lib/i18n/part4-messages";
import { localEntryToSlip } from "@/lib/slip/from-local";
import { buildSlip } from "@/lib/slip/slip";

/**
 * Digital slip for an entry on this phone: the preview, a print button, and the
 * farmer's SMS. It reads only the entry's own saved snapshot, so it works with
 * no network and never picks up a rate published after the entry was made.
 */
export function SlipPanel({
  entry,
  member,
  t,
}: {
  entry: LocalEntry;
  member: CachedMember | undefined;
  t: Part4Messages;
}) {
  const { operator } = useOffline();
  const [lang, setLang] = useState<SlipLanguage>("both");
  const input = localEntryToSlip(entry, member, { code: operator.centreCode, name: operator.centreName });

  return (
    <div className="space-y-4" data-testid="slip-panel">
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold text-muted">{t.slip.forFarmer}</p>
        <div className="flex gap-2" role="group" aria-label="Slip language">
          {(["both", "mr", "en"] as const).map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={lang === l}
              onClick={() => setLang(l)}
              className={`h-10 rounded-lg border-2 px-3 text-sm font-semibold ${lang === l ? "border-primary bg-primary-soft text-primary" : "border-line"}`}
            >
              {t.slip.languages[l]}
            </button>
          ))}
        </div>
      </div>

      <SlipCard model={buildSlip(input)} lang={lang} />

      <div className="no-print">
        <Button variant="secondary" size="lg" className="w-full" onClick={() => window.print()} data-testid="slip-print">
          <Printer className="h-5 w-5" aria-hidden="true" />
          {t.slip.print}
        </Button>
        <p className="mt-1 text-center text-xs text-muted">{t.slip.printHint}</p>
      </div>

      <SmsPanel entry={entry} phone={member?.phone ?? null} slip={input} t={t.sms} />
    </div>
  );
}
