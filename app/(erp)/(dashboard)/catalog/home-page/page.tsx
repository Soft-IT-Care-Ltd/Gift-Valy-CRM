import { requirePagePermission } from "@/lib/page-auth";
import { getHomeEditorState } from "@/lib/home-page/service";
import { storefrontHosts, storefrontOrigin } from "@/lib/storefront/hosts";
import { HomeEditor } from "@/components/website/home-editor";

export const dynamic = "force-dynamic";

// ROUND3 W-7 — the website's home page manager (website.home: Admin,
// Manager): sections on/off and in order, banners with a desktop and a mobile
// photo, draft → preview on the real website → publish.
export default async function HomePageManager() {
  await requirePagePermission("website.home");
  const state = await getHomeEditorState();
  return <HomeEditor initial={state} websiteUrl={storefrontHosts().length > 0 ? storefrontOrigin() : null} />;
}
