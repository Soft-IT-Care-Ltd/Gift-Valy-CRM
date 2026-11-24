import { requireUser, apiError } from "@/lib/authz";
import { getEffectivePermissions } from "@/lib/rbac";
import { invoicePdfHandler } from "@/lib/invoice-print";

type Params = { params: Promise<{ id: string }> };

// GET /api/orders/[id]/invoice[?version=N][&disposition=inline] — the invoice
// PDF. Who may open it (order scope, or the Packing queue with invoice.print,
// ROUND3 R3-3) and everything it does live in lib/invoice-print.ts.
export async function GET(req: Request, { params }: Params) {
  try {
    const session = await requireUser();
    const permissions = await getEffectivePermissions(session.user.id);
    const id = Number((await params).id);
    return await invoicePdfHandler(req, { session, permissions }, id);
  } catch (e) {
    return apiError(e);
  }
}
