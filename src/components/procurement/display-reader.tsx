"use client";

import { Camera, CheckCircle2, Loader2, RefreshCw, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NumberField } from "@/components/procurement/number-field";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { prepareImage, requestReading } from "@/lib/ai/client";
import { resolveField, type BlockReason, type Decision, type Suggestion } from "@/lib/ai/reading-flow";
import type { DisplayKind, FieldReadingMeta, ReadingResult } from "@/lib/ai/schemas";
import type { Part6Messages } from "@/lib/i18n/part6-messages";

export interface FieldResolution {
  meta: FieldReadingMeta | undefined;
  blocked: BlockReason | null;
}

interface Props {
  kind: DisplayKind;
  id: string;
  label: string;
  unit: string;
  value: string;
  onChange: (value: string) => void;
  onEnter?: () => void;
  error?: string;
  /** Called whenever the way this figure was obtained, or whether it can proceed, changes. */
  onResolved: (resolution: FieldResolution) => void;
  t: Part6Messages["reader"];
  /** When the phone is offline the photo option is hidden and the operator types as before. */
  online: boolean;
}

/**
 * A number field with an optional "read from a photo" helper. The photo is
 * shown next to what the AI read. The AI's number is only ever a suggestion:
 * it is not placed in the field until the operator accepts it, and it can be
 * confirmed, corrected, rejected or replaced by another photo.
 */
