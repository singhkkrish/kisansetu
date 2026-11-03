"use client";

import { ArrowLeft, ArrowRight, CheckCircle2, Search, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOffline } from "@/components/offline/offline-provider";
import { NumberField } from "@/components/procurement/number-field";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { useLocalQuery } from "@/hooks/use-local-query";
import { formatInr, formatKg } from "@/lib/calculations/format";
import { tryCalculate } from "@/lib/calculations/procurement";
import { getLocalDb, type CachedMember, type LocalEntry } from "@/lib/db/local";
import type { Messages } from "@/lib/i18n/messages";
import { businessDate } from "@/lib/offline/clock";
import { SlipBlockExhaustedError, WrongCentreSlipBlockError, recordProcurement, slipNumbersRemaining } from "@/lib/offline/queue";
import { listCachedRates, searchCachedMembers } from "@/lib/offline/reference-data";
import {
  WIZARD_STEPS,
  toFixedText,
  validateGross,
  validateMoisture,
  validateTare,
  type StepError,
  type WizardStep,
} from "@/lib/procurement/wizard";
import { CROPS, GRADES, type Crop, type Grade } from "@/types/domain";

interface Draft {
  farmer: CachedMember | null;
  crop: Crop | null;
  gross: string;
  tare: string;
  moisture: string;
  grade: Grade | null;
}

const EMPTY_DRAFT: Draft = { farmer: null, crop: null, gross: "", tare: "", moisture: "", grade: null };

function Row({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-3 last:border-0">
      <dt className="text-base text-muted">{label}</dt>
      <dd className={`text-right tabular-nums ${strong ? "text-3xl font-bold" : "text-lg font-semibold"}`}>{value}</dd>
    </div>
  );
}

