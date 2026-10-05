export interface StressScenarioDefinition {
  scenarioId: string;
  name: string;
  category: "EXECUTION" | "SLIPPAGE" | "SPREAD" | "SEQUENCE" | "TAIL_LOSS" | "DATA_QUALITY" | "MONTE_CARLO";
  severity: "BASELINE" | "MODERATE" | "SEVERE" | "EXTREME";
  parameters: Record<string, any>;
  description: string;
}

export interface StressScenarioMatrix {
  slippageScenarios: StressScenarioDefinition[];
  delayScenarios: StressScenarioDefinition[];
  spreadScenarios: StressScenarioDefinition[];
  sequenceScenarios: StressScenarioDefinition[];
  tailLossScenarios: StressScenarioDefinition[];
  dataQualityScenarios: StressScenarioDefinition[];
  monteCarloScenarios: StressScenarioDefinition[];
}

export class Phase33StressScenarioManager {
  private scenarios: StressScenarioDefinition[] = [];

  constructor() {
    this.initializeDefaultScenarios();
  }

  private initializeDefaultScenarios(): void {
    // 1. Slippage Stress Scenarios
    const slippageScenarios: StressScenarioDefinition[] = [
      {
        scenarioId: "SLIPPAGE_BASELINE",
        name: "Baseline Execution Slippage",
        category: "SLIPPAGE",
        severity: "BASELINE",
        parameters: { extraSlippageInr: 0, multiplier: 1.0 },
        description: "Unmodified actual observed paper trading slippage.",
      },
      {
        scenarioId: "SLIPPAGE_MODERATE",
        name: "+25% Slippage Inflation",
        category: "SLIPPAGE",
        severity: "MODERATE",
        parameters: { extraSlippageInr: 10, multiplier: 1.25 },
        description: "Moderate 25% inflation on execution slippage.",
      },
      {
        scenarioId: "SLIPPAGE_SEVERE",
        name: "+50% Slippage Inflation",
        category: "SLIPPAGE",
        severity: "SEVERE",
        parameters: { extraSlippageInr: 25, multiplier: 1.5 },
        description: "Severe 50% inflation on execution slippage.",
      },
      {
        scenarioId: "SLIPPAGE_EXTREME",
        name: "+100% Slippage Inflation",
        category: "SLIPPAGE",
        severity: "EXTREME",
        parameters: { extraSlippageInr: 50, multiplier: 2.0 },
        description: "Extreme 100% inflation on execution slippage.",
      },
    ];

    // 2. Execution Delay Scenarios
    const delayScenarios: StressScenarioDefinition[] = [
      {
        scenarioId: "DELAY_BASELINE",
        name: "Zero Execution Delay",
        category: "EXECUTION",
        severity: "BASELINE",
        parameters: { delaySeconds: 0 },
        description: "Immediate paper execution at signal decision.",
      },
      {
        scenarioId: "DELAY_5S",
        name: "5-Second Execution Delay",
        category: "EXECUTION",
        severity: "MODERATE",
        parameters: { delaySeconds: 5, adverseImpactPct: 0.05 },
        description: "5-second network or system queue execution delay.",
      },
      {
        scenarioId: "DELAY_15S",
        name: "15-Second Execution Delay",
        category: "EXECUTION",
        severity: "SEVERE",
        parameters: { delaySeconds: 15, adverseImpactPct: 0.12 },
        description: "15-second latency delay under market volatility.",
      },
    ];

    // 3. Spread Widening Scenarios
    const spreadScenarios: StressScenarioDefinition[] = [
      {
        scenarioId: "SPREAD_BASELINE",
        name: "Normal Option Spread",
        category: "SPREAD",
        severity: "BASELINE",
        parameters: { spreadMultiplier: 1.0 },
        description: "Observed option bid-ask spreads.",
      },
      {
        scenarioId: "SPREAD_WIDE_25",
        name: "+25% Spread Widening",
        category: "SPREAD",
        severity: "MODERATE",
        parameters: { spreadMultiplier: 1.25 },
        description: "25% wider option bid-ask spreads at entry/exit.",
      },
      {
        scenarioId: "SPREAD_WIDE_50",
        name: "+50% Spread Widening",
        category: "SPREAD",
        severity: "SEVERE",
        parameters: { spreadMultiplier: 1.5 },
        description: "50% wider option bid-ask spreads (low liquidity).",
      },
    ];

    // 4. Sequence Stress Scenarios
    const sequenceScenarios: StressScenarioDefinition[] = [
      {
        scenarioId: "SEQ_CHRONOLOGICAL",
        name: "Chronological Sequence",
        category: "SEQUENCE",
        severity: "BASELINE",
        parameters: { order: "CHRONOLOGICAL" },
        description: "Observed historical trade sequence.",
      },
      {
        scenarioId: "SEQ_REVERSED",
        name: "Reversed Sequence",
        category: "SEQUENCE",
        severity: "MODERATE",
        parameters: { order: "REVERSED" },
        description: "Reverse chronological order of trade observations.",
      },
      {
        scenarioId: "SEQ_WORST_FIRST",
        name: "Worst Losses First",
        category: "SEQUENCE",
        severity: "EXTREME",
        parameters: { order: "WORST_FIRST" },
        description: "All losing trades sorted first to measure worst-case drawdown.",
      },
    ];

    // 5. Tail-Loss Stress Scenarios
    const tailLossScenarios: StressScenarioDefinition[] = [
      {
        scenarioId: "TAIL_BASELINE",
        name: "Observed Losses",
        category: "TAIL_LOSS",
        severity: "BASELINE",
        parameters: { target: "BASELINE", lossMultiplier: 1.0 },
        description: "Observed trade loss distribution.",
      },
      {
        scenarioId: "TAIL_LARGEST_2X",
        name: "2x Largest Loss Shock",
        category: "TAIL_LOSS",
        severity: "SEVERE",
        parameters: { target: "LARGEST_LOSS", lossMultiplier: 2.0 },
        description: "Double the magnitude of the largest observed loss.",
      },
      {
        scenarioId: "TAIL_TOP3_CLUSTERED",
        name: "Top 3 Losses Clustered",
        category: "TAIL_LOSS",
        severity: "EXTREME",
        parameters: { target: "TOP_3_LOSSES", clusterCount: 3 },
        description: "Forces top 3 largest losses to occur consecutively.",
      },
    ];

    // 6. Data-Quality Stress Scenarios
    const dataQualityScenarios: StressScenarioDefinition[] = [
      {
        scenarioId: "DQ_STALE_QUOTE",
        name: "Stale Market Quote",
        category: "DATA_QUALITY",
        severity: "MODERATE",
        parameters: { condition: "STALE_QUOTE" },
        description: "Quotes not updated for > 5 seconds.",
      },
      {
        scenarioId: "DQ_CHAIN_UNAVAILABLE",
        name: "Option Chain Unavailable",
        category: "DATA_QUALITY",
        severity: "SEVERE",
        parameters: { condition: "OPTION_CHAIN_UNAVAILABLE" },
        description: "Option chain snapshot returns empty or incomplete response.",
      },
      {
        scenarioId: "DQ_WS_DISCONNECTED",
        name: "WebSocket Disconnected",
        category: "DATA_QUALITY",
        severity: "EXTREME",
        parameters: { condition: "WEBSOCKET_DISCONNECTED" },
        description: "Real-time market feed connection drops.",
      },
      {
        scenarioId: "DQ_PRICE_MISMATCH",
        name: "Spot/Futures Price Mismatch",
        category: "DATA_QUALITY",
        severity: "SEVERE",
        parameters: { condition: "PRICE_MISMATCH" },
        description: "Discrepancy between index spot price and option chain underlying.",
      },
    ];

    // 7. Monte Carlo Scenarios
    const monteCarloScenarios: StressScenarioDefinition[] = [
      {
        scenarioId: "MC_1000_RESAMPLE",
        name: "1,000 Resampling Iterations",
        category: "MONTE_CARLO",
        severity: "MODERATE",
        parameters: { iterations: 1000, seed: 20261003 },
        description: "Bootstrap resampling of observed trade P&Ls.",
      },
    ];

    this.scenarios = [
      ...slippageScenarios,
      ...delayScenarios,
      ...spreadScenarios,
      ...sequenceScenarios,
      ...tailLossScenarios,
      ...dataQualityScenarios,
      ...monteCarloScenarios,
    ];
  }

  public getScenarios(): StressScenarioDefinition[] {
    return this.scenarios;
  }

  public getScenariosByCategory(category: StressScenarioDefinition["category"]): StressScenarioDefinition[] {
    return this.scenarios.filter((s) => s.category === category);
  }

  public getScenarioById(id: string): StressScenarioDefinition | undefined {
    return this.scenarios.find((s) => s.scenarioId === id);
  }

  public getScenarioMatrix(): StressScenarioMatrix {
    return {
      slippageScenarios: this.getScenariosByCategory("SLIPPAGE"),
      delayScenarios: this.getScenariosByCategory("EXECUTION"),
      spreadScenarios: this.getScenariosByCategory("SPREAD"),
      sequenceScenarios: this.getScenariosByCategory("SEQUENCE"),
      tailLossScenarios: this.getScenariosByCategory("TAIL_LOSS"),
      dataQualityScenarios: this.getScenariosByCategory("DATA_QUALITY"),
      monteCarloScenarios: this.getScenariosByCategory("MONTE_CARLO"),
    };
  }
}

export const phase33StressScenarioManager = new Phase33StressScenarioManager();
