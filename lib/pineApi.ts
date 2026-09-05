/**
 * Pine Liquidity API client.
 *
 * Unauthenticated (analytical data, no user PII).
 * Calls the backend /pine/* endpoints registered in routes/pine.ts.
 *
 * No caching, no calculations — pure data fetch from backend engine.
 */
import { PineActiveLevel, PinePDZoneState, PineSignal } from "../types/pine";

function getBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_BACKEND_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    "http://localhost:4000"
  );
}

export async function fetchPineLevels(
  instrument: string,
  chartTF: number = 15
): Promise<PineActiveLevel[]> {
  const encoded = encodeURIComponent(instrument);
  const res = await fetch(`${getBaseUrl()}/pine/levels/${encoded}?tf=${chartTF}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch Pine levels for ${instrument}: ${res.status}`);
  }
  const data = await res.json();
  return data.levels as PineActiveLevel[];
}

export async function fetchPineSignals(instrument: string): Promise<PineSignal[]> {
  const encoded = encodeURIComponent(instrument);
  const res = await fetch(`${getBaseUrl()}/pine/signals/${encoded}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    return [];
  }
  const data = await res.json();
  return (data.signals || []) as PineSignal[];
}

export async function fetchPinePDZone(instrument: string): Promise<PinePDZoneState | null> {
  const encoded = encodeURIComponent(instrument);
  const res = await fetch(`${getBaseUrl()}/pine/zone/${encoded}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch Pine P/D zone for ${instrument}: ${res.status}`);
  }
  const data = await res.json();
  return data.zone as PinePDZoneState | null;
}

export async function fetchPineCandles(instrument: string): Promise<any[]> {
  const encoded = encodeURIComponent(instrument);
  const res = await fetch(`${getBaseUrl()}/pine/candles/${encoded}`, {
    cache: "no-store",
  });
  if (!res.ok) {
    return [];
  }
  const data = await res.json();
  return data.candles || [];
}
