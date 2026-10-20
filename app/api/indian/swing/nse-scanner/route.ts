/**
 * NSE Swing Scanner — Next.js Thin Proxy
 *
 * Production deployment note:
 *   next.config.ts rewrites all /api/indian/* → trading-journey-backend.onrender.com,
 *   so in production this file is NEVER invoked. The actual endpoints live in
 *   backend/src/routes/indianTrading.ts and are served by the Fastify process on Render.
 *
 * Dev / local note:
 *   When running `npm run dev` the Next.js dev server does NOT apply the rewrites,
 *   so this file handles local requests. In local dev mode we proxy manually to
 *   the local Fastify backend (port 4000 by default).
 *
 * API surface (mirrored from the backend routes):
 *
 *   POST /api/indian/swing/nse-scanner/start
 *     Body: { dry_run?, max_symbols?, force_universe?, force_restart? }
 *     → 202 { accepted, jobId, message }
 *
 *   GET  /api/indian/swing/nse-scanner/status?job=<id>
 *     → { status, percentComplete, symbolsProcessed, symbolsTotal, ... }
 *
 *   GET  /api/indian/swing/nse-scanner/results?job=<id>&strategy=ALL&limit=200
 *     → { opportunities[], coverage{}, ... }
 *
 *   DELETE /api/indian/swing/nse-scanner/abort?job=<id>
 *     → { success, message }
 *
 * Safety: LIVE_TRADING=false is enforced inside the backend worker. This file
 * contains no business logic that could place orders.
 */

import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// ─────────────────────────────────────────────────────────────────────────────
// Backend URL resolution
// ─────────────────────────────────────────────────────────────────────────────

function getBackendUrl(): string {
  return (
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    process.env.BACKEND_URL ||
    "http://localhost:4000"
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic passthrough proxy helper
// ─────────────────────────────────────────────────────────────────────────────

async function proxyToBackend(
  req: NextRequest,
  subpath: string,
  method: string,
  body?: unknown
): Promise<NextResponse> {
  const backend = getBackendUrl();
  const url = new URL(req.url);
  const targetUrl = `${backend}/api/indian/swing/nse-scanner/${subpath}${url.search}`;

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };

    // Forward authorization if present
    const auth = req.headers.get("authorization");
    if (auth) headers["Authorization"] = auth;

    const backendRes = await fetch(targetUrl, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(30_000), // 30s for polling endpoints
    });

    const data = await backendRes.json().catch(() => ({
      success: false,
      error: "Backend returned non-JSON response",
    }));

    return NextResponse.json(data, { status: backendRes.status });
  } catch (err: any) {
    const isTimeout = err?.name === "TimeoutError" || err?.message?.includes("timeout");
    return NextResponse.json(
      {
        success: false,
        error: isTimeout
          ? "Backend request timed out. The scan is still running — poll /status for progress."
          : `Backend unreachable: ${err.message}`,
        backendUrl: backend,
      },
      { status: 503 }
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Route handlers — each method dispatches to the correct backend sub-route
// ─────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/indian/swing/nse-scanner
 *
 * In production: handled by next.config.ts rewrite → backend.
 * In local dev: proxies to POST http://localhost:4000/api/indian/swing/nse-scanner/start
 *
 * Body: { dry_run?, max_symbols?, force_universe?, force_restart? }
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const body = await req.json().catch(() => ({}));
  return proxyToBackend(req, "start", "POST", body);
}

/**
 * GET /api/indian/swing/nse-scanner?sub=status|results
 *
 * In production: handled by next.config.ts rewrite → backend.
 * In local dev: proxies to the backend based on ?sub= param.
 *
 * ?sub=status  → GET /api/indian/swing/nse-scanner/status
 * ?sub=results → GET /api/indian/swing/nse-scanner/results
 * (default)    → GET /api/indian/swing/nse-scanner/status  (polling-friendly default)
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const sub = url.searchParams.get("sub") || "status";
  if (sub !== "status" && sub !== "results") {
    return NextResponse.json(
      { success: false, error: `Unknown sub-route "${sub}". Use sub=status or sub=results.` },
      { status: 400 }
    );
  }
  return proxyToBackend(req, sub, "GET");
}

/**
 * DELETE /api/indian/swing/nse-scanner?job=<id>
 *
 * In production: handled by next.config.ts rewrite → backend.
 * In local dev: proxies to DELETE http://localhost:4000/api/indian/swing/nse-scanner/abort
 */
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  return proxyToBackend(req, "abort", "DELETE");
}
