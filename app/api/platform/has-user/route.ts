import { hasUserHandler } from "@/lib/platform/handlers";

// FUNNEL_LINER.md GV-5 — "is this number yours?" for the shared sign-in page.
// Machine-to-machine: "Authorization: Bearer <PLATFORM_SECRET>", no session.
// The handler (lib/platform/handlers.ts) checks the secret before anything else.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  return hasUserHandler(req);
}
