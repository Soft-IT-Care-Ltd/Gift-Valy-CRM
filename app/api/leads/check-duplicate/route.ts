import { NextResponse } from "next/server";
import { requirePermissionCtx, apiError } from "@/lib/authz";
import { findDuplicates, leadScopeWhere } from "@/lib/leads";

// SPEC §3.1 — duplicate-phone check for the lead entry form. Warns if the
// WhatsApp number already exists as a lead (within the caller's scope) or as a
// saved customer, and returns the history so the SE knows who they're
// re-contacting.
export async function GET(req: Request) {
  try {
    const { session, permissions } = await requirePermissionCtx("leads.create");
    const phone = new URL(req.url).searchParams.get("phone") ?? "";
    if (phone.replace(/\D/g, "").length < 6) {
      return NextResponse.json({ leads: [], customer: null });
    }
    // A creator always has at least own-scope; fall back defensively.
    let scope;
    try {
      scope = await leadScopeWhere(session, permissions);
    } catch {
      scope = { assignedTo: session.user.id };
    }
    const hit = await findDuplicates(phone, scope);
    return NextResponse.json(hit);
  } catch (e) {
    return apiError(e);
  }
}
