// ROUND3 W-5 — the visitor's address, for the per-IP order limit and the
// audit row. On the server Nginx sets X-Real-IP and X-Forwarded-For to
// $remote_addr — never appended to what the visitor sent — after
// snippets/cloudflare-real-ip.conf has swapped in CF-Connecting-IP for
// requests that really came from Cloudflare's ranges
// (snippets/antu-app-proxy.conf). The giftvaly.com server block (W-10) must
// include the same two snippets. Without Nginx (a developer's machine, the
// tests) whatever the header says is used. Pure: no Next or Node imports.

function v4(ip: string): boolean {
  const parts = ip.split(".");
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

/** A bare IPv4/IPv6 address, normalised (IPv4-mapped IPv6 → IPv4), or null if it isn't one. */
export function normalizeIp(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let ip = raw.trim().toLowerCase();
  if (ip.startsWith("[") && ip.includes("]")) ip = ip.slice(1, ip.indexOf("]"));
  if (ip.startsWith("::ffff:") && v4(ip.slice(7))) ip = ip.slice(7);
  if (v4(ip)) return ip;
  if (ip.includes(":") && /^[0-9a-f:]{2,39}$/.test(ip) && ip.split("::").length <= 2) return ip;
  return null;
}

export function clientIp(headers: Headers): string | null {
  return normalizeIp(headers.get("x-real-ip")) ?? normalizeIp(headers.get("x-forwarded-for")?.split(",")[0]);
}
