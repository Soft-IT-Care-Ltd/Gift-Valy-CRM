import { requirePagePermission } from "@/lib/page-auth";
import { loadMetaSettingsView, recentMetaEvents } from "@/lib/meta/settings";
import { storefrontHosts, storefrontOrigin } from "@/lib/storefront/hosts";
import { readWebsiteSettingsForm } from "@/lib/website-settings";
import { WebsiteSettingsClient } from "@/components/settings/website-settings-client";

export const dynamic = "force-dynamic";

// ROUND3 W-7 / W-8 — Settings → Website (Admin: settings.manage): the website
// on/off switch, contacts, delivery times, the WhatsApp/Messenger messages,
// the policy texts, the website-order rules, display and SEO, and the Meta
// Pixel + Conversions API.
export default async function WebsiteSettingsPage() {
  await requirePagePermission("settings.manage");
  const [form, meta, events] = await Promise.all([readWebsiteSettingsForm(), loadMetaSettingsView(), recentMetaEvents()]);
  return (
    <WebsiteSettingsClient
      initial={form}
      meta={meta}
      events={events}
      websiteUrl={storefrontHosts().length > 0 ? storefrontOrigin() : null}
    />
  );
}
