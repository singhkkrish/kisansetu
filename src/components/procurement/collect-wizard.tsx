"use client";

import { ArrowLeft, ArrowRight, CheckCircle2, Search, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useOffline } from "@/components/offline/offline-provider";
import { DisplayReader, type FieldResolution } from "@/components/procurement/display-reader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PriceStatusLine } from "@/components/prices/price-status-line";
import { SlipPanel } from "@/components/slip/slip-panel";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { useLocalQuery } from "@/hooks/use-local-query";
import { formatInr, formatKg } from "@/lib/calculations/format";
import { tryCalculate } from "@/lib/calculations/procurement";
import { getLocalDb, type CachedMember, type CachedPrice, type LocalEntry } from "@/lib/db/local";
import type { Messages } from "@/lib/i18n/messages";
import { getPart4Messages } from "@/lib/i18n/part4-messages";
import { getPart6Messages } from "@/lib/i18n/part6-messages";
import type { Readings } from "@/lib/ai/schemas";
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
  /**
   * The published price this entry will carry, locked when the grade is chosen.
   * A newer price arriving afterwards never replaces it unless the operator says so.
   */
  snap: CachedPrice | null;
}

type ReadingField = "grossKg" | "tareKg" | "moisturePct";
const NO_RESOLUTION: FieldResolution = { meta: undefined, blocked: null };

const EMPTY_DRAFT: Draft = { farmer: null, crop: null, gross: "", tare: "", moisture: "", grade: null, snap: null };

function Row({ label, value, strong }: { label: string; value: React.ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line py-3 last:border-0">
      <dt className="text-base text-muted">{label}</dt>
      <dd className={`text-right tabular-nums ${strong ? "text-3xl font-bold" : "text-lg font-semibold"}`}>{value}</dd>
    </div>
  );
}