export function CollectWizard({ t }: { t: Messages }) {
  const c = t.collect;
  const { operator, deviceId, online, syncNow, refreshData, refreshing, getSlips } = useOffline();

  const [step, setStep] = useState<WizardStep>("farmer");
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [stepError, setStepError] = useState<StepError | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CachedMember[]>([]);
  const [rates, setRates] = useState<Record<string, string>>({});
  const [rateDate, setRateDate] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState<LocalEntry | null>(null);
  // One id per entry being written. Tapping Save twice can only ever store one purchase.
  const draftId = useRef(crypto.randomUUID());

  const farmersCached = useLocalQuery(() => getLocalDb().members.count(), -1);
  const slipsLeft = useLocalQuery(() => slipNumbersRemaining(getLocalDb()), 0);

  // Search runs against the copy on this phone, so it works with no network.
  useEffect(() => {
    let cancelled = false;
    void searchCachedMembers(getLocalDb(), query, 20).then((rows) => {
      if (!cancelled) setResults(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [query, farmersCached]);

  // Today's published rates from this phone's copy. The date is the server-corrected one.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const db = getLocalDb();
      const date = await businessDate(db);
      const rows = await listCachedRates(db, date);
      if (cancelled) return;
      setRateDate(date);
      setRates(Object.fromEntries(rows.map((r) => [`${r.crop}|${r.grade}`, r.ratePerQuintal])));
    })();
    return () => {
      cancelled = true;
    };
  }, [step, farmersCached]);

  const rate = draft.crop && draft.grade ? (rates[`${draft.crop}|${draft.grade}`] ?? null) : null;
  const calc = useMemo(() => {
    if (!draft.crop || !rate || validateGross(draft.gross) || validateTare(draft.tare, draft.gross) || validateMoisture(draft.moisture, draft.crop)) {
      return null;
    }
    const attempt = tryCalculate({
      crop: draft.crop,
      grossKg: toFixedText(draft.gross, 1),
      tareKg: toFixedText(draft.tare, 1),
      moisturePct: toFixedText(draft.moisture, 1),
      ratePerQuintal: rate,
    });
    return attempt.ok ? attempt.result : null;
  }, [draft, rate]);

  const index = WIZARD_STEPS.indexOf(step);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setStepError(null);
  };

  const errorText = (key: StepError | null) => (key ? c.errors[key] : undefined);

  const goNext = useCallback(() => {
    let problem: StepError | null = null;
    if (step === "farmer" && !draft.farmer) return;
    if (step === "crop" && !draft.crop) return;
    if (step === "gross") problem = validateGross(draft.gross);
    if (step === "tare") problem = validateTare(draft.tare, draft.gross);
    if (step === "moisture" && draft.crop) problem = validateMoisture(draft.moisture, draft.crop);
    if (step === "grade" && !calc) return;
    if (problem) {
      setStepError(problem);
      return;
    }
    setStep(WIZARD_STEPS[index + 1]);
  }, [calc, draft, index, step]);

  const goBack = () => {
    setStepError(null);
    if (index > 0) setStep(WIZARD_STEPS[index - 1]);
  };

  async function save() {
    if (saving || !calc || !draft.farmer || !draft.crop || !draft.grade || !rate || !deviceId) return;
    setSaving(true);
    setSaveError(null);
    const db = getLocalDb();
    const input = {
      farmerId: draft.farmer.id,
      crop: draft.crop,
      grade: draft.grade,
      grossKg: toFixedText(draft.gross, 1),
      tareKg: toFixedText(draft.tare, 1),
      moisturePct: toFixedText(draft.moisture, 1),
      ratePerQuintal: rate,
    };
    const context = { ...operator, deviceId, clientId: draftId.current };
    try {
      let entry: LocalEntry;
      try {
        entry = await recordProcurement(db, input, context);
      } catch (error) {
        // Out of slip numbers but connected: fetch more and try once more.
        if ((error instanceof SlipBlockExhaustedError || error instanceof WrongCentreSlipBlockError) && navigator.onLine && (await getSlips())) {
          entry = await recordProcurement(db, input, context);
        } else {
          throw error;
        }
      }
      setSaved(entry);
      void syncNow();
    } catch (error) {
      setSaveError(
        error instanceof SlipBlockExhaustedError ? c.errors.noSlips : error instanceof WrongCentreSlipBlockError ? c.errors.wrongCentre : c.errors.saveFailed,
      );
    } finally {
      setSaving(false);
    }
  }

  function startAgain() {
    draftId.current = crypto.randomUUID();
    setDraft(EMPTY_DRAFT);
    setQuery("");
    setSaved(null);
    setSaveError(null);
    setStepError(null);
    setStep("farmer");
  }

  if (saved) return <SavedScreen entry={saved} t={t} onAgain={startAgain} />;

  const stepLabel = c.stepOf.replace("{n}", String(index + 1)).replace("{total}", String(WIZARD_STEPS.length));
  const notEligible = draft.farmer && draft.crop && draft.farmer.crops.length > 0 && !draft.farmer.crops.includes(draft.crop);

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <div>
        <p className="text-sm font-semibold text-muted" data-testid="step-counter">{stepLabel}</p>
        <div className="mt-2 flex gap-1.5" aria-hidden="true">
          {WIZARD_STEPS.map((s, i) => (
            <span key={s} className={`h-2 flex-1 rounded-full ${i <= index ? "bg-primary" : "bg-line"}`} />
          ))}
        </div>
        <h1 className="mt-4 text-2xl font-bold" data-testid="step-title">{c.steps[step]}</h1>
      </div>

      {!online && <Notice tone="warn">{c.offlineBanner}</Notice>}
      {slipsLeft < 30 && slipsLeft >= 0 && <Notice tone="warn">{slipsLeft === 0 ? c.errors.noSlips : c.slipsLow}</Notice>}

      {step === "farmer" && (
        <div className="space-y-4">
          <label htmlFor="farmer-search" className="block text-lg font-semibold">{c.searchFarmer}</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-6 w-6 -translate-y-1/2 text-muted" aria-hidden="true" />
            <Input
              id="farmer-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={c.searchPlaceholder}
              autoComplete="off"
              enterKeyHint="search"
              className="h-16 pl-12 text-xl"
            />
          </div>

          {farmersCached === 0 && (
            <Notice tone="warn">
              <p>{online ? c.emptyCache : c.emptyCacheOffline}</p>
              {online && (
                <Button size="sm" variant="secondary" className="mt-3" onClick={() => void refreshData()} disabled={refreshing}>
                  {refreshing ? t.sync.refreshing : t.sync.refreshData}
                </Button>
              )}
            </Notice>
          )}
          {farmersCached > 0 && query.trim() !== "" && results.length === 0 && <p className="text-muted">{c.noResults}</p>}

          <ul className="space-y-2" data-testid="farmer-results">
            {results.map((m) => {
              const chosen = draft.farmer?.id === m.id;
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => set("farmer", m)}
                    aria-pressed={chosen}
                    className={`flex w-full items-center justify-between gap-3 rounded-xl border-2 px-4 py-3 text-left ${chosen ? "border-primary bg-primary-soft" : "border-line bg-surface"}`}
                  >
                    <span>
                      <span className="block text-lg font-bold">{m.fullName}</span>
                      <span className="block text-sm text-muted">{m.memberCode} · {m.village}</span>
                    </span>
                    {chosen && <CheckCircle2 className="h-6 w-6 text-primary" aria-hidden="true" />}
                  </button>
                </li>
              );
            })}
          </ul>
          {draft.farmer && query.trim() === "" && (
            <p className="text-lg font-semibold">{draft.farmer.fullName} · {draft.farmer.memberCode}</p>
          )}
        </div>
      )}

      {step === "crop" && (
        <div className="space-y-4">
          <p className="text-lg font-semibold">{c.selectCrop}</p>
          <div className="grid grid-cols-2 gap-3">
            {CROPS.map((crop) => (
              <button
                key={crop}
                type="button"
                aria-pressed={draft.crop === crop}
                onClick={() => setDraft((d) => ({ ...d, crop, grade: null }))}
                className={`h-24 rounded-xl border-2 text-2xl font-bold ${draft.crop === crop ? "border-primary bg-primary-soft text-primary" : "border-line bg-surface"}`}
              >
                {t.crops[crop]}
              </button>
            ))}
          </div>
          {notEligible && <Notice tone="warn">{c.notEligible}</Notice>}
        </div>
      )}

      {step === "gross" && (
        <NumberField id="gross" label={c.gross} unit={c.kg} value={draft.gross} onChange={(v) => set("gross", v)} onEnter={goNext} error={errorText(stepError)} autoFocus />
      )}
      {step === "tare" && (
        <NumberField id="tare" label={c.tare} unit={c.kg} value={draft.tare} onChange={(v) => set("tare", v)} onEnter={goNext} error={errorText(stepError)} autoFocus />
      )}
      {step === "moisture" && (
        <NumberField id="moisture" label={c.moisture} unit={c.percent} value={draft.moisture} onChange={(v) => set("moisture", v)} onEnter={goNext} error={errorText(stepError)} autoFocus />
      )}

      {step === "grade" && draft.crop && (
        <div className="space-y-5">
          <div>
            <p className="mb-2 text-lg font-semibold">{c.selectGrade}</p>
            <div className="grid grid-cols-3 gap-3">
              {GRADES.map((grade) => {
                const r = rates[`${draft.crop}|${grade}`];
                return (
                  <button
                    key={grade}
                    type="button"
                    disabled={!r}
                    aria-pressed={draft.grade === grade}
                    onClick={() => set("grade", grade)}
                    className={`rounded-xl border-2 py-3 disabled:opacity-40 ${draft.grade === grade ? "border-primary bg-primary-soft text-primary" : "border-line bg-surface"}`}
                  >
                    <span className="block text-3xl font-bold">{grade}</span>
                    <span className="block text-sm tabular-nums text-muted">{r ? formatInr(r) : "—"}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {Object.keys(rates).length === 0 || (draft.grade && !rate) ? (
            <Notice tone="error">
              <p className="font-semibold">{c.noRateTitle}</p>
              <p className="mt-1">{c.noRateBody}</p>
              {online && (
                <Button size="sm" variant="secondary" className="mt-3" onClick={() => void refreshData()} disabled={refreshing}>
                  {refreshing ? t.sync.refreshing : t.sync.refreshData}
                </Button>
              )}
            </Notice>
          ) : null}

          {rate && calc && (
            <Card>
              <CardContent className="pt-4">
                <dl data-testid="calc-preview">
                  <Row label={`${c.rateToday} (${rateDate})`} value={`${formatInr(rate)} ${c.perQuintal}`} />
                  <Row label={c.weighed} value={`${formatKg(calc.weighedKg)} ${c.kg}`} />
                  <Row label={c.deduction} value={`${calc.moistureDeductionPct}%`} />
                  <Row label={c.netWeight} value={`${formatKg(calc.netKg)} ${c.kg}`} strong />
                  <Row label={c.amount} value={formatInr(calc.amount)} strong />
                </dl>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {step === "review" && draft.farmer && draft.crop && draft.grade && rate && calc && (
        <div className="space-y-4">
          <p className="text-base text-muted">{c.reviewIntro}</p>
          <Card>
            <CardContent className="pt-4">
              <dl data-testid="review-summary">
                <Row label={c.farmer} value={`${draft.farmer.fullName} (${draft.farmer.memberCode})`} />
                <Row label={c.crop} value={t.crops[draft.crop]} />
                <Row label={c.grade} value={draft.grade} />
                <Row label={c.gross} value={`${formatKg(toFixedText(draft.gross, 1))} ${c.kg}`} />
                <Row label={c.tare} value={`${formatKg(toFixedText(draft.tare, 1))} ${c.kg}`} />
                <Row label={c.moisture} value={`${toFixedText(draft.moisture, 1)}%`} />
                <Row label={c.rate} value={`${formatInr(rate)} ${c.perQuintal}`} />
                <Row label={c.netWeight} value={`${formatKg(calc.netKg)} ${c.kg}`} strong />
                <Row label={c.amount} value={formatInr(calc.amount)} strong />
              </dl>
            </CardContent>
          </Card>
          {saveError && <Notice tone="error">{saveError}</Notice>}
        </div>
      )}

      <div className="flex gap-3 pt-2">
        {index > 0 && (
          <Button variant="secondary" size="lg" onClick={goBack} disabled={saving} className="flex-1">
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
            {c.back}
          </Button>
        )}
        {step !== "review" ? (
          <Button
            size="lg"
            onClick={goNext}
            disabled={(step === "farmer" && !draft.farmer) || (step === "crop" && !draft.crop) || (step === "grade" && !calc)}
            className="flex-[2]"
          >
            {c.next}
            <ArrowRight className="h-5 w-5" aria-hidden="true" />
          </Button>
        ) : (
          <Button size="lg" onClick={() => void save()} disabled={saving || !calc} className="flex-[2]" data-testid="save-entry">
            {saving ? c.saving : c.save}
          </Button>
        )}
      </div>
    </div>
  );
}

function SavedScreen({ entry, t, onAgain }: { entry: LocalEntry; t: Messages; onAgain: () => void }) {
  const c = t.collect;
  const { online } = useOffline();
  // Read the live row, so this flips to "synced" only when the server has confirmed it.
  const live = useLocalQuery(() => getLocalDb().entries.get(entry.seq!), entry);
  const row = live ?? entry;
  const state = row.syncStatus;

  return (
    <div className="mx-auto max-w-xl space-y-5" data-testid="saved-screen">
      <div className="flex items-center gap-3">
        <CheckCircle2 className="h-10 w-10 text-primary" aria-hidden="true" />
        <h1 className="text-2xl font-bold">{c.savedTitle}</h1>
      </div>

      <Card>
        <CardContent className="pt-4">
          <dl>
            <Row label={c.slipNo} value={<span data-testid="saved-slip">{row.slipNo}</span>} strong />
            <Row label={c.netWeight} value={`${formatKg(row.netKg)} ${c.kg}`} />
            <Row label={c.amount} value={formatInr(row.amount)} />
            <Row
              label={t.procurement.status}
              value={
                <span data-testid="saved-status" className={state === "synced" ? "text-primary" : state === "rejected" ? "text-danger" : "text-warn"}>
                  {t.procurement.syncState[state]}
                </span>
              }
            />
          </dl>
        </CardContent>
      </Card>

      {state === "pending" && <Notice tone="warn">{online ? c.savedOnline : c.savedOffline}</Notice>}
      {state === "rejected" && (
        <Notice tone="error">
          <span className="inline-flex items-center gap-1.5"><TriangleAlert className="h-4 w-4" aria-hidden="true" />{row.lastError}</span>
        </Notice>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button size="lg" onClick={onAgain} className="flex-1" data-testid="new-entry">{c.newEntry}</Button>
        <Button asChild size="lg" variant="secondary" className="flex-1">
          <Link href="/procurement">{c.viewEntries}</Link>
        </Button>
      </div>
    </div>
  );
}
