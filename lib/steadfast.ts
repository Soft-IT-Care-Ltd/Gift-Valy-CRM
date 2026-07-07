// ============ Steadfast API client (STEADFAST_INTEGRATION.md §1/§2/§3/§5) ============
//
// Server-side ONLY — never imported by a client component; keys stay on the
// server (§5). Reached only through the /api/couriers/steadfast/* routes and the
// webhook/poll flows. V1 base URL + Api-Key/Secret-Key headers per the doc. Every call
// has a timeout and 2 retries with backoff on network/5xx errors; failures throw
// SteadfastApiError with a readable message and are logged by callers, never
// crashing the app (§5).

const BASE_URL =
  process.env.STEADFAST_BASE_URL || "https://portal.packzy.com/api/v1";
const TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;

export interface SteadfastCreds {
  apiKey: string;
  secretKey: string;
}

export class SteadfastApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public body?: unknown
  ) {
    super(message);
    this.name = "SteadfastApiError";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function steadfastFetch<T>(
  creds: SteadfastCreds,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown }
): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const headers: Record<string, string> = {
    "Api-Key": creds.apiKey,
    "Secret-Key": creds.secretKey,
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: init.method,
        headers,
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: controller.signal,
        cache: "no-store",
      });
      clearTimeout(timer);

      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = text;
      }

      // 5xx → retry; 4xx → surface immediately (bad keys, bad payload).
      if (res.status >= 500) {
        lastErr = new SteadfastApiError(
          `Steadfast ${res.status} on ${path}`,
          res.status,
          json
        );
        if (attempt < MAX_RETRIES) {
          await sleep(300 * (attempt + 1));
          continue;
        }
        throw lastErr;
      }
      if (!res.ok) {
        const msg =
          (json && typeof json === "object" && "message" in json
            ? String((json as { message: unknown }).message)
            : null) ?? `Steadfast request failed (${res.status})`;
        throw new SteadfastApiError(msg, res.status, json);
      }
      return json as T;
    } catch (e) {
      clearTimeout(timer);
      // Abort/network errors are retryable; a thrown SteadfastApiError (4xx) is not.
      if (e instanceof SteadfastApiError && e.status && e.status < 500) throw e;
      lastErr = e;
      if (attempt < MAX_RETRIES) {
        await sleep(300 * (attempt + 1));
        continue;
      }
    }
  }
  const detail =
    lastErr instanceof Error ? lastErr.message : "network error";
  throw new SteadfastApiError(`Steadfast unreachable on ${path}: ${detail}`);
}

// ---------- balance (§1 Test Connection + balance widget) ----------

export interface BalanceResponse {
  status: number;
  current_balance: number;
}

export async function getBalance(creds: SteadfastCreds): Promise<number> {
  const res = await steadfastFetch<BalanceResponse>(creds, "/get_balance", {
    method: "GET",
  });
  return Number(res?.current_balance ?? 0);
}

// ---------- create order (§2) ----------

export interface CreateOrderPayload {
  invoice: string;
  recipient_name: string;
  recipient_phone: string;
  recipient_address: string;
  cod_amount: number;
  note?: string;
  item_description?: string;
  alternative_phone?: string;
  delivery_type?: number; // 0 = home delivery
  total_lot?: number;
}

export interface Consignment {
  consignment_id: number;
  invoice: string;
  tracking_code: string;
  recipient_name?: string;
  recipient_phone?: string;
  recipient_address?: string;
  cod_amount?: number;
  status?: string; // "in_review"
}

export interface CreateOrderResponse {
  status: number;
  message?: string;
  consignment?: Consignment;
}

export async function createOrder(
  creds: SteadfastCreds,
  payload: CreateOrderPayload
): Promise<Consignment> {
  const res = await steadfastFetch<CreateOrderResponse>(creds, "/create_order", {
    method: "POST",
    body: payload,
  });
  if (!res?.consignment?.consignment_id) {
    throw new SteadfastApiError(
      res?.message || "Steadfast did not return a consignment",
      res?.status,
      res
    );
  }
  return res.consignment;
}

// Bulk: 2–500 orders, `data` = JSON array (doc). Response has a per-item status.
export interface BulkResultItem {
  invoice: string;
  recipient_name?: string;
  recipient_phone?: string;
  recipient_address?: string;
  cod_amount?: number;
  consignment_id?: number;
  tracking_code?: string;
  status: string; // "success" | "error"
  note?: string;
}

export interface BulkResponse {
  status: number;
  message?: string;
  data?: BulkResultItem[];
}

export async function createBulkOrder(
  creds: SteadfastCreds,
  payloads: CreateOrderPayload[]
): Promise<BulkResultItem[]> {
  const res = await steadfastFetch<BulkResponse>(
    creds,
    "/create_order/bulk-order",
    { method: "POST", body: { data: JSON.stringify(payloads) } }
  );
  if (!Array.isArray(res?.data)) {
    throw new SteadfastApiError(
      res?.message || "Steadfast bulk create returned no data",
      res?.status,
      res
    );
  }
  return res.data;
}

// ---------- status polling (§3B) ----------

export interface StatusResponse {
  status: number;
  delivery_status?: string;
}

export async function statusByCid(
  creds: SteadfastCreds,
  consignmentId: number | bigint
): Promise<string | null> {
  const res = await steadfastFetch<StatusResponse>(
    creds,
    `/status_by_cid/${consignmentId}`,
    { method: "GET" }
  );
  return res?.delivery_status ?? null;
}

export async function statusByInvoice(
  creds: SteadfastCreds,
  invoice: string
): Promise<string | null> {
  const res = await steadfastFetch<StatusResponse>(
    creds,
    `/status_by_invoice/${encodeURIComponent(invoice)}`,
    { method: "GET" }
  );
  return res?.delivery_status ?? null;
}
