import { requireUser, apiError } from "@/lib/authz";
import { getEffectivePermissions } from "@/lib/rbac";
import { printInvoicesHandler } from "@/lib/invoice-print";

// CORRECTIONS Orders §6h — bulk invoice print from the CONFIRMED and PACKED
// tabs and (ROUND3 R3-3) the Packing screen: multi-select → one PDF print job,
// two half-A4 invoices per page (§6i). Renders CURRENT order data and creates
// no invoice rows. Logic + access rules: lib/invoice-print.ts.
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const session = await requireUser();
    const permissions = await getEffectivePermissions(session.user.id);
    return await printInvoicesHandler(req, { session, permissions });
  } catch (e) {
    return apiError(e);
  }
}
