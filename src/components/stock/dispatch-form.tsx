"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { Select } from "@/components/ui/select";
import { formatKg } from "@/lib/calculations/format";
import type { Part5Messages } from "@/lib/i18n/part5-messages";
import { sanitizeDecimal } from "@/lib/procurement/wizard";
import { previewDispatch } from "@/lib/stock/stock";
import { CROPS, type Crop } from "@/types/domain";

interface Props {
  centres: { id: string; code: string; name: string }[];
  /** Current stock per `${centreId}|${crop}`, in kg. */
  stock: Record<string, string>;
  crops: Record<Crop, string>;
  t: Part5Messages["dispatch"];
}

/** Local date-time text for an <input type="datetime-local">, in the browser's zone. */
function localNow(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function DispatchForm({ centres, stock, crops, t }: Props) {
  const router = useRouter();
  const [centreId, setCentreId] = useState("");
  const [crop, setCrop] = useState<Crop | "">("");
  const [weight, setWeight] = useState("");
  const [book, setBook] = useState("");
  const [destination, setDestination] = useState("");
  const [truck, setTruck] = useState("");
  const [when, setWhen] = useState(localNow);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "info" | "error"; text: string } | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const stockNow = centreId && crop ? (stock[`${centreId}|${crop}`] ?? "0.0") : null;
  const bookValue = book || weight;
  const ready = Number(weight) > 0 && Number(bookValue) > 0;
  const preview = useMemo(
    () => (stockNow !== null && ready ? previewDispatch(stockNow, bookValue, weight) : null),
    [stockNow, ready, bookValue, weight],
  );
  const weighedTooHigh = ready && Number(weight) > Number(bookValue);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !centreId || !crop) return;
    setBusy(true);
    setMessage(null);
    setFieldErrors({});
    const response = await fetch("/api/dispatches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        centreId,
        crop,
        weightKg: weight,
        ...(book ? { bookKg: book } : {}),
        destination,
        truckNo: truck,
        dispatchedAt: new Date(when).toISOString(),
      }),
    }).catch(() => null);
    const body = response ? ((await response.json().catch(() => ({}))) as { error?: string; fieldErrors?: Record<string, string>; dispatch_no?: string }) : {};
    setBusy(false);
    if (response?.ok) {
      setMessage({ tone: "info", text: `${t.saved}: ${body.dispatch_no ?? ""}` });
      setWeight("");
      setBook("");
      setDestination("");
      setTruck("");
      setWhen(localNow());
      router.refresh();
    } else {
      setFieldErrors(body.fieldErrors ?? {});
      setMessage({ tone: "error", text: body.error ?? t.failed });
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5 rounded-xl border border-line bg-surface p-4 sm:p-6" data-testid="dispatch-form">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="d-centre">{t.centre}</Label>
          <Select id="d-centre" value={centreId} onChange={(e) => setCentreId(e.target.value)} required data-testid="d-centre">
            <option value="">{t.choose}</option>
            {centres.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
          </Select>
        </div>
        <div>
          <Label htmlFor="d-crop">{t.crop}</Label>
          <Select id="d-crop" value={crop} onChange={(e) => setCrop(e.target.value as Crop)} required data-testid="d-crop">
            <option value="">{t.choose}</option>
            {CROPS.map((c) => <option key={c} value={c}>{crops[c]}</option>)}
          </Select>
        </div>
      </div>

      {stockNow !== null && (
        <p className="rounded-lg bg-primary-soft px-4 py-3 text-base" data-testid="stock-now">
          {t.stockNow}: <strong className="tabular-nums">{formatKg(stockNow)} kg</strong>
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="d-weight">{t.weight}</Label>
          <Input id="d-weight" inputMode="decimal" value={weight} onChange={(e) => setWeight(sanitizeDecimal(e.target.value, 1))} required className="h-14 text-xl" data-testid="d-weight" aria-invalid={fieldErrors.weightKg ? true : undefined} />
          <p className="mt-1 text-xs text-muted">{t.weightHint}</p>
          {fieldErrors.weightKg && <p className="mt-1 text-sm font-semibold text-danger">{fieldErrors.weightKg}</p>}
        </div>
        <div>
          <Label htmlFor="d-book">{t.book}</Label>
          <Input id="d-book" inputMode="decimal" value={book} onChange={(e) => setBook(sanitizeDecimal(e.target.value, 1))} placeholder={weight} className="h-14 text-xl" data-testid="d-book" />
          <p className="mt-1 text-xs text-muted">{t.bookHint}</p>
        </div>
      </div>

      {weighedTooHigh && <p role="alert" className="text-sm font-semibold text-danger">{t.weightAbove}</p>}
      {preview && !weighedTooHigh && (
        <dl className="grid gap-3 rounded-lg border border-line p-4 sm:grid-cols-3" data-testid="dispatch-preview">
          <div>
            <dt className="text-sm text-muted">{t.stockAfter}</dt>
            <dd className={`text-2xl font-bold tabular-nums ${preview.enoughStock ? "" : "text-danger"}`} data-testid="stock-after">{formatKg(preview.stockAfterKg)} kg</dd>
          </div>
          <div>
            <dt className="text-sm text-muted">{t.loss}</dt>
            <dd className="text-2xl font-bold tabular-nums" data-testid="loss-preview">
              {formatKg(preview.loss.lossKg)} kg · {preview.loss.lossPct}%
              {preview.loss.high && <Badge tone="warn" className="ml-2">{t.lossHigh}</Badge>}
            </dd>
          </div>
          {!preview.enoughStock && <p role="alert" className="text-sm font-semibold text-danger sm:col-span-3">{t.notEnough}</p>}
        </dl>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="d-dest">{t.destination}</Label>
          <Input id="d-dest" value={destination} onChange={(e) => setDestination(e.target.value)} maxLength={120} required data-testid="d-dest" aria-invalid={fieldErrors.destination ? true : undefined} />
          {fieldErrors.destination && <p className="mt-1 text-sm font-semibold text-danger">{fieldErrors.destination}</p>}
        </div>
        <div>
          <Label htmlFor="d-truck">{t.truck}</Label>
          <Input id="d-truck" value={truck} onChange={(e) => setTruck(e.target.value.toUpperCase())} maxLength={14} required autoCapitalize="characters" data-testid="d-truck" aria-invalid={fieldErrors.truckNo ? true : undefined} />
          <p className="mt-1 text-xs text-muted">{t.truckHint}</p>
          {fieldErrors.truckNo && <p className="mt-1 text-sm font-semibold text-danger">{fieldErrors.truckNo}</p>}
        </div>
      </div>
      <div className="sm:max-w-xs">
        <Label htmlFor="d-when">{t.when}</Label>
        <Input id="d-when" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required data-testid="d-when" />
        <p className="mt-1 text-xs text-muted">{t.whenHint}</p>
      </div>

      {message && <Notice tone={message.tone}><span data-testid="dispatch-message">{message.text}</span></Notice>}
      <Button type="submit" size="lg" disabled={busy || !ready || weighedTooHigh || (preview !== null && !preview.enoughStock)} data-testid="d-submit">
        {busy ? t.saving : t.save}
      </Button>
    </form>
  );
}
