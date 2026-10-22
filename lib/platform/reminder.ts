import { prisma } from "@/lib/db";
import { dhakaDay, reminderSeenKey } from "./billing-display";

// FUNNEL_LINER.md GV-9 — the Admin's once-a-Dhaka-day pop-up, remembered on
// the server: one settings row per person holding the last Dhaka day it was
// shown (no new table). The pop-up records itself when it opens, so closing
// the tab still counts as seen.

export async function reminderSeenToday(userId: number, now = new Date()): Promise<boolean> {
  const row = await prisma.setting.findUnique({ where: { key: reminderSeenKey(userId) } });
  return row?.value === dhakaDay(now);
}

export async function markReminderSeen(userId: number, now = new Date()): Promise<void> {
  const key = reminderSeenKey(userId);
  const value = dhakaDay(now);
  await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
}
