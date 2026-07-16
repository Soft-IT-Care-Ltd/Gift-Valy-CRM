import { NextResponse } from "next/server";
import { requirePermission, apiError } from "@/lib/authz";
import { testWhatsAppConnection } from "@/lib/whatsapp";

// POST — verify the saved Phone Number ID + Access Token against the Graph
// API without messaging anyone (reads the number's own profile).
export async function POST() {
  try {
    await requirePermission("settings.manage");
    return NextResponse.json(await testWhatsAppConnection());
  } catch (e) {
    return apiError(e);
  }
}
