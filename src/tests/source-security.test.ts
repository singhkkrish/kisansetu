import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(import.meta.dirname, "..");

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "tests" ? [] : sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

describe("source code safety", () => {
  const files = sourceFiles(SRC);

  it("never references the service-role key from application code", () => {
    const offenders = files.filter((file) => /SERVICE_ROLE/i.test(fs.readFileSync(file, "utf8")));
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  it("keeps secrets out of NEXT_PUBLIC_ variables", () => {
    const offenders = files.filter((file) => /NEXT_PUBLIC_[A-Z_]*(SECRET|SERVICE|PASSWORD|PRIVATE)/.test(fs.readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("has no Aadhaar field in the application, schema or seed", () => {
    const sql = [
      ...fs.readdirSync(path.resolve(SRC, "../supabase/migrations")).map((f) => path.resolve(SRC, "../supabase/migrations", f)),
      path.resolve(SRC, "../supabase/seed.sql"),
    ];
    const offenders = [...files, ...sql].filter((file) => /aadhaar|aadhar/i.test(fs.readFileSync(file, "utf8")));
    // The only mentions allowed are comments that say Aadhaar is NOT stored.
    for (const file of offenders) {
      const lines = fs.readFileSync(file, "utf8").split("\n").filter((l) => /aadhaar|aadhar/i.test(l));
      for (const line of lines) expect(line.trim(), path.relative(SRC, file)).toMatch(/^(--|\/\/|\*|\/\*)/);
    }
  });

  it("only ever puts bank account numbers through the masking helper on the server", () => {
    // Components and pages must not select account_number themselves. The bank file
    // builder is the one other place that handles full numbers; it is only imported
    // by the bank-file API route (checked below).
    const offenders = files.filter(
      (file) => /account_number/.test(fs.readFileSync(file, "utf8")) && !file.includes(`${path.sep}services${path.sep}`) && !file.includes(`${path.sep}validation${path.sep}`) && !file.includes(`${path.sep}api${path.sep}`) && !file.endsWith(path.join("lib", "payments", "bank-file.ts")),
    );
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  it("only lets the bank file API route import the bank file builder", () => {
    const importers = files.filter(
      (file) => /payments\/bank-file/.test(fs.readFileSync(file, "utf8")) && !file.endsWith(path.join("lib", "payments", "bank-file.ts")),
    );
    expect(importers.map((f) => path.relative(SRC, f)).sort()).toEqual([
      path.join("lib", "services", "payments.ts"),
      path.join("app", "api", "payment-runs", "[id]", "bank-file", "route.ts"),
    ].sort());
  });
});
