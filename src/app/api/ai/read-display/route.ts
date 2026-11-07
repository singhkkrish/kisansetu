import { handleReadDisplay } from "@/lib/ai/handler";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  return handleReadDisplay(request);
}
