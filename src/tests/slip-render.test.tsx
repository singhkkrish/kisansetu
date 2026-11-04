import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SlipCard } from "@/components/slip/slip-card";
import { buildSlip, type SlipInput } from "@/lib/slip/slip";

const input: SlipInput = {
  slipNo: "C07-24518",
  farmerName: "रामेश्वर पाटील",
  farmerCode: "FM00101",
  village: "औसा",
  centreName: "Latur Centre",
  centreCode: "C07",
  crop: "soybean",
  grade: "A",
  grossKg: "1250.0",
  tareKg: "18.0",
  moisturePct: "11.5",
  ratePerQuintal: "4850.00",
  netKg: "1232.0",
  amount: "59752.00",
  rateDate: "2026-11-02",
  rateVersion: 1,
  recordedAt: "2026-11-02T00:40:00.000Z",
  serverReceivedAt: null,
  paymentStatus: "unpaid",
};

describe("slip rendering", () => {
  it("shows Marathi labels and values with English beneath", () => {
    const html = renderToStaticMarkup(<SlipCard model={buildSlip(input)} lang="both" />);
    expect(html).toContain("खरेदी पावती");
    expect(html).toContain("Purchase slip");
    expect(html).toContain("सोयाबीन");
    expect(html).toContain("रामेश्वर पाटील");
    expect(html).toContain("C07-24518");
    expect(html).toContain('lang="mr"');
    expect(html).toContain('data-testid="slip-dispute"');
    expect(html).toContain("पैसे अजून दिलेले नाहीत");
  });

  it("renders a single language when asked", () => {
    const mr = renderToStaticMarkup(<SlipCard model={buildSlip(input)} lang="mr" />);
    expect(mr).not.toContain("Purchase slip");
    const en = renderToStaticMarkup(<SlipCard model={buildSlip(input)} lang="en" />);
    expect(en).not.toContain("खरेदी पावती");
    expect(en).toContain("Purchase slip");
  });
});
