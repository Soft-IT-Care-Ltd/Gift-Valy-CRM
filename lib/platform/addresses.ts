// FUNNEL_LINER.md GV-6 / CLAUDE.md rule 9 — the two addresses this app is
// reached by.
//
//   NEXTAUTH_URL  the address PEOPLE use (https://dashboard.funnelliner.com):
//                 sign-in and every link a person follows.
//   INSTANCE_URL  the address MACHINES use (…/_c/giftvaly): callbacks another
//                 system calls with no cookie — the Steadfast webhook. Nginx
//                 strips /_c/giftvaly before the request reaches this app.
//
// dashboard.funnelliner.com is shared by every Funnel Liner client, so a
// machine URL built from NEXTAUTH_URL would land on the shared sign-in page,
// not here. Never hardcode a host name.

const trimSlash = (u: string) => u.replace(/\/+$/, "");

/**
 * The address machines use: INSTANCE_URL, else NEXTAUTH_URL, else
 * `fallbackOrigin` (the request's own origin — development with neither set).
 */
export function instanceUrl(
  fallbackOrigin = "",
  env: Record<string, string | undefined> = process.env
): string {
  return trimSlash(env.INSTANCE_URL?.trim() || env.NEXTAUTH_URL?.trim() || fallbackOrigin);
}

/** The URL Steadfast posts delivery updates to (shown on the Courier page). */
export function steadfastCallbackUrl(
  fallbackOrigin = "",
  env: Record<string, string | undefined> = process.env
): string {
  return `${instanceUrl(fallbackOrigin, env)}/api/webhooks/steadfast`;
}