export function CollectWizard({ t, lang = "mr" }: { t: Messages; lang?: "mr" | "en" }) {
  const c = t.collect;
  const t4 = getPart4Messages(lang);
  const t6 = getPart6Messages(lang);
  const { operator, deviceId, online, syncNow, refreshData, refreshing, getSlips } = useOffline();

  const [step, setStep] = useState<WizardStep>("farmer");
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [stepError, setStepError] = useState<StepError | null>(null);
  // How each weight/moisture figure was obtained, and whether an AI reading still awaits the operator.
  const [resolutions, setResolutions] = useState<Record<ReadingField, FieldResolution>>({ grossKg: NO_RESOLUTION, tareKg: NO_RESOLUTION, moisturePct: NO_RESOLUTION });
  // The readers stay mounted once visited, so going back never loses what the operator confirmed.
  const [reached, setReached] = useState(0);
  const resolvers = useMemo(
    () => ({
      grossKg: (r: FieldResolution) => setResolutions((s) => ({ ...s, grossKg: r })),
      tareKg: (r: FieldResolution) => setResolutions((s) => ({ ...s, tareKg: r })),
      moisturePct: (r: FieldResolution) => setResolutions((s) => ({ ...s, moisturePct: r })),
    }),
    [],
  );
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CachedMember[]>([]);
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
  // Live: a download that lands while the wizard is open updates this, but never the locked price.
  const liveRates = useLocalQuery<{ date: string; rows: CachedPrice[] } | null>(async () => {
    const db = getLocalDb();
    const date = await businessDate(db);
    return { date, rows: await listCachedRates(db, date) };
  }, null);
  const rateDate = liveRates?.date ?? "";
  const prices = useMemo(
    () => Object.fromEntries((liveRates?.rows ?? []).map((r) => [`${r.crop}|${r.grade}`, r] as const)) as Record<string, CachedPrice>,
    [liveRates],
  );

  // The entry is priced from the locked snapshot, not from whatever the phone holds now.
  const rate = draft.snap?.ratePerQuintal ?? null;
  const livePrice = draft.crop && draft.grade ? (prices[`${draft.crop}|${draft.grade}`] ?? null) : null;
  const priceChanged =
    draft.snap !== null &&
    livePrice !== null &&
    (livePrice.ratePerQuintal !== draft.snap.ratePerQuintal || livePrice.version !== draft.snap.version || livePrice.priceDate !== draft.snap.priceDate);
  const snapDateMoved = draft.snap !== null && rateDate !== "" && draft.snap.priceDate !== rateDate;
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

  const chooseGrade = (grade: Grade) => {
    setDraft((d) => ({ ...d, grade, snap: (d.crop ? prices[`${d.crop}|${grade}`] : null) ?? null }));
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
    if (step === "gross" && resolutions.grossKg.blocked) return;
    if (step === "tare" && resolutions.tareKg.blocked) return;
    if (step === "moisture" && resolutions.moisturePct.blocked) return;
    if (problem) {
      setStepError(problem);
      return;
    }
    setStep(WIZARD_STEPS[index + 1]);
    setReached((r) => Math.max(r, index + 1));
  }, [calc, draft, index, step, resolutions]);

  const goBack = () => {
    setStepError(null);
    if (index > 0) setStep(WIZARD_STEPS[index - 1]);
  };

  async function save() {
    if (saving || !calc || !draft.farmer || !draft.crop || !draft.grade || !rate || !deviceId) return;
    setSaving(true);
    setSaveError(null);
    const db = getLocalDb();
    // Only figures where the AI was used are recorded; a purely typed entry carries nothing extra.
    const readings: Readings = {};
    for (const field of ["grossKg", "tareKg", "moisturePct"] as const) {
      const meta = resolutions[field].meta;
      if (meta) readings[field] = meta;
    }
    const input = {
      farmerId: draft.farmer.id,
      crop: draft.crop,
      grade: draft.grade,
      grossKg: toFixedText(draft.gross, 1),
      tareKg: toFixedText(draft.tare, 1),
      moisturePct: toFixedText(draft.moisture, 1),
      ratePerQuintal: rate,
      // Which published price this is: its effective date and version.
      rateDate: draft.snap?.priceDate,
      ...(draft.snap?.version ? { rateVersion: draft.snap.version } : {}),
      ...(readings ? { readings } : {}),
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
    setResolutions({ grossKg: NO_RESOLUTION, tareKg: NO_RESOLUTION, moisturePct: NO_RESOLUTION });
    setReached(0);
    setStep("farmer");
  }

  if (saved) return <SavedScreen entry={saved} member={draft.farmer ?? undefined} t={t} t4={t4} onAgain={startAgain} />;

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
                onClick={() => setDraft((d) => ({ ...d, crop, grade: null, snap: null }))}
                className={`h-24 rounded-xl border-2 text-2xl font-bold ${draft.crop === crop ? "border-primary bg-primary-soft text-primary" : "border-line bg-surface"}`}
              >
                {t.crops[crop]}
              </button>
            ))}
          </div>
          {notEligible && <Notice tone="warn">{c.notEligible}</Notice>}
        </div>
      )}

      {(
        [
          ["gross", "grossKg", c.gross, "gross"],
          ["tare", "tareKg", c.tare, "tare"],
          ["moisture", "moisturePct", c.moisture, "moisture"],
        ] as const
      ).map(([stepName, field, label, key]) =>
        reached >= WIZARD_STEPS.indexOf(stepName) ? (
          <div key={key} hidden={step !== stepName}>
            <DisplayReader
              kind={field === "moisturePct" ? "moisture" : "scale"}
              id={key}
              label={label}
              unit={field === "moisturePct" ? c.percent : c.kg}
              value={draft[key]}
              onChange={(v) => set(key, v)}
              onEnter={goNext}
              error={step === stepName ? errorText(stepError) : undefined}
              onResolved={resolvers[field]}
              t={t6.reader}
              online={online}
            />
          </div>
        ) : null,
      )}

      {step === "grade" && draft.crop && (
        <div className="space-y-5">
          <div>
            <p className="mb-2 text-lg font-semibold">{c.selectGrade}</p>
            <div className="grid grid-cols-3 gap-3">
              {GRADES.map((grade) => {
                const r = prices[`${draft.crop}|${grade}`]?.ratePerQuintal;
                return (
                  <button
                    key={grade}
                    type="button"
                    disabled={!r}
                    aria-pressed={draft.grade === grade}
                    onClick={() => chooseGrade(grade)}
                    className={`rounded-xl border-2 py-3 disabled:opacity-40 ${draft.grade === grade ? "border-primary bg-primary-soft text-primary" : "border-line bg-surface"}`}
                  >
                    <span className="block text-3xl font-bold">{grade}</span>
                    <span className="block text-sm tabular-nums text-muted">{r ? formatInr(r) : "—"}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {Object.keys(prices).length === 0 || (draft.grade && !rate) ? (
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

          {priceChanged && livePrice && <PriceChangedNotice t4={t4} snap={draft.snap!} live={livePrice} onUse={() => setDraft((d) => ({ ...d, snap: livePrice }))} />}

          {draft.snap && <PriceStatusLine price={draft.snap} t={{ ...t4.wizardPrice, sync: t4.priceStatus }} />}

          {rate && calc && (
            <Card>
              <CardContent className="pt-4">
                <dl data-testid="calc-preview">
                  <Row label={`${c.rateToday} (${draft.snap?.priceDate ?? rateDate})`} value={`${formatInr(rate)} ${c.perQuintal}`} />
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
          {priceChanged && livePrice && <PriceChangedNotice t4={t4} snap={draft.snap!} live={livePrice} onUse={() => setDraft((d) => ({ ...d, snap: livePrice }))} />}
          {snapDateMoved && !priceChanged && <Notice tone="error">{c.noRateBody}</Notice>}
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
                <Row label={t4.wizardPrice.effective} value={<span data-testid="review-rate-date">{draft.snap?.priceDate}{draft.snap?.version ? ` · ${t4.wizardPrice.version} ${draft.snap.version}` : ""}</span>} />
                <Row label={c.netWeight} value={`${formatKg(calc.netKg)} ${c.kg}`} strong />
                <Row label={c.amount} value={formatInr(calc.amount)} strong />
              </dl>
            </CardContent>
          </Card>
          {(["grossKg", "tareKg", "moisturePct"] as const).some((f) => resolutions[f].meta) && (
            <Card>
              <CardContent className="pt-4">
                <p className="mb-2 text-base font-semibold">{t6.sources.title}</p>
                <ul className="space-y-1 text-base" data-testid="review-sources">
                  {(["grossKg", "tareKg", "moisturePct"] as const).map((f) => {
                    const m = resolutions[f].meta;
                    if (!m) return null;
                    return (
                      <li key={f}>
                        {t6.sources.fields[f]}: <span className="font-semibold">{t6.sources[m.source]}</span>
                        {m.aiValue && m.source !== "ai_confirmed" ? ` (${t6.sources.aiWas} ${m.aiValue})` : ""}
                      </li>
                    );
                  })}
                </ul>
              </CardContent>
            </Card>
          )}
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
            disabled={
              (step === "farmer" && !draft.farmer) ||
              (step === "crop" && !draft.crop) ||
              (step === "grade" && !calc) ||
              (step === "gross" && resolutions.grossKg.blocked !== null) ||
              (step === "tare" && resolutions.tareKg.blocked !== null) ||
              (step === "moisture" && resolutions.moisturePct.blocked !== null)
            }
            className="flex-[2]"
          >
            {c.next}
            <ArrowRight className="h-5 w-5" aria-hidden="true" />
          </Button>
        ) : (
          <Button size="lg" onClick={() => void save()} disabled={saving || !calc || (snapDateMoved && !priceChanged)} className="flex-[2]" data-testid="save-entry">
            {saving ? c.saving : c.save}
          </Button>
        )}
      </div>
    </div>
  );
}

function PriceChangedNotice({ t4, snap, live, onUse }: { t4: ReturnType<typeof getPart4Messages>; snap: CachedPrice; live: CachedPrice; onUse: () => void }) {
  const w = t4.wizardPrice;
  const body = w.changedBody
    .replace("{new}", formatInr(live.ratePerQuintal).replace("₹", ""))
    .replace("{newVersion}", String(live.version ?? "?"))
    .replace("{old}", formatInr(snap.ratePerQuintal).replace("₹", ""))
    .replace("{oldVersion}", String(snap.version ?? "?"));
  return (
    <Notice tone="warn">
      <div data-testid="price-changed">
        <p className="font-semibold">{w.changedTitle}</p>
        <p className="mt-1">{body}</p>
        <Button size="sm" variant="secondary" className="mt-3" onClick={onUse} data-testid="use-new-price">{w.useNew}</Button>
      </div>
    </Notice>
  );
}

function SavedScreen({ entry, member, t, t4, onAgain }: { entry: LocalEntry; member: CachedMember | undefined; t: Messages; t4: ReturnType<typeof getPart4Messages>; onAgain: () => void }) {
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

      <SlipPanel entry={row} member={member} t={t4} />

      <div className="no-print flex flex-col gap-3 sm:flex-row">
        <Button size="lg" onClick={onAgain} className="flex-1" data-testid="new-entry">{c.newEntry}</Button>
        <Button asChild size="lg" variant="secondary" className="flex-1">
          <Link href="/procurement">{c.viewEntries}</Link>
        </Button>
      </div>
    </div>
  );
}
