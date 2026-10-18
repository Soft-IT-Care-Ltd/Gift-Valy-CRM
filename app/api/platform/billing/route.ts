import { billingHandler } from "@/lib/platform/handlers";

// FUNNEL_LINER.md GV-4 — Funnel Liner pushes the billing snapshot (plan, invoices, how to pay).
// Machine-to-machine: "Authorization: Bearer <PLATFORM_SECRET>", no session.
// The handler (lib/platform/handlers.ts) checks the secret before anything else.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return billingHandler(req);
}
