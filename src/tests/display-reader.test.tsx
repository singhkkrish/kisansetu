// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ReadingResult } from "@/lib/ai/schemas";
import { getPart6Messages } from "@/lib/i18n/part6-messages";

const client = vi.hoisted(() => ({ result: null as unknown }));
vi.mock("@/lib/ai/client", () => ({
  prepareImage: async () => ({ ok: true, blob: new Blob(["x"]) }),
  requestReading: async () => client.result,
}));

import { DisplayReader, type FieldResolution } from "@/components/procurement/display-reader";

const t = getPart6Messages("en").reader;
let last: FieldResolution = { meta: undefined, blocked: null };

function Harness({ online = true }: { online?: boolean }) {
  const [value, setValue] = useState("");
  return (
    <DisplayReader kind="scale" id="gross" label="Gross weight" unit="kg" value={value} onChange={setValue} onResolved={(r) => { last = r; }} t={t} online={online} />
  );
}

beforeAll(() => {
  URL.createObjectURL = () => "blob:test";
  URL.revokeObjectURL = () => {};
});
afterEach(() => cleanup());

async function upload(result: ReadingResult) {
  client.result = result;
  const input = screen.getByTestId("gross-photo") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], "scale.jpg", { type: "image/jpeg" })] } });
}
const ok: ReadingResult = { status: "ok", kind: "scale", value: "860.0", displayed: { value: "860", unit: "kg" }, confidence: "high", caution: false };
const field = () => screen.queryByRole("textbox") as HTMLInputElement | null;

describe("DisplayReader", () => {
  it("shows the photo beside the AI value and does not put the value in the field", async () => {
    render(<Harness />);
    await upload(ok);
    expect((await screen.findByTestId("gross-ai-value")).textContent).toContain("860.0");
    expect(screen.getByAltText(t.photoAlt)).toBeTruthy();
    expect(field()).toBeNull(); // nothing to type into, nothing prefilled, until the operator decides
    expect(last.blocked).toBe("decide");
  });

  it("fills the field only after the operator confirms", async () => {
    render(<Harness />);
    await upload(ok);
    fireEvent.click(await screen.findByTestId("gross-accept"));
    expect(field()!.value).toBe("860.0");
    expect(last).toEqual({ meta: { source: "ai_confirmed", aiValue: "860.0", aiConfidence: "high" }, blocked: null });
  });

  it("makes the operator tick a box before a different value can be used", async () => {
    render(<Harness />);
    await upload(ok);
    fireEvent.click(await screen.findByTestId("gross-correct"));
    fireEvent.change(field()!, { target: { value: "850.0" } });
    expect(last.blocked).toBe("acknowledge");
    expect(screen.getByTestId("gross-blocked").textContent).toContain(t.needAcknowledge);
    fireEvent.click(screen.getByTestId("gross-ack"));
    expect(last).toEqual({ meta: { source: "ai_corrected", aiValue: "860.0", aiConfidence: "high" }, blocked: null });
  });

  it("lets the operator reject the reading and type by hand", async () => {
    render(<Harness />);
    await upload(ok);
    fireEvent.click(await screen.findByTestId("gross-reject"));
    fireEvent.change(field()!, { target: { value: "845.5" } });
    expect(last).toEqual({ meta: { source: "manual", aiValue: "860.0", aiConfidence: "high" }, blocked: null });
  });

  it("clears an accepted value when another photo is uploaded", async () => {
    render(<Harness />);
    await upload(ok);
    fireEvent.click(await screen.findByTestId("gross-accept"));
    await upload({ ...ok, value: "861.0" });
    await waitFor(() => expect(screen.getByTestId("gross-ai-value").textContent).toContain("861.0"));
    expect(field()).toBeNull();
    expect(last.blocked).toBe("decide");
  });

  it("when the AI is uncertain, says so, prefills nothing and asks for manual entry", async () => {
    render(<Harness />);
    await upload({ status: "uncertain", kind: "scale", reason: "low_confidence" });
    expect((await screen.findByTestId("gross-uncertain")).textContent).toContain(t.uncertain.low_confidence);
    expect(screen.getByText(new RegExp(t.notShown))).toBeTruthy();
    expect(field()!.value).toBe("");
    expect(last.blocked).toBeNull();
    fireEvent.change(field()!, { target: { value: "850.0" } });
    expect(last.meta).toEqual({ source: "manual" });
  });

  it.each(["timeout", "api_error", "malformed_response", "unsupported_format", "poor_quality", "missing_value"] as const)(
    "on %s shows a message, invents no value and leaves manual entry",
    async (code) => {
      render(<Harness />);
      await upload({ status: "failed", kind: "scale", code });
      expect((await screen.findByTestId("gross-failed")).textContent).toContain(t.failed[code]);
      expect(field()!.value).toBe("");
    },
  );

  it("warns when the AI is only moderately sure", async () => {
    render(<Harness />);
    await upload({ ...ok, confidence: "medium" as const, caution: true });
    expect(await screen.findByText(t.cautionMedium)).toBeTruthy();
  });

  it("offers only manual entry when the phone is offline", () => {
    render(<Harness online={false} />);
    expect(screen.queryByTestId("gross-photo")).toBeNull();
    expect(field()).not.toBeNull();
  });
});
