const TOKEN = process.env.TRILIUM_ETAPI_TOKEN;
const BASE = (process.env.TRILIUM_URL ?? "http://localhost:8080").replace(/\/+$/, "").replace(/\/etapi$/, "");

if (!TOKEN) {
  console.error("TRILIUM_ETAPI_TOKEN is required (Trilium: Options -> ETAPI -> Create token)");
  process.exit(1);
}

export type FetchBody = NonNullable<RequestInit["body"]>;

export type Query = Record<string, string | number | boolean | undefined>;

export interface RequestOptions {
  query?: Query;
  /** JSON body */
  json?: unknown;
  /** Raw body with explicit content type (note/attachment content, zip import) */
  body?: FetchBody;
  contentType?: string;
  signal: AbortSignal;
}

export class EtapiError extends Error {
  constructor(readonly status: number, readonly code: string | undefined, detail: string) {
    super(EtapiError.hint(status, code, detail));
  }

  static hint(status: number, code: string | undefined, detail: string): string {
    const base = `Trilium ETAPI ${status}${code ? ` ${code}` : ""}: ${detail.replace(/\.+$/, "")}`;
    switch (status) {
      case 401:
        return `${base}. Check TRILIUM_ETAPI_TOKEN (Options -> ETAPI).`;
      case 404:
        return `${base}. Use trilium_search_notes to find valid note IDs.`;
      case 429:
        return `${base}. Too many requests; wait before retrying.`;
      default:
        return base;
    }
  }
}

/** Single entry point to ETAPI. Returns the raw Response (ok only). */
export async function etapi(method: string, path: string, opts: RequestOptions): Promise<Response> {
  const url = new URL(`${BASE}/etapi${path}`);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));

  const headers: Record<string, string> = { Authorization: TOKEN! };
  let body: FetchBody | undefined = opts.body;
  if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.json);
  } else if (opts.contentType) {
    headers["Content-Type"] = opts.contentType;
  }

  let res: Response;
  try {
    res = await fetch(url, { method, headers, body, signal: AbortSignal.any([opts.signal, AbortSignal.timeout(30_000)]) });
  } catch (e) {
    if (e instanceof DOMException && e.name === "TimeoutError") {
      throw new Error(`Trilium at ${BASE} did not respond within 30s.`);
    }
    throw new Error(`Cannot reach Trilium at ${BASE} (${(e as Error).message}). Check TRILIUM_URL.`);
  }

  if (!res.ok) {
    const text = await res.text();
    let code: string | undefined;
    let detail = text || res.statusText;
    try {
      const err = JSON.parse(text) as { code?: string; message?: string };
      code = err.code;
      detail = err.message ?? detail;
    } catch {
      /* non-JSON error body */
    }
    throw new EtapiError(res.status, code, detail);
  }
  return res;
}

/** JSON helper: returns parsed body, or undefined for 204. */
export async function etapiJson<T = unknown>(method: string, path: string, opts: RequestOptions): Promise<T | undefined> {
  const res = await etapi(method, path, opts);
  if (res.status === 204) return undefined;
  return (await res.json()) as T;
}
