import type { Bilingual, SlipModel, SlipRow } from "@/lib/slip/slip";
import { SLIP_LABELS } from "@/lib/slip/slip";

export type SlipLanguage = "both" | "mr" | "en";

/** A label in Marathi (large) with English beneath it, or either one alone. */
function Label({ text, lang, size = "base" }: { text: Bilingual; lang: SlipLanguage; size?: "base" | "lg" }) {
  return (
    <span className="block leading-tight">
      {lang !== "en" && (
        <span lang="mr" className={`block font-bold ${size === "lg" ? "text-lg" : "text-base"}`}>
          {text.mr}
        </span>
      )}
      {lang !== "mr" && (
        <span lang="en" className={`block text-muted ${lang === "en" ? "font-semibold text-ink text-base" : "text-xs"}`}>
          {text.en}
        </span>
      )}
    </span>
  );
}

/** A value: shown once when both languages read the same, otherwise in the language(s) chosen. */
function Value({ value, lang }: { value: Bilingual; lang: SlipLanguage }) {
  if (lang === "both" && value.mr === value.en) return <span>{value.mr}</span>;
  if (lang === "both") {
    return (
      <span className="block">
        <span lang="mr" className="block">{value.mr}</span>
        <span lang="en" className="block text-xs font-normal text-muted">{value.en}</span>
      </span>
    );
  }
  return <span lang={lang}>{value[lang]}</span>;
}

function Row({ row, lang }: { row: SlipRow; lang: SlipLanguage }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line py-2.5 last:border-0" data-slip-row={row.key}>
      <dt><Label text={row.label} lang={lang} /></dt>
      <dd className="text-right text-lg font-semibold tabular-nums">
        <Value value={row.value} lang={lang} />
      </dd>
    </div>
  );
}

const paymentTone: Record<string, string> = {
  unpaid: "bg-warn-soft text-warn",
  in_run: "bg-warn-soft text-warn",
  paid: "bg-primary-soft text-primary",
  failed: "bg-danger-soft text-danger",
};

/**
 * The slip a farmer is handed or shown. The amount and the net weight come
 * first and large, so the farmer can read the result in a few seconds; the
 * working, who and where, the payment state and what to do about a mistake
 * follow. Marathi leads, with English under it (or either alone).
 */
export function SlipCard({ model, lang = "both" }: { model: SlipModel; lang?: SlipLanguage }) {
  const L = SLIP_LABELS;
  return (
    <article
      className="slip-printable space-y-4 rounded-xl border-2 border-ink bg-white p-4 text-ink sm:p-6"
      aria-label={lang === "en" ? model.title.en : model.title.mr}
      data-testid="slip"
    >
      <header className="flex items-start justify-between gap-3 border-b-2 border-ink pb-3">
        <Label text={model.title} lang={lang} size="lg" />
        <div className="text-right">
          <p className="text-xs text-muted">{lang === "mr" ? L.slipNo.mr : lang === "en" ? L.slipNo.en : `${L.slipNo.mr} / ${L.slipNo.en}`}</p>
          <p className="text-xl font-bold tabular-nums" data-testid="slip-no">{model.slipNo}</p>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-3" aria-label={lang === "en" ? "Amount and net weight" : "रक्कम व निव्वळ वजन"}>
        <div className="rounded-lg bg-primary-soft p-3" data-testid="slip-amount">
          <Label text={L.amount} lang={lang} />
          <p className="mt-1 whitespace-nowrap text-3xl font-extrabold tabular-nums text-primary">{model.headline.amount}</p>
        </div>
        <div className="rounded-lg bg-primary-soft p-3" data-testid="slip-net">
          <Label text={L.net} lang={lang} />
          <p className="mt-1 whitespace-nowrap text-3xl font-extrabold tabular-nums text-primary">{model.headline.netKg}</p>
        </div>
      </section>

      <dl className="rounded-lg border border-line px-3">
        {model.identity.map((row) => <Row key={row.key} row={row} lang={lang} />)}
      </dl>

      <dl className="rounded-lg border border-line px-3" data-testid="slip-details">
        {model.details.filter((row) => row.key !== "net" && row.key !== "amount").map((row) => <Row key={row.key} row={row} lang={lang} />)}
      </dl>

      <div className="flex items-center justify-between gap-3 rounded-lg border border-line p-3" data-testid="slip-payment">
        <Label text={L.payment} lang={lang} />
        <span className={`rounded-full px-3 py-1 text-base font-bold ${paymentTone[model.payment.status]}`}>
          <Value value={model.payment.label} lang={lang === "both" ? "mr" : lang} />
          {lang === "both" && <span lang="en" className="block text-xs font-normal">{model.payment.label.en}</span>}
        </span>
      </div>

      <section className="rounded-lg bg-warn-soft p-3" data-testid="slip-dispute">
        <Label text={L.dispute} lang={lang} />
        {lang !== "en" && <p lang="mr" className="mt-1 text-base">{model.dispute.mr}</p>}
        {lang !== "mr" && <p lang="en" className={`mt-1 ${lang === "en" ? "text-base" : "text-sm text-muted"}`}>{model.dispute.en}</p>}
      </section>

      <footer className="text-xs text-muted" data-testid="slip-confirmation">
        {lang !== "en" && <p lang="mr">{model.confirmation.mr}</p>}
        {lang !== "mr" && <p lang="en">{model.confirmation.en}</p>}
      </footer>
    </article>
  );
}