export function DisplayReader({ kind, id, label, unit, value, onChange, onEnter, error, onResolved, t, online }: Props) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReadingResult | null>(null);
  const [decision, setDecision] = useState<Decision>("undecided");
  const [acknowledged, setAcknowledged] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const typeInput = useRef<HTMLDivElement>(null);
  // Lets a late answer for an old photo be ignored after the operator uploads another.
  const requestId = useRef(0);

  const suggestion = useMemo<Suggestion | null>(() => (result?.status === "ok" ? { value: result.value, confidence: result.confidence } : null), [result]);
  const outcome = useMemo(
    () => resolveField({ suggestion, attemptedWithoutValue: result !== null && result.status !== "ok", decision, value, acknowledged }),
    [suggestion, result, decision, value, acknowledged],
  );

  const reportedKey = JSON.stringify(outcome);
  useEffect(() => {
    onResolved(outcome);
    // outcome is memoised from state; reportedKey keeps this from firing on identity changes alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportedKey]);

  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl); }, [photoUrl]);

  const reset = useCallback(() => {
    requestId.current += 1;
    setResult(null);
    setDecision("undecided");
    setAcknowledged(false);
    setBusy(false);
    setPhotoUrl(null);
  }, []);

  async function onFile(file: File | undefined) {
    if (!file) return;
    const mine = ++requestId.current;
    // A value the AI filled in earlier is cleared; one the operator typed themselves stays.
    if (decision === "accepted") onChange("");
    setResult(null);
    setDecision("undecided");
    setAcknowledged(false);
    setBusy(true);
    setPhotoUrl(URL.createObjectURL(file));
    const prepared = await prepareImage(file);
    const answer: ReadingResult = prepared.ok ? await requestReading(kind, prepared.blob) : { status: "failed", kind, code: prepared.code };
    if (mine !== requestId.current) return;
    setResult(answer);
    setBusy(false);
  }

  const accept = () => {
    if (!suggestion) return;
    onChange(suggestion.value);
    setDecision("accepted");
    setAcknowledged(false);
  };
  const correct = () => {
    onChange("");
    setDecision("corrected");
    setAcknowledged(false);
    requestAnimationFrame(() => typeInput.current?.querySelector("input")?.focus());
  };
  const reject = () => {
    if (decision === "accepted") onChange("");
    setDecision("rejected");
    setAcknowledged(false);
  };
  const discard = () => {
    if (decision === "accepted") onChange("");
    reset();
  };

  const blockedText = outcome.blocked === "decide" ? t.needDecision : outcome.blocked === "acknowledge" ? t.needAcknowledge : outcome.blocked === "value" ? t.needValue : null;
  const showField = !suggestion || decision !== "undecided";
  const differs = suggestion !== null && (decision === "accepted" || decision === "corrected") && outcome.blocked !== "value" && outcome.meta?.source !== "ai_confirmed";

  return (
    <div className="space-y-4">
      {online && (
        <div>
          <input
            ref={fileInput}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            capture="environment"
            className="sr-only"
            id={`${id}-photo`}
            data-testid={`${id}-photo`}
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          {!photoUrl && (
            <div className="rounded-xl border-2 border-dashed border-line p-3">
              <Button type="button" variant="secondary" onClick={() => fileInput.current?.click()} className="w-full">
                <Camera className="h-5 w-5" aria-hidden="true" />
                {t.useCamera}
              </Button>
              <p className="mt-2 text-sm text-muted">{t.cameraHint}</p>
            </div>
          )}
        </div>
      )}

      {photoUrl && (
        <div className="grid gap-3 rounded-xl border-2 border-line bg-surface p-3 sm:grid-cols-2" data-testid={`${id}-reading`}>
          {/* eslint-disable-next-line @next/next/no-img-element -- a local blob URL; next/image cannot optimise it */}
          <img src={photoUrl} alt={t.photoAlt} className="max-h-64 w-full rounded-lg bg-primary-soft object-contain" />
          <div className="space-y-3" aria-live="polite">
            {busy && (
              <p className="flex items-center gap-2 text-base font-semibold">
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                {t.reading}
              </p>
            )}

            {!busy && result?.status === "ok" && (
              <>
                <div>
                  <p className="text-sm font-semibold text-muted">{t.suggestion}</p>
                  <p className="text-4xl font-bold tabular-nums" data-testid={`${id}-ai-value`}>
                    {result.value} <span className="text-xl text-muted">{unit}</span>
                  </p>
                  {result.displayed.unit !== "kg" && result.displayed.unit !== "%" && (
                    <p className="text-sm text-muted">
                      {t.displayed}: {result.displayed.value} {result.displayed.unit} ({t.convertedFrom})
                    </p>
                  )}
                </div>
                {result.caution && <Notice tone="warn">{t.cautionMedium}</Notice>}
                {decision === "undecided" && <p className="text-sm text-muted">{t.suggestionHint}</p>}
                {decision === "undecided" && (
                  <div className="flex flex-col gap-2">
                    <Button type="button" onClick={accept} data-testid={`${id}-accept`}>
                      <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
                      {t.useValue}
                    </Button>
                    <Button type="button" variant="secondary" onClick={correct} data-testid={`${id}-correct`}>
                      {t.correct}
                    </Button>
                    <Button type="button" variant="secondary" onClick={reject} data-testid={`${id}-reject`}>
                      <X className="h-5 w-5" aria-hidden="true" />
                      {t.reject}
                    </Button>
                  </div>
                )}
                {decision === "accepted" && <p className="text-sm font-semibold text-primary">{t.confirmed}</p>}
                {decision === "corrected" && <p className="text-sm font-semibold">{t.corrected}</p>}
                {decision === "rejected" && <p className="text-sm font-semibold">{t.rejected}</p>}
              </>
            )}

            {!busy && result?.status === "uncertain" && (
              <Notice tone="warn">
                <p className="font-semibold" data-testid={`${id}-uncertain`}>{t.uncertain[result.reason] ?? t.uncertain.unreadable}</p>
                <p className="mt-1">{t.notShown} {t.manualFallback}</p>
              </Notice>
            )}

            {!busy && result?.status === "failed" && (
              <Notice tone="error">
                <p className="font-semibold" data-testid={`${id}-failed`}>{t.failed[result.code] ?? t.failed.api_error}</p>
                <p className="mt-1">{t.manualFallback}</p>
              </Notice>
            )}

            {!busy && (
              <Button type="button" variant="secondary" size="sm" onClick={() => fileInput.current?.click()} data-testid={`${id}-another`}>
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                {t.another}
              </Button>
            )}
            {!busy && (
              <button type="button" onClick={discard} className="block text-sm text-muted underline">
                <X className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
                {t.reject}
              </button>
            )}
          </div>
        </div>
      )}

      {showField && (
        <div ref={typeInput}>
          <NumberField id={id} label={decision === "corrected" ? t.typeIt : label} unit={unit} value={value} onChange={onChange} onEnter={onEnter} error={error} autoFocus={!photoUrl} />
        </div>
      )}

      {differs && (
        <label className="flex items-start gap-3 rounded-xl border-2 border-warn/40 bg-warn-soft p-3 text-base font-semibold text-warn">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="mt-1 h-6 w-6 shrink-0"
            data-testid={`${id}-ack`}
          />
          <span>
            <TriangleAlert className="mr-1 inline h-4 w-4" aria-hidden="true" />
            {t.differs}
          </span>
        </label>
      )}

      {blockedText && (
        <p role="alert" className="text-base font-semibold text-danger" data-testid={`${id}-blocked`}>{blockedText}</p>
      )}
      {photoUrl && <p className="text-xs text-muted">{t.privacy}</p>}
    </div>
  );
}
