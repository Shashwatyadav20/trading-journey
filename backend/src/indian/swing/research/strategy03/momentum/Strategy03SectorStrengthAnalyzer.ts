export interface SectorStrengthSummary {
  sector: string;
  stockCount: number;
  avgRs50dPp: number;
  isLeadingSector: boolean;
}

export function analyzeSectorStrength(
  items: Array<{ sector: string; rsVsNifty50dPp: number | null }>
): Map<string, SectorStrengthSummary> {
  const bySec = new Map<string, number[]>();
  for (const it of items) {
    if (it.rsVsNifty50dPp === null) continue;
    const arr = bySec.get(it.sector) ?? [];
    arr.push(it.rsVsNifty50dPp);
    bySec.set(it.sector, arr);
  }
  const out = new Map<string, SectorStrengthSummary>();
  for (const [sector, vals] of bySec.entries()) {
    const avg = Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100;
    out.set(sector, {
      sector,
      stockCount: vals.length,
      avgRs50dPp: avg,
      isLeadingSector: avg > 0,
    });
  }
  return out;
}

