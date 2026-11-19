import fs from "node:fs";
import path from "node:path";
import type { FourHourPreBreakoutItem } from "./prebreakout/Strategy03FourHourPreBreakoutScanner.js";

const P61019_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase61019");
const OUT_DIR = path.resolve("D:/Trading/my-app/backend/data/research/strategy03/phase610197");

export type ReadyAuditQualityClass =
  | "PRIORITY_REVIEW"
  | "GOOD_WATCHLIST"
  | "WEAK_EVIDENCE"
  | "REJECTED";

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const watchlist = JSON.parse(
    fs.readFileSync(path.join(P61019_DIR, "prebreakout_watchlist.json"), "utf8")
  ) as FourHourPreBreakoutItem[];

  const readyItems = watchlist.filter((w) => w.status === "READY");
  const now = new Date("2026-11-18T12:37:50+05:30");

  const audited = readyItems.map((it) => {
    const flags: string[] = [];
    const lastMs = Date.parse(it.lastUpdatedIst);
    const dataAgeHours = Number.isFinite(lastMs) ? round2((now.getTime() - lastMs) / 3_600_000) : 999;

    if (it.supportZone.supportRelevance !== "IMMEDIATE") {
      flags.push(`DISTANT_SUPPORT (${it.supportZone.supportDistancePct ?? "?"}% below)`);
    }
    if (!it.orderBlock.detected) {
      flags.push("MISSING_BULLISH_OB");
    }
    if (!it.impulse.volumeConfirmed) {
      flags.push(`WEAK_IMPULSE_VOLUME (${it.impulse.rvol}x < 1.15x)`);
    }
    if ((it.consolidation.rangePct ?? 99) > 5.0) {
      flags.push(`WIDE_CONSOLIDATION (${it.consolidation.rangePct}%)`);
    }
    if (dataAgeHours > 72) {
      flags.push(`STALE_DATA (${dataAgeHours}h)`);
    }
    const brokenOrInv =
      it.currentPrice !== null &&
      it.consolidation.high !== null &&
      it.consolidation.low !== null &&
      (it.currentPrice > it.consolidation.high * 1.001 || it.currentPrice < it.consolidation.low);
    if (brokenOrInv) {
      flags.push("ALREADY_BROKEN_OR_INVALIDATED");
    }

    let qualityClass: ReadyAuditQualityClass = "GOOD_WATCHLIST";
    if (brokenOrInv || dataAgeHours > 96) {
      qualityClass = "REJECTED";
    } else if (
      it.supportZone.supportRelevance === "IMMEDIATE" &&
      it.orderBlock.detected &&
      it.impulse.volumeConfirmed &&
      (it.consolidation.rangePct ?? 99) <= 5.0
    ) {
      qualityClass = "PRIORITY_REVIEW";
    } else if (flags.length >= 2 && it.priorityScore < 75) {
      qualityClass = "WEAK_EVIDENCE";
    }

    return {
      symbol: it.nseSymbol,
      companyName: it.companyName,
      latestCompleted4hClose: it.currentPrice,
      lastUpdatedIst: it.lastUpdatedIst,
      dataAgeHours,
      priorityScore: it.priorityScore,
      scoringReasons: it.scoringReasons,
      consolidationCategory: it.consolidation.tier,
      completedBlockCount: it.consolidation.candleCount,
      tradingDaysElapsed: it.consolidation.tradingDaysElapsed,
      consolidationHigh: it.consolidation.high,
      consolidationLow: it.consolidation.low,
      consolidationRangePct: it.consolidation.rangePct,
      breakoutDistancePct: it.breakoutDistancePct,
      impulseCandleCount: it.impulse.candleCount,
      impulseDisplacementPct: it.impulse.displacementPct,
      normalizedRvol: it.impulse.rvol,
      volumeConfirmed: it.impulse.volumeConfirmed,
      supportRange: [it.supportZone.supportLow, it.supportZone.supportHigh],
      supportDistancePct: it.supportZone.supportDistancePct,
      supportRelevance: it.supportZone.supportRelevance,
      liquiditySweepDetected: it.supportZone.liquiditySweepDetected,
      bullishObDetected: it.orderBlock.detected,
      bullishObRange: it.orderBlock.detected ? [it.orderBlock.obLow, it.orderBlock.obHigh] : null,
      bullishObTimestampIst: it.orderBlock.timestampIst,
      independentVerificationStatus: it.independentVerificationStatus,
      weaknessFlags: flags,
      qualityClass,
    };
  });

  const classOrder: Record<ReadyAuditQualityClass, number> = {
    PRIORITY_REVIEW: 0,
    GOOD_WATCHLIST: 1,
    WEAK_EVIDENCE: 2,
    REJECTED: 3,
  };

  const rankFn = (a: (typeof audited)[0], b: (typeof audited)[0]) => {
    const cDiff = classOrder[a.qualityClass] - classOrder[b.qualityClass];
    if (cDiff !== 0) return cDiff;
    if (a.weaknessFlags.length !== b.weaknessFlags.length) return a.weaknessFlags.length - b.weaknessFlags.length;
    if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
    return (a.breakoutDistancePct ?? 99) - (b.breakoutDistancePct ?? 99);
  };

  audited.sort(rankFn);

  const classCounts = {
    PRIORITY_REVIEW: audited.filter((a) => a.qualityClass === "PRIORITY_REVIEW").length,
    GOOD_WATCHLIST: audited.filter((a) => a.qualityClass === "GOOD_WATCHLIST").length,
    WEAK_EVIDENCE: audited.filter((a) => a.qualityClass === "WEAK_EVIDENCE").length,
    REJECTED: audited.filter((a) => a.qualityClass === "REJECTED").length,
  };

  const separated = {
    SHORT: audited.filter((a) => a.consolidationCategory === "SHORT_HIGH_QUALITY"),
    MEDIUM: audited.filter((a) => a.consolidationCategory === "MEDIUM_CLEAN"),
    LONG: audited.filter((a) => a.consolidationCategory === "LONG_CLEAN"),
  };

  const priorityReviewList = audited.filter((a) => a.qualityClass === "PRIORITY_REVIEW");

  fs.writeFileSync(
    path.join(OUT_DIR, "ready_83_quality_audit.json"),
    JSON.stringify({ totalReadyAudited: audited.length, classCounts, records: audited }, null, 2)
  );
  fs.writeFileSync(path.join(OUT_DIR, "separated_watchlists_by_duration.json"), JSON.stringify(separated, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "priority_review_watchlist.json"), JSON.stringify(priorityReviewList, null, 2));

  const md = [
    "# Phase 6.10.19.7 — Full 83 READY Candidate Quality Audit",
    "",
    `- **Total READY Audited:** ${audited.length}`,
    `- **Classifications:** \`PRIORITY_REVIEW=${classCounts.PRIORITY_REVIEW}\`, \`GOOD_WATCHLIST=${classCounts.GOOD_WATCHLIST}\`, \`WEAK_EVIDENCE=${classCounts.WEAK_EVIDENCE}\`, \`REJECTED=${classCounts.REJECTED}\``,
    `- **By Duration Group:** SHORT=${separated.SHORT.length}, MEDIUM=${separated.MEDIUM.length}, LONG=${separated.LONG.length}`,
    "",
    "## Top Priority Review List (`PRIORITY_REVIEW` — Immediate Support + Valid OB + Volume Confirmed + Tight Range <= 5%)",
    "",
    "| # | Symbol | Category | Blocks/Days | Score | Close | Range % | Dist % | Support Dist % | OB | RVOL |",
    "|---:|---|---|---|---:|---:|---:|---:|---:|---|---:|",
    ...priorityReviewList.map(
      (p, i) =>
        `| ${i + 1} | **${p.symbol}** | ${p.consolidationCategory} | ${p.completedBlockCount}B / ${p.tradingDaysElapsed}D | ${p.priorityScore} | ${p.latestCompleted4hClose} | ${p.consolidationRangePct}% | ${p.breakoutDistancePct}% | ${p.supportDistancePct}% | YES | ${p.normalizedRvol}x |`
    ),
  ].join("\n");
  fs.writeFileSync(path.join(OUT_DIR, "phase610197_quality_audit_report.md"), md);

  console.log("Phase 6.10.19.7 complete:", {
    totalReadyAudited: audited.length,
    classCounts,
    groupCounts: {
      SHORT: separated.SHORT.length,
      MEDIUM: separated.MEDIUM.length,
      LONG: separated.LONG.length,
    },
    priorityReviewSymbols: priorityReviewList.map((p) => `${p.symbol}(${p.consolidationCategory},${p.priorityScore},dist=${p.breakoutDistancePct}%)`),
  });
}

main();

