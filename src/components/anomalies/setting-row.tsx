"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Part6Messages } from "@/lib/i18n/part6-messages";
import type { AnomalySetting } from "@/lib/services/anomalies";

export function SettingRow({ setting, t }: { setting: AnomalySetting; t: Part6Messages["settings"] }) {
  const router = useRouter();
  const [value, setValue] = useState(String(setting.value));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const parsed = Number(value);
  const valid = value.trim() !== "" && Number.isFinite(parsed) && parsed >= setting.min && parsed <= setting.max;
  const changed = valid && parsed !== setting.value;

  async function save() {
    if (!changed || busy) return;
    setBusy(true);
    setMessage(null);
    const response = await fetch("/api/anomaly-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: setting.key, value: parsed }),
    }).catch(() => null);
    setBusy(false);
    if (response?.ok) {
      setMessage({ ok: true, text: t.saved });
      router.refresh();
    } else {
      setMessage({ ok: false, text: t.failed });
    }
  }

  return (
    <tr data-testid={`setting-${setting.key}`}>
      <td className="px-4 py-3">
        <label htmlFor={`s-${setting.key}`} className="font-semibold">{t.keys[setting.key] ?? setting.key}</label>
        <span className="block text-xs text-muted">{setting.key.endsWith("_enabled") ? t.enabled : `${t.range}: ${setting.min} – ${setting.max}`}</span>
      </td>
      <td className="px-4 py-3">
        <Input id={`s-${setting.key}`} inputMode="decimal" value={value} onChange={(e) => { setValue(e.target.value); setMessage(null); }} aria-invalid={!valid} className="w-32" />
      </td>
      <td className="px-4 py-3"><Badge tone={setting.isAssumption ? "warn" : "success"}>{setting.isAssumption ? t.assumption : t.custom}</Badge></td>
      <td className="px-4 py-3">
        <Button size="sm" onClick={() => void save()} disabled={!changed || busy}>{t.save}</Button>
        {message && <span role="status" className={`ml-2 text-sm font-semibold ${message.ok ? "text-primary" : "text-danger"}`}>{message.text}</span>}
      </td>
    </tr>
  );
}
