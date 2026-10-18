import { stateHandler } from "@/lib/platform/handlers";

// FUNNEL_LINER.md GV-3 — Funnel Liner pushes the billing state (active / past_due / suspended).
// Machine-to-machine: "Authorization: Bearer <PLATFORM_SECRET>", no session.
// The handler (lib/platform/handlers.ts) checks the secret before anything else.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return stateHandler(req);
}
