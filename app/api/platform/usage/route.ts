import { usageHandler } from "@/lib/platform/handlers";

// FUNNEL_LINER.md GV-2 — how many orders this ERP created per Dhaka month (the billed number).
// Machine-to-machine: "Authorization: Bearer <PLATFORM_SECRET>", no session.
// The handler (lib/platform/handlers.ts) checks the secret before anything else.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return usageHandler(req);
}
