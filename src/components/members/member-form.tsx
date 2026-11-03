"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { Select } from "@/components/ui/select";
import type { Messages } from "@/lib/i18n/messages";
import type { CentreOption } from "@/lib/services/members";
import { CROPS, type Crop } from "@/types/domain";

export interface MemberFormInitial {
  id: string;
  fullName: string;
  village: string;
  centreId: string;
  phone: string;
  landAcres: string;
  crops: Crop[];
  active: boolean;
  /** Masked on the server. The real account number never reaches this component. */
  bank: { holderName: string; accountMasked: string; ifsc: string } | null;
}

interface MemberFormProps {
  mode: "create" | "edit";
  centres: CentreOption[];
  initial?: MemberFormInitial;
  t: Messages["members"];
  cropNames: Messages["crops"];
}

type Errors = Record<string, string>;

function Field({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !error && <p id={`${id}-hint`} className="mt-1.5 text-sm text-muted">{hint}</p>}
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-sm font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function invalidProps(id: string, error?: string, hint?: string) {
  return {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${id}-error` : hint ? `${id}-hint` : undefined,
    className: error ? "border-danger" : undefined,
  } as const;
}

export function MemberForm({ mode, centres, initial, t, cropNames }: MemberFormProps) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Move focus to the first problem so keyboard and screen-reader users land on it.
  useEffect(() => {
    if (Object.keys(errors).length === 0) return;
    formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim();

    const bankHolderName = text("bankHolderName");
    const bankAccountNumber = text("bankAccountNumber");
    const bankIfsc = text("bankIfsc");
    const hasBankInput = Boolean(bankHolderName || bankAccountNumber || bankIfsc);

    // Adding a first account during an edit needs the number: there is nothing stored to keep.
    if (mode === "edit" && hasBankInput && !initial?.bank && !bankAccountNumber) {
      setErrors({ "bank.accountNumber": "Enter the account number" });
      setFormError(t.formError);
      return;
    }

    const payload = {
      fullName: text("fullName"),
      village: text("village"),
      centreId: text("centreId"),
      phone: text("phone"),
      landAcres: text("landAcres"),
      crops: form.getAll("crops"),
      ...(mode === "create"
        ? { consentConfirmed: form.get("consentConfirmed") === "on" }
        : { active: form.get("active") === "on" }),
      ...(hasBankInput
        ? { bank: { holderName: bankHolderName, accountNumber: bankAccountNumber, ifsc: bankIfsc } }
        : {}),
    };

    setBusy(true);
    setErrors({});
    setFormError(null);

    const response = await fetch(mode === "create" ? "/api/members" : `/api/members/${initial?.id}`, {
      method: mode === "create" ? "POST" : "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }).catch(() => null);

    if (!response) {
      setFormError(t.networkError);
      setBusy(false);
      return;
    }

    const body = (await response.json().catch(() => ({}))) as {
      id?: string;
      error?: string;
      fieldErrors?: Errors;
    };

    if (response.ok && body.id) {
      router.push(`/members/${body.id}`);
      router.refresh();
      return;
    }

    setErrors(body.fieldErrors ?? {});
    setFormError(body.fieldErrors ? t.formError : (body.error ?? t.networkError));
    setBusy(false);
  }

  const cancelHref = mode === "edit" && initial ? `/members/${initial.id}` : "/members";
  const accountHint = initial?.bank ? `${initial.bank.accountMasked} · ${t.accountKeepHint}` : undefined;

  return (
    <form ref={formRef} onSubmit={onSubmit} className="space-y-6" noValidate>
      <Card>
        <CardHeader>
          <CardTitle>{t.sectionBasics}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field id="fullName" label={t.name} error={errors.fullName}>
              <Input {...invalidProps("fullName", errors.fullName)} name="fullName" defaultValue={initial?.fullName} autoComplete="off" required />
            </Field>
          </div>
          <Field id="village" label={t.village} error={errors.village}>
            <Input {...invalidProps("village", errors.village)} name="village" defaultValue={initial?.village} autoComplete="off" required />
          </Field>
          <Field id="centreId" label={t.centre} error={errors.centreId}>
            <Select {...invalidProps("centreId", errors.centreId)} name="centreId" defaultValue={initial?.centreId ?? ""} required>
              <option value="" disabled>
                {t.allCentres}
              </option>
              {centres.map((centre) => (
                <option key={centre.id} value={centre.id}>
                  {centre.code} · {centre.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="landAcres" label={`${t.land} (${t.acres})`} error={errors.landAcres}>
            <Input {...invalidProps("landAcres", errors.landAcres)} name="landAcres" defaultValue={initial?.landAcres} inputMode="decimal" autoComplete="off" required />
          </Field>
          <Field id="phone" label={t.phone} error={errors.phone}>
            <Input {...invalidProps("phone", errors.phone)} name="phone" type="tel" defaultValue={initial?.phone} inputMode="tel" autoComplete="off" maxLength={16} />
          </Field>

          <fieldset className="sm:col-span-2" aria-describedby={errors.crops ? "crops-error" : undefined}>
            <legend className="mb-1.5 text-sm font-semibold">{t.crops}</legend>
            <div className="flex flex-wrap gap-3">
              {CROPS.map((crop) => (
                <label key={crop} className="flex h-12 cursor-pointer items-center gap-3 rounded-lg border border-line bg-surface px-4 text-base has-[:checked]:border-primary has-[:checked]:bg-primary-soft">
                  <input
                    type="checkbox"
                    name="crops"
                    value={crop}
                    defaultChecked={initial ? initial.crops.includes(crop) : true}
                    className="h-5 w-5 accent-[var(--primary)]"
                  />
                  {cropNames[crop]}
                </label>
              ))}
            </div>
            {errors.crops && (
              <p id="crops-error" className="mt-1.5 text-sm font-semibold text-danger">
                {errors.crops}
              </p>
            )}
          </fieldset>

          {mode === "edit" && (
            <label className="flex h-12 cursor-pointer items-center gap-3 text-base sm:col-span-2">
              <input type="checkbox" name="active" defaultChecked={initial?.active ?? true} className="h-5 w-5 accent-[var(--primary)]" />
              {t.statusActive}
            </label>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t.sectionBank}</CardTitle>
          <p className="mt-1 text-sm text-muted">{t.sectionBankHint}</p>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field id="bankHolderName" label={t.holderName} error={errors["bank.holderName"]}>
              <Input {...invalidProps("bankHolderName", errors["bank.holderName"])} name="bankHolderName" defaultValue={initial?.bank?.holderName} autoComplete="off" />
            </Field>
          </div>
          <Field id="bankAccountNumber" label={t.accountNumber} error={errors["bank.accountNumber"]} hint={accountHint}>
            <Input
              {...invalidProps("bankAccountNumber", errors["bank.accountNumber"], accountHint)}
              name="bankAccountNumber"
              inputMode="numeric"
              autoComplete="off"
              maxLength={24}
              placeholder={initial?.bank?.accountMasked}
            />
          </Field>
          <Field id="bankIfsc" label={t.ifsc} error={errors["bank.ifsc"]}>
            <Input
              {...invalidProps("bankIfsc", errors["bank.ifsc"])}
              name="bankIfsc"
              defaultValue={initial?.bank?.ifsc}
              autoComplete="off"
              autoCapitalize="characters"
              maxLength={11}
              className={`uppercase ${errors["bank.ifsc"] ? "border-danger" : ""}`}
            />
          </Field>
        </CardContent>
      </Card>

      {mode === "create" && (
        <Card>
          <CardHeader>
            <CardTitle>{t.sectionConsent}</CardTitle>
          </CardHeader>
          <CardContent>
            <label className="flex cursor-pointer items-start gap-3 text-base">
              <input
                type="checkbox"
                name="consentConfirmed"
                aria-invalid={errors.consentConfirmed ? true : undefined}
                aria-describedby={errors.consentConfirmed ? "consent-error" : undefined}
                className="mt-1 h-5 w-5 shrink-0 accent-[var(--primary)]"
              />
              {t.consentLabel}
            </label>
            {errors.consentConfirmed && (
              <p id="consent-error" className="mt-1.5 text-sm font-semibold text-danger">
                {errors.consentConfirmed}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {formError && <Notice tone="error">{formError}</Notice>}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button asChild variant="secondary" size="lg">
          <Link href={cancelHref}>{t.cancel}</Link>
        </Button>
        <Button type="submit" size="lg" disabled={busy}>
          {busy ? t.saving : t.save}
        </Button>
      </div>
    </form>
  );
}
