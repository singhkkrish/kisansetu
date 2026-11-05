import { z } from "zod";
import { authorizeRequest, jsonError } from "@/lib/api/http";
import { paymentErrorResponse } from "@/lib/api/payment-errors";
import { buildBankFile, loadBankFileConfig } from "@/lib/payments/bank-file";
import { getBankFileRows } from "@/lib/services/payments";

/**
 * Downloads the MOCK bank file for an approved run. The first download marks
 * the run as sent to the bank; later downloads only record that the file was
 * fetched again. A POST, not a GET, because it changes the run's state.
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await authorizeRequest("payment_runs:approve");
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return jsonError(404, "Not found");

  const started = await auth.supabase.rpc("start_bank_file", { p_run_id: id });
  if (started.error) return paymentErrorResponse(started.error);

  const { rows, fileName, error } = await getBankFileRows(auth.supabase, id);
  if (error || rows.length === 0) return jsonError(500, "Something went wrong. Please try again");

  const file = buildBankFile(rows, loadBankFileConfig());
  return new Response(file.content, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
      "Cache-Control": "no-store",
      "X-Mock-Bank-File": "true",
    },
  });
}
