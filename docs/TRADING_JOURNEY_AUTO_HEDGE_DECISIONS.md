# TRADING JOURNEY — AUTOMATED NIFTY OPTIONS HEDGING ARCHITECTURAL DECISIONS (ADR)

**Document Version:** 1.0.0 (Phase 1 Freeze)  
**Status:** Approved & Recorded  

---

## Decision Log

### ADR-001: Defined-Risk Spreads Only (No Naked Option Selling)
* **Status:** APPROVED
* **Context:** Naked option selling exposes trading accounts to infinite downside risk during gaps, flash crashes, or extreme news events in the Indian market.
* **Decision:** The system will ONLY generate and execute defined-risk multi-leg spread strategies:
  * Bull Put Credit Spread (Sell OTM Put + Buy further OTM Put)
  * Bear Call Credit Spread (Sell OTM Call + Buy further OTM Call)
  * Iron Condor (Range market only)
* **Consequences:** Every trade has a mathematically bounded maximum loss known prior to execution. Naked short options are strictly prohibited by system logic.

---

### ADR-002: Dynamic Delta & Support/Resistance Strike Selection Over Fixed Points
* **Status:** APPROVED
* **Context:** Static rules such as "Sell 200 points OTM" perform poorly across varying market price levels (e.g., NIFTY at 18,000 vs 24,000) and changing implied volatility (IV).
* **Decision:** Dynamic strike selection will evaluate:
  1. Option Delta (target 0.20 to 0.30 for sell leg).
  2. Technical Support / Resistance levels (PDH, PDL, PWH, PWL, VWAP, High-OI strike walls).
  3. Implied Volatility and Expected Move.
* **Consequences:** Strikes adapt dynamically to market regimes and volatility conditions while preserving optimal risk/reward ratios.

---

### ADR-003: Strict Decoupling of Strategy, Risk Engine, and Execution Adapters
* **Status:** APPROVED
* **Context:** Directly tying strategy signals to broker API order placement creates high risk of duplicate orders, unvalidated risk limit breaches, or runaway executions during market anomalies.
* **Decision:** The architecture enforces a strict unidirectional pipeline:
  `Strategy Engine → Signal Payload → Risk Engine & Validator → Execution Request → Execution Adapter → Broker / Paper Engine`.
* **Consequences:** The strategy engine cannot place orders directly. Execution requires multi-stage validation passing all safety gates.

---

### ADR-004: Comprehensive Indian Market Charges Engine (Gross vs. Net P&L)
* **Status:** APPROVED
* **Context:** Indian options trading involves multiple statutory taxes and transaction fees (STT, GST, Exchange Turnover, SEBI fees, Stamp Duty, Brokerage). Evaluating trades solely on gross credit creates false expectations.
* **Decision:** Implement a dedicated `ChargeCalculator` that computes exact transaction costs for both entry and exit legs. All signal evaluations, paper trades, and backtest results will display both **GROSS P&L** and **NET P&L**.
* **Consequences:** Trade setups with insufficient net profit potential after taxes will be rejected (`NO_TRADE`).

---

### ADR-005: Paper Trading Default & Multi-Layer Live Trading Lock
* **Status:** APPROVED
* **Context:** Accidental live broker order execution during development or system startup poses extreme risk.
* **Decision:** System default configuration is `PAPER_TRADING = true` and `LIVE_TRADING = false`. Live trading requires all 8 safety gates to evaluate `TRUE` before any live broker order is transmitted.
* **Consequences:** Paper trading runs seamlessly by default without risk of accidental live execution.

---

### ADR-006: Strategy Score Represents Confluence, Not Probability of Profit
* **Status:** APPROVED
* **Context:** Displaying a 0–100 setup score as "86% Win Rate" or "86% Profit Probability" is misleading and scientifically inaccurate in dynamic markets.
* **Decision:** The Strategy Score (0–100) is explicitly defined as a **SETUP QUALITY & INDICATOR CONFLUENCE SCORE**. UI displays will clearly label the score as setup quality and list the underlying indicator reasons.
* **Consequences:** Prevents false user expectations and maintains realistic, risk-managed trading practices.

---

### ADR-007: Daily Profit Target & Daily Loss Cap Trade Locks
* **Status:** APPROVED
* **Context:** Over-trading after achieving profit targets often gives back gains, while revenge trading after losses causes drawdown expansion.
* **Decision:** Implement strict daily risk locks:
  1. `DAILY_NET_PROFIT_TARGET` (e.g. ₹1,000 net): Blocks new trade entries once achieved to lock in daily earnings.
  2. `MAX_DAILY_LOSS` (e.g. ₹5,000): Blocks new trade entries to prevent drawdown escalation.
  3. `NO_TRADE` decisions are treated as successful capital protection decisions.
* **Consequences:** Account capital is protected through disciplined, rule-enforced daily limits.

---

### ADR-008: Reuse-First Component Strategy
* **Status:** APPROVED
* **Context:** Rebuilding existing working subsystems (e.g., `MarketPriceStore`, `PositionStore`, `PendingOrderStore`, Supabase auth, WebSocket streaming, Indian Market UI) introduces regression risks and unnecessary code bloat.
* **Decision:** Extend and reuse existing Trading Journey foundation components wherever applicable. Create dedicated sub-modules (`backend/src/indian/`) for NIFTY-specific hedging, risk, and option chain logic.
* **Consequences:** Maintains code hygiene, avoids duplicate infrastructure, and preserves existing BTC/USD, XAU/USD, and Trade Journal functionality.
