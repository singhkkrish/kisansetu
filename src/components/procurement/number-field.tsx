"use client";

import { sanitizeDecimal } from "@/lib/procurement/wizard";

interface NumberFieldProps {
  id: string;
  label: string;
  unit: string;
  value: string;
  onChange: (value: string) => void;
  onEnter?: () => void;
  error?: string;
  decimals?: number;
  autoFocus?: boolean;
}

/** A big numeric input for gloved thumbs: opens the decimal keypad and allows one decimal place. */
export function NumberField({ id, label, unit, value, onChange, onEnter, error, decimals = 1, autoFocus }: NumberFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-lg font-semibold">
        {label}
      </label>
      <div className={`flex items-center rounded-xl border-2 bg-surface px-4 ${error ? "border-danger" : "border-line focus-within:border-primary"}`}>
        <input
          id={id}
          name={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          autoFocus={autoFocus}
          enterKeyHint="next"
          placeholder="0.0"
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => onChange(sanitizeDecimal(event.target.value, decimals))}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onEnter?.();
            }
          }}
          className="h-20 min-w-0 flex-1 bg-transparent text-5xl font-bold tabular-nums outline-none placeholder:text-line"
        />
        <span className="ml-3 text-2xl font-semibold text-muted">{unit}</span>
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-2 text-base font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
