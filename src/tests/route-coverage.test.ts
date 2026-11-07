import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Structural safety net: a new API route or page cannot be added without
 * going through sign-in and a permission check, or (for a body) validation.
 * It reads the source, so it complements, and does not replace, the behavioural
 * tests in authorization.test.ts, payments-routes.test.ts and ai-reading.test.ts.
 */

const APP = path.resolve(import.meta.dirname, "../app");

function walk(dir: string, name: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? walk(full, name) : e.name === name ? [full] : [];
  });
}
const rel = (f: string) => path.relative(APP, f);

describe("every API route checks who is calling", () => {
  const routes = walk(path.join(APP, "api"), "route.ts");
  it("finds the routes", () => expect(routes.length).toBeGreaterThanOrEqual(20));
  it.each(routes.map((r) => [rel(r), r]))("%s", (_name, file) => {
    const source = fs.readFileSync(file, "utf8");
    expect(source).toMatch(/authorizeRequest\(|requireOperator\(|handleReadDisplay\(/);
  });
});

describe("every route that reads a body validates it on the server", () => {
  const routes = walk(path.join(APP, "api"), "route.ts");
  it.each(routes.map((r) => [rel(r), r]))("%s", (_name, file) => {
    const source = fs.readFileSync(file, "utf8");
    const readsBody = /request\.json\(|readJsonBody\(|formData\(/.test(source);
    if (readsBody) expect(source).toMatch(/safeParse\(|\.parse\(|Schema/);
  });
});

describe("every signed-in page enforces a permission", () => {
  const pages = walk(path.join(APP, "(dashboard)"), "page.tsx");
  it("finds the pages", () => expect(pages.length).toBeGreaterThanOrEqual(15));
  it.each(pages.map((p) => [rel(p), p]))("%s", (_name, file) => {
    expect(fs.readFileSync(file, "utf8")).toMatch(/requirePermission\(|requireAnyPermission\(/);
  });
});

describe("no secret leaves the server", () => {
  it("never reads the provider key or service key in a client component", () => {
    const roots = [path.resolve(import.meta.dirname, "../components"), path.resolve(import.meta.dirname, "../hooks")];
    const offenders: string[] = [];
    const scan = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) scan(full);
        else if (/\.(ts|tsx)$/.test(e.name) && /ANTHROPIC_API_KEY|SERVICE_ROLE/.test(fs.readFileSync(full, "utf8"))) offenders.push(full);
      }
    };
    roots.filter(fs.existsSync).forEach(scan);
    expect(offenders).toEqual([]);
  });
});
