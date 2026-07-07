import { prisma } from "./db";

// SPEC §14 settings table — JSON values keyed by string. Missing keys fall
// back to code defaults so no seed row is required.
export const SETTING_KEYS = {
  orderEditWindowMinutes: "order_edit_window_minutes",
} as const;

export async function getNumberSetting(
  key: string,
  fallback: number
): Promise<number> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return typeof row?.value === "number" ? row.value : fallback;
}

// SPEC §4.2 — SE self-edit window after order creation, default 30 minutes.
export async function getOrderEditWindowMinutes(): Promise<number> {
  return getNumberSetting(SETTING_KEYS.orderEditWindowMinutes, 30);
}
