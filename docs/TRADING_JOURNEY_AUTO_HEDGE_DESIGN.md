# TRADING JOURNEY — AUTOMATED NIFTY OPTIONS HEDGING SYSTEM ARCHITECTURE & DESIGN

**Document Version:** 1.0.0 (Phase 1 Freeze)  
**Status:** Approved & Frozen  
**Target Module:** NIFTY Options Defined-Risk Automated Hedging & Trade Management System  

---

## 1. Existing Architecture Mapping

| Component Description | Exact Repository File Path | Description / Role in Trading Journey |
| :--- | :--- | :--- |
| **Frontend Strategy Engine** | `d:\Trading\my-app\lib\strategyEngine.ts` | Calculates swing highs/lows, liquidity sweeps, engulfing confirmations, and signals. |
| **Backend Pine Liquidity Engine** | `d:\Trading\my-app\backend\src\alerts\pine\PineLiquidityEngine.ts` | Evaluates Pine Script liquidity levels (EQH/EQL, PWH/PWL, PDH/PDL, PMH/PML, Session H/L, SWH/SWL), tracks touches, handles level consumption, and formats alerts. |
| **Position Store** | `d:\Trading\my-app\backend\src\trading\PositionStore.ts` | In-memory thread-safe store for active open, closing, and closed single-leg positions. |
| **Pending Order Store** | `d:\Trading\my-app\backend\src\trading\PendingOrderStore.ts` | In-memory store managing pending limit orders. |
| **Trading Engine** | `d:\Trading\my-app\backend\src\trading\TradingEngine.ts` | Manages tick processing, paper limit fills, market order execution, SL/TP monitoring, unrealized P&L calculations, and partial closes. |
| **Trade Repository** | `d:\Trading\my-app\backend\src\db\TradeRepository.ts` | Handles Supabase CRUD operations for the `trades` table. |
| **Pending Order Repository** | `d:\Trading\my-app\backend\src\db\PendingOrderRepository.ts` | Handles Supabase CRUD for `pending_orders` and atomic RPC fill operations. |
| **Trading State Recovery** | `d:\Trading\my-app\backend\src\trading\TradingStateRecovery.ts` | Restores database open positions and pending orders at backend startup prior to market data streaming. |
| **Market Price Store** | `d:\Trading\my-app\backend\src\market\MarketPriceStore.ts` | Central pub-sub price store tracking live tick status (`LIVE`, `STALE`, `OFFLINE`, `MARKET_CLOSED`). |
| **Pine Level Service** | `d:\Trading\my-app\backend\src\alerts\PineLevelService.ts` | Orchestrates candle ingestion, level tracking, and signal broadcasting. |
| **Indian Market UI Shells** | `d:\Trading\my-app\components\indian-market\` | Contains `IMOverviewView`, `IMHeader`, `IMCurrentSignal`, `IMOptionChain`, `IMPositions`, `IMStrategy`, `IMMarketAnalysis`, `IMNiftyDashboard`, `IMStatusBadge`. |
| **Trading API Routes** | `d:\Trading\my-app\backend\src\routes\trading.ts` | REST API routes for order execution, position closing, and modification. |
| **WebSocket Market Feed** | `d:\Trading\my-app\backend\src\websocket\market.ts` | Fastify WebSocket streaming live market prices, positions, orders, and pine levels. |
| **Supabase Migrations & RPC** | `d:\Trading\my-app\backend\supabase\migrations\20260904_atomic_fill_pending_order.sql` | PostgreSQL schema and `fill_pending_order_and_create_trade` RPC procedure. |
| **Analytics & P&L Logic** | `d:\Trading\my-app\lib\analyticsAggregations.ts`, `lib\calculations.ts` | Helper functions for win rate, expectancy, drawdown, and financial metrics. |

---

## 2. Reuse-First Architecture Matrix

| Component | Current File Path | Current Purpose | Reuse? | Modification Required? | New Component Required? |
| :--- | :--- | :--- | :---: | :---: | :---: |
| **MarketPriceStore** | `backend/src/market/MarketPriceStore.ts` | Pub-sub tick store | **YES** | None (stores `NIFTY` symbol directly) | No |
| **PositionStore** | `backend/src/trading/PositionStore.ts` | Single-leg position store | **YES** | Minimal (extend to support option spread leg tagging) | `HedgePositionStore` (Multi-leg spread wrapper) |
| **PendingOrderStore** | `backend/src/trading/PendingOrderStore.ts` | Limit order store | **YES** | None | `MultiLegOrderStore` |
| **TradingEngine** | `backend/src/trading/TradingEngine.ts` | Single-leg paper trading engine | **YES** | None | `HedgeOrderEngine` (Defined-risk spread execution & recovery) |
| **TradeRepository** | `backend/src/db/TradeRepository.ts` | Supabase `trades` table repository | **YES** | None | `NiftyStrategyRepository` (Defined-risk signals & spreads) |
| **P&L System** | `lib/calculations.ts` | P&L & metrics calculations | **YES** | Extended for Indian tax/charge calculations | `ChargeCalculator.ts` (STT, GST, SEBI, Exchange) |
| **WebSocket Feed** | `backend/src/websocket/market.ts` | WebSocket state streaming | **YES** | Broadcaster payload extended for `niftySignal` | No |
| **Indian Market UI** | `components/indian-market/*` | UI shell for NIFTY workspace | **YES** | Connected to backend REST & WebSocket feeds | No |

---

## 3. New Hedging Architecture — 18 Logical Modules

```
                    ┌──────────────────────────────────────────────┐
                    │               MARKET DATA SERVICE            │
                    └──────────────────────┬───────────────────────┘
                                           │
                    ┌──────────────────────▼───────────────────────┐
                    │               DATA VALIDATION                │
                    └──────────────────────┬───────────────────────┘
                                           │
                    ┌──────────────────────▼───────────────────────┐
                    │          CANDLE / TIMEFRAME ENGINE           │
                    └──────────────────────┬───────────────────────┘
                                           │
         ┌─────────────────────────────────┼─────────────────────────────────┐
         │                                 │                                 │
┌────────▼────────┐               ┌────────▼────────┐               ┌────────▼────────┐
│  REGIME ENGINE  │               │   TREND ENGINE  │               │VOLATILITY ENGINE│
└────────┬────────┘               └────────┬────────┘               └────────┬────────┘
         │                                 │                                 │
         └─────────────────────────────────┼─────────────────────────────────┘
                                           │
                    ┌──────────────────────▼───────────────────────┐
                    │        SUPPORT & RESISTANCE ENGINE           │
                    └──────────────────────┬───────────────────────┘
                                           │
                    ┌──────────────────────▼───────────────────────┐
                    │            OPTION CHAIN ENGINE               │
                    └──────────────────────┬───────────────────────┘
                                           │
                    ┌──────────────────────▼───────────────────────┐
                    │         ADAPTIVE STRIKE SELECTOR             │
                    └──────────────────────┬───────────────────────┘
                                           │
                    ┌──────────────────────▼───────────────────────┐
                    │          STRATEGY SCORING ENGINE             │
                    └──────────────────────┬───────────────────────┘
                                           │
                    ┌──────────────────────▼───────────────────────┐
                    │                 RISK ENGINE                  │
                    └──────────────────────┬───────────────────────┘
                                           │
                    ┌──────────────────────▼───────────────────────┐
                    │              CHARGES ENGINE                  │
                    └──────────────────────┬───────────────────────┘
                                           │
                    ┌──────────────────────▼───────────────────────┐
                    │             TRADE VALIDATION                 │
                    └──────────────────────┬───────────────────────┘
                                           │
                    ┌──────────────────────▼───────────────────────┐
                    │          HEDGE EXECUTION ENGINE              │
                    └──────────────────────┬───────────────────────┘
                                           │
                    ┌──────────────────────▼───────────────────────┐
                    │         POSITION & EXIT MANAGEMENT           │
                    └──────────────────────┬───────────────────────┘
                                           │
                    ┌──────────────────────▼───────────────────────┘
                    │            AUDIT LOGGING ENGINE              │
                    └──────────────────────────────────────────────┘
```

### Module Specifications (1–18)

#### 1. Market Data Service (`NiftyMarketDataService`)
* **Responsibility:** Ingests live NIFTY index ticks, 15M/1H candles, and option chain ticks.
* **Inputs:** Raw websocket/REST stream from configured Indian broker data provider.
* **Outputs:** Validated `NiftyMarketSnapshot` emitted to `MarketPriceStore`.
* **Dependencies:** `MarketPriceStore`.
* **Failure Conditions:** Disconnection, stale timestamps (>15s), missing index quote. Returns `OFFLINE`/`STALE`.
* **Test Requirements:** Unit test reconnection behavior, stale handling, and fallback logic.

#### 2. Data Validation Service (`NiftyDataValidator`)
* **Responsibility:** Validates integrity, monotonicity, and non-zero bounds of prices, volumes, and open interest.
* **Inputs:** Raw price ticks and option contracts.
* **Outputs:** `ValidationResult` (valid or rejected with reason).
* **Dependencies:** None.
* **Failure Conditions:** Zero LTP, negative volume, inverted bid/ask spread (bid > ask).
* **Test Requirements:** Test boundary conditions, zero values, and corrupted tick payloads.

#### 3. Candle / Timeframe Engine (`TimeframeEngine`)
* **Responsibility:** Aggregates 1M ticks into complete, synchronized 15-minute and 1-hour candles.
* **Inputs:** 1-minute candle stream or raw index ticks.
* **Outputs:** Completed `Candle15M` and `Candle1H` objects.
* **Dependencies:** `NiftyMarketDataService`.
* **Failure Conditions:** Gap candles during market hours, out-of-order timestamps.
* **Test Requirements:** Test candle completion on exact minute boundaries (09:30, 10:00, etc.), gap filling, and midnight/weekend roll-overs.

#### 4. Market Regime Engine (`MarketRegimeEngine`)
* **Responsibility:** Classifies market state into `BULLISH`, `BEARISH`, `RANGE`, `HIGH_VOLATILITY`, `EVENT_RISK`, or `UNCLEAR`.
* **Inputs:** 1H & 15M candles, VWAP, EMA 20/50/200, ADX, ATR, IV percentile.
* **Outputs:** `RegimeState` struct with primary regime and confidence score.
* **Dependencies:** `TimeframeEngine`, `VolatilityEngine`.
* **Failure Conditions:** Conflicting trend signals across timeframes yield `UNCLEAR`.
* **Test Requirements:** Unit tests verifying each regime state under controlled indicator inputs.

#### 5. Multi-Timeframe Trend Engine (`MultiTimeframeTrendEngine`)
* **Responsibility:** Evaluates 1H macro trend and 15M micro trend alignment.
* **Inputs:** 1H candles, 15M candles, EMA 20/50, VWAP.
* **Outputs:** `TrendAnalysis` (`direction`: BUY/SELL/NEUTRAL, `trendScore`: 0–100, `invalidationLevel`).
* **Dependencies:** `TimeframeEngine`.
* **Failure Conditions:** 1H is bullish while 15M is bearish -> alignment fails.
* **Test Requirements:** Unit test trend alignment matrix across 12 market scenario datasets.

#### 6. Market Structure Engine (`MarketStructureEngine`)
* **Responsibility:** Identifies higher highs (HH), higher lows (HL), lower highs (LH), lower lows (LL), and market structure breaks (BOS/CHOCH).
* **Inputs:** 15M swing pivots.
* **Outputs:** `StructureState` (`BULLISH_STRUCTURE`, `BEARISH_STRUCTURE`, `SIDEWAYS`).
* **Dependencies:** `TimeframeEngine`.
* **Failure Conditions:** Less than 5 candles available for fractal evaluation.
* **Test Requirements:** Test structure detection on classic double bottom, double top, and trend reversal patterns.

#### 7. Support & Resistance Engine (`SupportResistanceEngine`)
* **Responsibility:** Calculates PDH, PDL, PC, PWH, PWL, 1H/15M swing levels, VWAP, ATR bands, and high-OI strike walls.
* **Inputs:** Historical daily/weekly candles, intraday candles, option chain OI array.
* **Outputs:** Ranked array of `SupportResistanceLevel` items with price, strength score, and cluster tolerance.
* **Dependencies:** `TimeframeEngine`, `OptionChainEngine`.
* **Failure Conditions:** Missing daily historical candles.
* **Test Requirements:** Verify exact level calculation against known exchange settlement data.

#### 8. Volatility Engine (`VolatilityEngine`)
* **Responsibility:** Computes ATR(14), IV, IV Percentile (IVP), and classifies volatility state (`LOW`, `NORMAL`, `HIGH`, `EXTREME`).
* **Inputs:** 15M candles, Option Chain IV data.
* **Outputs:** `VolatilityState` object.
* **Dependencies:** `TimeframeEngine`, `OptionChainEngine`.
* **Failure Conditions:** Missing IV data -> fallback to ATR regime.
* **Test Requirements:** Test classification across low IV (10-12%), normal (13-18%), high (19-25%), extreme (>25%).

#### 9. Option Chain Engine (`NiftyOptionChainService`)
* **Responsibility:** Parses, normalizes, and filters the NIFTY option chain.
* **Inputs:** Raw option chain data from broker/feed.
* **Outputs:** Clean `OptionChain` array sorted by strike with LTP, Delta, IV, OI, Volume, Bid, Ask.
* **Dependencies:** `NiftyMarketDataService`, `DataValidator`.
* **Failure Conditions:** Illiquid strikes, bid/ask spread > max allowed, stale option quotes.
* **Test Requirements:** Test strike filtering, delta calculation accuracy, and liquidity scoring.

#### 10. Adaptive Strike Selector (`AdaptiveStrikeSelector`)
* **Responsibility:** Selects optimal dynamic strike pair for defined-risk spread (Sell OTM leg + Buy further OTM hedge leg).
* **Inputs:** Spot price, S/R levels, Delta targets, ATR, Expected Move, Option Chain.
* **Outputs:** Ranked `CandidateSpread[]` with sell strike, buy strike, credit, max risk, and R/R.
* **Dependencies:** `OptionChainEngine`, `SupportResistanceEngine`, `VolatilityEngine`.
* **Failure Conditions:** No candidate spread satisfies minimum credit or maximum risk constraints.
* **Test Requirements:** Unit test strike selection across bullish, bearish, and range market conditions.

#### 11. Strategy Scoring Engine (`StrategyScorer`)
* **Responsibility:** Calculates a 0–100 quality setup score based on 9 weighted parameters.
* **Inputs:** Outputs from Regime, Trend, Structure, S/R, VWAP, Volume/OI, Volatility, Liquidity, Event Filter.
* **Outputs:** `StrategyScoreResult` (`score`: 0–100, `reasons`: string[], `passed`: boolean).
* **Dependencies:** All upstream analysis engines.
* **Failure Conditions:** Score < threshold (80 default, or 70 if all risk filters pass) -> returns `NO_TRADE`.
* **Test Requirements:** Test exact weighted math and verify non-pass when key indicators fail.

#### 12. Risk Engine (`RiskEngine`)
* **Responsibility:** Enforces max 1% capital risk limit, calculates position size (lots), and validates max loss per lot.
* **Inputs:** User capital, max risk %, proposed spread max loss per lot.
* **Outputs:** `RiskValidation` (`allowed`: boolean, `lotQuantity`: number, `maxNetLoss`: number, `riskPercentage`: number).
* **Dependencies:** `AdaptiveStrikeSelector`.
* **Failure Conditions:** Single lot max loss exceeds allowed risk amount -> returns `allowed: false` (NO TRADE).
* **Test Requirements:** Test lot sizing formula `floor(allowedRisk / maxLossPerLot)` across various account balances.

#### 13. Charges Engine (`ChargeCalculator`)
* **Responsibility:** Computes exact Indian market transaction fees (Brokerage, STT, Exchange Turnover, GST, SEBI fee, Stamp Duty, Slippage).
* **Inputs:** Order side, spread strikes, quantity (lots * 25 for NIFTY), premium credit.
* **Outputs:** `ChargeBreakdown` (`grossPnl`, `brokerage`, `stt`, `exchangeFees`, `gst`, `sebiFees`, `stampDuty`, `estimatedSlippage`, `totalCharges`, `netPnl`).
* **Dependencies:** None.
* **Failure Conditions:** Invalid lot quantity or price.
* **Test Requirements:** Verify against official NSE / Broker tax calculator formulas for options trading.

#### 14. Trade Validation Engine (`TradeValidator`)
* **Responsibility:** Final pre-execution gateway validating all system parameters (Regime, Score, Risk, Charges, Event Filter, Daily Limits).
* **Inputs:** All engine outputs + Daily Risk Controller state.
* **Outputs:** `TradeValidationDecision` (`approved`: boolean, `rejectionReason`: string | null).
* **Dependencies:** `DailyRiskController`, `EventFilterService`, `RiskEngine`.
* **Failure Conditions:** Any single validation check fails -> blocks trade with explicit human-readable reason.
* **Test Requirements:** Unit test each rejection criteria independently.

#### 15. Hedge Execution Engine (`HedgeOrderEngine`)
* **Responsibility:** Executes defined-risk multi-leg orders with strict hedge verification and partial-fill recovery.
* **Inputs:** Validated execution request containing Sell leg and Buy Hedge leg.
* **Outputs:** `ExecutionResult` (`status`: FILLED / PARTIAL_RECOVERY / FAILED, `legs`: FilledLeg[]).
* **Dependencies:** `BrokerAdapter` / `PaperBrokerAdapter`.
* **Failure Conditions:** Sell leg fills but Buy hedge leg fails -> triggers immediate emergency recovery (retry hedge or market close exposed sell leg).
* **Test Requirements:** Mock broker execution with simulated single-leg dropouts and verify emergency recovery logic.

#### 16. Position Management Engine (`PositionManager`)
* **Responsibility:** Tracks open spread positions, calculates real-time net unrealized P&L, monitors stop loss and target levels.
* **Inputs:** Live tick stream, active spread positions.
* **Outputs:** Position updates, trigger events.
* **Dependencies:** `MarketPriceStore`, `PositionStore`.
* **Failure Conditions:** Connection lost while position open -> position maintained in memory with protective server-side SL.
* **Test Requirements:** Test SL/TP hit detection during rapid price jumps.

#### 17. Exit Management Engine (`ExitManager`)
* **Responsibility:** Handles automated exits for Stop Loss, Profit Target capture (40–60%), Early Exit on thesis breakdown, or End-of-Day square-off.
* **Inputs:** Active position state, Market Regime updates, Technical Breakdown events.
* **Outputs:** Exit execution request.
* **Dependencies:** `HedgeOrderEngine`, `MarketRegimeEngine`.
* **Failure Conditions:** Exit order rejection -> retries via emergency market order.
* **Test Requirements:** Test early exit triggers on VWAP breakdown and 15M trend flip.

#### 18. Audit Logging Engine (`AuditLogger`)
* **Responsibility:** Records an immutable, full-trace JSON log of every market snapshot, indicator output, score rationale, rejection reason, risk calculation, charge breakdown, order payload, and fill event.
* **Inputs:** Execution events and signal decisions.
* **Outputs:** Persisted audit record in `nifty_audit_logs` table (never logging API secrets).
* **Dependencies:** Supabase Database Client.
* **Failure Conditions:** DB insert error -> logs to local stderr file backup.
* **Test Requirements:** Test complete JSON structure sanitization and trace correlation IDs.

---

## 4. Strict Separation of Concerns

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ STRATEGY ENGINE │ ──> │ SIGNAL CREATION │ ──> │ RISK VALIDATION │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
┌─────────────────┐     ┌─────────────────┐              │
│  BROKER / PAPER │ <── │ EXEC ADAPTER    │ <── EXEC REQ ┘
└─────────────────┘     └─────────────────┘
```

* **Rule 1:** The Strategy Engine MUST NOT import or invoke broker placement methods directly.
* **Rule 2:** Strategy Engine emits a pure `StrategySignal` data structure.
* **Rule 3:** The Signal is passed to the `RiskEngine` and `TradeValidator`.
* **Rule 4:** Only after passing all risk controls is an `ExecutionRequest` handed to the `BrokerAdapter`.

---

## 5. Market Data Interface (`MarketDataProvider`)

```typescript
export interface NiftyContractQuote {
  symbol: string;
  expiry: string;
  strike: number;
  optionType: 'CE' | 'PE';
  ltp: number;
  bid: number;
  ask: number;
  volume: number;
  openInterest: number;
  changeInOI: number;
  iv: number;
  delta: number;
  timestamp: string;
}

export interface NiftyOptionChain {
  spotPrice: number;
  timestamp: string;
  contracts: NiftyContractQuote[];
}

export interface MarketDataProvider {
  getSpotPrice(): Promise<number>;
  get1MIndexCandles(count: number): Promise<Candle[]>;
  get15MIndexCandles(count: number): Promise<Candle[]>;
  get1HIndexCandles(count: number): Promise<Candle[]>;
  getOptionChain(expiry?: string): Promise<NiftyOptionChain>;
  subscribeTicks(onTick: (price: number) => void): void;
  subscribeOptionChain(onChain: (chain: NiftyOptionChain) => void): void;
  isHealthy(): boolean;
}
```

---

## 6. Timeframe Engine Design

* **Candle Source:** Aggregated from 1-minute index ticks or provider-native 15M/1H feeds.
* **Completion Logic:** A 15M candle starting at 09:15 closes strictly when the 09:29:59 tick finishes. Signal processing evaluates only on CLOSED candles.
* **Timezone:** Asia/Kolkata (IST, UTC+05:30).
* **Market Hours:** 09:15:00 IST to 15:30:00 IST (NSE Trading Hours).
* **Missing Candle Handling:** Forward-fill close price with zero volume; mark data state as `INCOMPLETE` if missing > 2 consecutive candles.

---

## 7. Market Regime Exact Mathematical Definitions

| Regime | 1H Trend | 15M Trend | Price vs VWAP | ADX(14) | ATR(14) / Spot | Market Structure |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **BULLISH** | EMA(20) > EMA(50) | EMA(20) > EMA(50) | Price > VWAP | ADX > 20 | Normal (< 1.5%) | Higher Highs & Higher Lows |
| **BEARISH** | EMA(20) < EMA(50) | EMA(20) < EMA(50) | Price < VWAP | ADX > 20 | Normal (< 1.5%) | Lower Highs & Lower Lows |
| **RANGE** | Flat / Tangled | Flat / Tangled | Crosses VWAP | ADX < 20 | Low (< 1.0%) | Sideways Boundaries Defined |
| **HIGH_VOLATILITY** | Any | Any | Any | Any | Extreme (> 2.0%) | Erratic Spikes |
| **EVENT_RISK** | Any | Any | Any | Any | Any | Configured Blackout Active |
| **UNCLEAR** | Disagrees with 15M | Disagrees with 1H | Conflicted | Any | Any | Mixed Structure |

*Note: If signals conflict or regime is `UNCLEAR`, system defaults to `NO_TRADE`.*

---

## 8. Trend Engine Mathematical Specifications

* **15M Bullish Condition:** `Close_15M > EMA_20_15M AND EMA_20_15M > EMA_50_15M AND Close_15M > VWAP`
* **15M Bearish Condition:** `Close_15M < EMA_20_15M AND EMA_20_15M < EMA_50_15M AND Close_15M < VWAP`
* **1H Macro Confirmation:** Must match 15M direction (`1H_EMA_20 > 1H_EMA_50` for Bullish).
* **Invalidation Level:** Swing low of setup candle for bullish; swing high for bearish.

---

## 9. Support & Resistance Ranking & Clustering

```typescript
export interface SupportResistanceLevel {
  price: number;
  type: 'PDH' | 'PDL' | 'PC' | 'PWH' | 'PWL' | 'SWING_HIGH' | 'SWING_LOW' | 'VWAP' | 'OI_WALL_CALL' | 'OI_WALL_PUT';
  strengthScore: number; // 1 to 10
  source: string;
  distanceFromSpot: number; // Percentage
  distancePoints: number;
}
```

* **Clustering Tolerance:** Levels within 0.25% of spot (e.g., ~60 points on NIFTY 24,000) are clustered into a single strong Support/Resistance zone.
* **Strength Ranking:** High-OI Strikes (10) > PWH/PWL (9) > PDH/PDL (8) > 1H Swing (7) > VWAP (6) > 15M Swing (5).

---

## 10. Volatility Engine States

* **LOW:** IV Percentile < 30 OR ATR(14) / Spot < 0.8%
* **NORMAL:** IV Percentile 30–70 AND ATR(14) / Spot 0.8%–1.5%
* **HIGH:** IV Percentile 70–90 OR ATR(14) / Spot 1.5%–2.2%
* **EXTREME:** IV Percentile > 90 OR ATR(14) / Spot > 2.2% *(Result: Block New Entries)*

---

## 11. Option Chain Normalized Contract Model

```typescript
export interface OptionContract {
  symbol: string;         // e.g. "NIFTY26SEP24700PE"
  expiry: string;         // YYYY-MM-DD
  strike: number;         // e.g. 24700
  optionType: 'CE' | 'PE';
  ltp: number;
  bid: number;
  ask: number;
  volume: number;
  openInterest: number;
  changeInOI: number;
  iv: number;
  delta: number;
  timestamp: string;
}
```

* **Validation Rules:** Reject if `bid == 0`, `ask == 0`, `ask - bid > maxAllowedSpread` (default 3.0 pts), or `volume == 0`.

---

## 12. Core Strategy Logic Matrix

| Market Regime | Strategy Selected | Sell Leg | Buy Hedge Leg (Mandatory) | Max Risk |
| :--- | :--- | :--- | :--- | :--- |
| **BULLISH** | **Bull Put Credit Spread** | Sell OTM Put (Delta ~0.20–0.30) | Buy further OTM Put (Delta ~0.05–0.10) | Defined (Spread Width - Credit) |
| **BEARISH** | **Bear Call Credit Spread** | Sell OTM Call (Delta ~0.20–0.30) | Buy further OTM Call (Delta ~0.05–0.10) | Defined (Spread Width - Credit) |
| **RANGE** | **Iron Condor** | Sell OTM Put + Sell OTM Call | Buy OTM Put Hedge + Buy OTM Call Hedge | Defined |
| **HIGH_VOL / EVENT / UNCLEAR** | **NO_TRADE** | None | None | 0 |

---

## 13. Adaptive Strike Selection Algorithm

1. Filter option chain for contracts matching target delta range (Sell Leg Delta: `0.20 to 0.30`).
2. Verify Sell Leg price is beyond nearest Support (for Put) or Resistance (for Call).
3. Select Hedge Leg at distance of 100 to 200 points further OTM.
4. Calculate net credit, maximum loss, and Reward/Risk ratio.
5. Rank candidate spreads by: `Score = (NetCredit / MaxLoss) * 0.5 + (LiquidityScore) * 0.3 + (SRDistanceScore) * 0.2`.
6. Select top-ranked spread passing all risk constraints.

---

## 14. Strategy Quality Score Rationale (0–100)

```
1H Trend Alignment       : 20 pts
15M Trend Alignment      : 15 pts
Market Structure         : 15 pts
Support / Resistance     : 15 pts
VWAP Confirmation        : 10 pts
Volume / OI Support      : 10 pts
Volatility Environment   :  5 pts
Option Liquidity         :  5 pts
Event Filter Clear       :  5 pts
----------------------------------
TOTAL SCORE              : 100 pts
```

> [!IMPORTANT]
> **CRITICAL WARNING:** This score represents **SETUP QUALITY & INDICATOR CONFLUENCE**. It is NOT a mathematical "probability of profit" or "win rate guarantee".

* Default Trade Pass Threshold: **80+** (or 70–79 only if all risk filters pass with 0 warnings).

---

## 15. Risk Engine & Automatic Position Sizing

```
allowedRisk = accountCapital * (MAX_RISK_PER_TRADE_PCT / 100.0)
maxLossPerLot = (strikeWidth - netCreditPerShare) * NIFTY_LOT_SIZE
rawLots = floor(allowedRisk / maxLossPerLot)
lotQuantity = min(rawLots, MAX_LOTS_PER_TRADE)
```

* If `rawLots < 1`: **NO TRADE** (account balance insufficient to take defined risk safely).
* **Strict Rule:** Position size is strictly calculated before trade entry. No martingale, no averaging down.

---

## 16. Charges Engine Specifications

```
Brokerage          : ₹20 per executed leg (₹40 per 2-leg spread order)
STT (Sell Side)    : 0.125% on premium for options sold
Exchange Turnover  : 0.05% on premium (NSE transaction charge)
GST                : 18% on (Brokerage + Exchange Charges + SEBI Fees)
SEBI Turn Fee      : ₹10 per crore (0.0001%)
Stamp Duty         : 0.003% on buy leg premium
Estimated Slippage : Configurable (default 0.5 points per leg)
```

* **P&L Metrics Formula:**
  * `Gross Max Profit = Net Credit * Lot Size * Quantity`
  * `Total Charges = Brokerage + STT + Exchange + GST + SEBI + Stamp + Slippage`
  * `Net Expected Profit = Gross Max Profit - Total Charges`

---

## 17. Entry Engine State Machine

```
[ IDLE ]
   │
   ▼
[ SIGNAL_GENERATED ] ──(Validation Failed)──> [ NO_TRADE_LOGGED ]
   │
   ▼ (Valid)
[ RISK_CHECK_PASSED ]
   │
   ▼
[ EXECUTION_SUBMITTED ] ──(Broker Fail/Timeout)──> [ EMERGENCY_CANCEL ]
   │
   ▼ (Hedge Leg 1 Filled)
[ HEDGE_VERIFIED ] ──(Hedge Leg 2 Failed)──> [ RECOVERY_ENGINE ]
   │
   ▼ (Both Legs Filled)
[ POSITION_OPEN ]
```

* **Idempotency:** Every signal execution request carries a unique `idempotencyKey = Hash(Symbol, Strategy, Expiry, Strikes, TimestampMin)`.

---

## 18. Hedge-First Multi-Leg Execution & Recovery

1. **Order Submission:** Submit Buy Hedge Leg first or submit concurrent multi-leg basket order.
2. **Fill Verification:** Query broker for fill status on BOTH legs.
3. **Recovery Protocol:**
   * If **Buy Leg Fills & Sell Leg Fails**: Cancel Sell leg request. System holds a long hedge position (max risk is limited to small premium paid). Close long leg safely.
   * If **Sell Leg Fills & Buy Hedge Leg Fails**: **EMERGENCY STATE**. Immediately retry Buy hedge order with market order price limit or close exposed Sell leg via market order. Notify admin via audit alert.

---

## 19. Dynamic Stop Loss Model

Stop loss triggers on whichever condition occurs FIRST:
1. **Spread Price SL:** Spread value expands to `1.5 × Initial Credit` (or configurable multiplier).
2. **Underlying Invalidation SL:** NIFTY spot closes past the technical invalidation level (Support level for Bull Put).
3. **Emergency Max Loss SL:** Spread loss reaches `80% of Maximum Defined Risk`.

---

## 20. Profit Target Capture & Early Exit

* **Profit Target:** Auto-close spread when `50% of Initial Credit` is captured (configurable 40–60%).
* **Early Exit Trigger:** Close immediately before SL if 15M trend reverses OR price breaks VWAP against the trade direction with expanding volume.

---

## 21. Daily Risk Controls & Capital Protection

* `MAX_DAILY_LOSS`: ₹5,000 (configurable) -> Triggers **DAILY RISK LOCK** (no new trades for the day).
* `MAX_TRADES_PER_DAY`: 3 trades -> Blocks further entries.
* `MAX_CONSECUTIVE_LOSSES`: 2 losses -> Blocks further entries.
* `DAILY_NET_PROFIT_TARGET`: ₹1,000 Net -> Once hit, locks trading for the day to preserve profits.

---

## 22. Paper Trading Simulation Engine Extension

* Reuses `TradingEngine.ts` and `MarketPriceStore.ts`.
* Simulates spread execution using live NIFTY index and option chain ticks.
* Applies realistic bid/ask spreads, brokerage, STT, GST, and slippage to all paper orders.

---

## 23. Live Trading Safety Gates (8 Mandatory Checks)

Live trading execution requires ALL 8 gates to evaluate `TRUE`:
1. `LIVE_TRADING === true` in configuration.
2. User explicitly toggled **AUTO TRADE ON** in UI.
3. Broker API session authenticated & token valid.
4. Market data feed status is `LIVE` (timestamp < 5s old).
5. Risk Engine returns `allowed: true`.
6. Daily risk controls clear (no daily loss or trade limit breach).
7. Macro Event Filter clear (no active blackout window).
8. Emergency Stop toggle is **INACTIVE**.

---

## 24. Database Schema Design (`backend/supabase/migrations/20260913_nifty_auto_hedge_tables.sql`)

```sql
-- 1. Strategy Signals Table
CREATE TABLE IF NOT EXISTS nifty_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  symbol VARCHAR(20) NOT NULL DEFAULT 'NIFTY',
  regime VARCHAR(30) NOT NULL,
  score INT NOT NULL,
  strategy_type VARCHAR(50) NOT NULL,
  expiry DATE NOT NULL,
  sell_strike NUMERIC NOT NULL,
  buy_strike NUMERIC NOT NULL,
  credit NUMERIC NOT NULL,
  max_risk NUMERIC NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'READY',
  reasons JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Spread Positions Table
CREATE TABLE IF NOT EXISTS nifty_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  signal_id UUID REFERENCES nifty_signals(id),
  symbol VARCHAR(20) NOT NULL DEFAULT 'NIFTY',
  strategy VARCHAR(50) NOT NULL,
  expiry DATE NOT NULL,
  sell_strike NUMERIC NOT NULL,
  buy_strike NUMERIC NOT NULL,
  quantity_lots INT NOT NULL,
  net_credit NUMERIC NOT NULL,
  max_loss NUMERIC NOT NULL,
  stop_loss_spread NUMERIC NOT NULL,
  target_spread NUMERIC NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'OPEN', -- OPEN, CLOSED, EMERGENCY_EXIT
  entry_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  exit_time TIMESTAMPTZ,
  realized_pnl NUMERIC,
  total_charges NUMERIC NOT NULL DEFAULT 0,
  net_pnl NUMERIC,
  mode VARCHAR(10) NOT NULL DEFAULT 'PAPER', -- PAPER or LIVE
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Audit Logs Table
CREATE TABLE IF NOT EXISTS nifty_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event_type VARCHAR(50) NOT NULL,
  trace_id VARCHAR(100) NOT NULL,
  details JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 25. Frontend Integration Blueprint (`components/indian-market/`)

* **`IMOverviewView.tsx`:** Primary workspace displaying Spot, Market Regime badge, Strategy Score gauge, Daily P&L, Mode Toggles (Paper/Live), Auto-Trade switch, and Emergency Stop button.
* **`IMCurrentSignal.tsx`:** Renders live signal card with Spread structure (Sell strike + Buy hedge), Entry credit, Max Loss, SL, Target, Charges breakdown, and human-readable setup reasons.
* **`IMOptionChain.tsx`:** Displays live option chain grid with Delta, OI, IV, LTP highlights for selected spread strikes.
* **`IMPositions.tsx`:** Lists active multi-leg spread positions with live mark-to-market unrealized P&L and one-click close.

---

## 26. REST & WebSocket API Design

### REST Endpoints (`backend/src/routes/indianTrading.ts`)
* `GET /api/indian/signal` — Returns latest calculated setup, regime, score, and reasons.
* `GET /api/indian/chain` — Returns option chain snapshot.
* `POST /api/indian/trade/toggle-auto` — Toggles Auto-Trade mode.
* `POST /api/indian/trade/emergency-stop` — Triggers immediate emergency stop.
* `POST /api/indian/backtest/run` — Triggers backtest run over historical candles.

### WebSocket Messages (`/ws/market`)
```json
{
  "type": "NIFTY_AUTO_HEDGE_UPDATE",
  "spot": 24700.45,
  "regime": "BULLISH",
  "score": 86,
  "signal": {
    "action": "BULL_PUT_SPREAD",
    "expiry": "2026-09-26",
    "sellLeg": { "strike": 24500, "optionType": "PE", "ltp": 65.0 },
    "buyLeg": { "strike": 24300, "optionType": "PE", "ltp": 20.0 },
    "netCredit": 45.0,
    "maxRisk": 155.0,
    "score": 86,
    "reasons": ["1H + 15M trend aligned bullish", "Price above VWAP", "Support at 24500 OI Wall"]
  },
  "risk": {
    "dailyPnl": 1420.0,
    "dailyLossLimit": -5000.0,
    "dailyTarget": 1000.0,
    "targetReached": true
  },
  "mode": {
    "paperTrading": true,
    "liveTrading": false,
    "autoTrade": false,
    "emergencyStop": false
  }
}
```

---

## 27. Configuration Model (`backend/src/indian/config/niftyConfig.ts`)

```typescript
export const DEFAULT_NIFTY_CONFIG = {
  symbol: 'NIFTY',
  lotSize: 25,
  maxCapitalRiskPctPerTrade: 1.0,
  minStrategyScore: 80,
  scorePassWithFilters: 70,
  dailyLossLimit: 5000,
  dailyProfitTarget: 1000,
  maxTradesPerDay: 3,
  maxConsecutiveLosses: 2,
  defaultPaperMode: true,
  defaultLiveMode: false,
  slippagePointsPerLeg: 0.5,
  maxBidAskSpreadPoints: 3.0,
  targetCreditCapturePct: 50,
  stopLossCreditMultiplier: 1.5,
};
```

---

## 28. Comprehensive Test Plan Matrix

| Test Suite | Components Tested | Key Test Scenarios |
| :--- | :--- | :--- |
| **Unit Tests** | Indicators, Regime, S/R, Scorer, Charge Calculator | Test trend detection math, S/R clustering, tax calculation exactness against manual formulas. |
| **Strategy & Risk Tests** | Adaptive Strike Selector, Risk Engine, Sizing | Test lot sizing under capital limits, strike selection with delta targets, rejection when credit is too low. |
| **Execution Tests** | HedgeOrderEngine, PaperBrokerAdapter | Test 2-leg spread execution, simulated partial fill on leg 2, and verify emergency recovery protocol. |
| **Integration Tests** | Market Data → Strategy → Execution → DB | End-to-end flow test from tick arrival to signal, paper order fill, position store update, and DB audit logging. |
| **Failure Tests** | Network timeout, stale data, wide spread | Test system safety behavior on websocket disconnect, missing candles, high IV spike, and market close. |

---

## 29. Sequenced Implementation Sequence (Phases 2 – 16)

* **PHASE 2:** Market Data & Option Chain Foundation (`NiftyMarketDataService`, `NiftyOptionChainService`).
* **PHASE 3:** Timeframe & Indicator Aggregation Engine (`TimeframeEngine`).
* **PHASE 4:** Market Regime, Trend & Structure Engines (`MarketRegimeEngine`, `MultiTimeframeTrendEngine`).
* **PHASE 5:** Option Chain Analysis & Liquidity Filter.
* **PHASE 6:** Adaptive Dynamic Strike Selector (`AdaptiveStrikeSelector`).
* **PHASE 7:** Strategy Scoring Engine (`StrategyScorer`).
* **PHASE 8:** Risk Management & Broker Charge Engine (`RiskEngine`, `ChargeCalculator`).
* **PHASE 9:** Trade Validation & Entry State Machine (`TradeValidator`).
* **PHASE 10:** Hedge-First Execution Engine & Paper Broker Adapter.
* **PHASE 11:** Frontend UI Integration (`components/indian-market/*`).
* **PHASE 12:** Historical Backtesting Engine (`BacktestEngine`).
* **PHASE 13:** Walk-Forward Validation & Out-Of-Sample Testing.
* **PHASE 14:** Broker Adapter Shell (Dhan / Kotak Neo integration interfaces).
* **PHASE 15:** Live Trading Safety Controls & Reconciliation Audit.
* **PHASE 16:** Final End-to-End System Verification.

---

## 30. Design Freeze Approval Statement

The technical architecture and implementation plan for the **Trading Journey Automated NIFTY Options Hedging System** is complete, verified against the actual repository structure, and frozen.

**Phase 1 Design Freeze is complete. Phase 2 implementation will proceed sequentially upon prompt approval.**
