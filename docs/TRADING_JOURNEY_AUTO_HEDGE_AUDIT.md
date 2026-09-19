# TRADING JOURNEY — AUTOMATED NIFTY OPTIONS HEDGING SYSTEM AUDIT

**Repository Audit Date:** September 13, 2026  
**Target Module:** NIFTY Options Defined-Risk Automated Hedging & Trade Management System  
**Audit Status:** Complete — Phase 0  

---

## Executive Summary

This document presents a comprehensive, single-source-of-truth audit of the existing **Trading Journey** platform architecture prior to implementing the Automated NIFTY Options Hedging and Trade Management System.

The existing repository is a full-stack trading web application consisting of a **Next.js 16 (React 19)** frontend and a **Fastify 5 (TypeScript)** backend backed by **Supabase PostgreSQL**. The audit confirms that the codebase possesses modular separation between market data, trading engines, database repositories, and frontend components, providing a strong foundation for adding the NIFTY defined-risk options hedging system cleanly without rewriting or disturbing existing crypto/forex or trade journal capabilities.

---

## 1. Codebase Architecture Overview & 20-Point Inspection

### 1. Frontend Framework
* **Framework:** Next.js `16.3.4` (App Router structure with client components `"use client"`).
* **React Version:** React `19.2.8` & React DOM `19.2.8`.
* **Styling System:** Vanilla CSS + TailwindCSS `v4` (`@tailwindcss/postcss`), configured with custom CSS variables and dark-theme tokens (`globals.css`).
* **Visualization:** Recharts (`^3.10.1`), TradingView Lightweight Charts (`^4.1.1`), Lucide React icons (`^1.39.0`).
* **State & Contexts:** `AuthContext.tsx` (Supabase auth & session state), `TradeContext.tsx` (journal & position state), `MarketDataContext.tsx` (live price state), `PineLiquidityContext.tsx` (pine levels state).

### 2. Backend Framework
* **Framework:** Fastify `^5.0.0` with TypeScript (`tsx watch src/server.ts`).
* **HTTP Server:** Entrypoint at `backend/src/server.ts`, listening on host `0.0.0.0` and port specified by `PORT` (default `4000`).
* **Middleware Plugins:** `@fastify/cors` (strict origin checking in production based on `FRONTEND_URL`), `@fastify/websocket` (real-time streaming).

### 3. Database
* **Engine:** Supabase PostgreSQL.
* **Client Integration:** `@supabase/supabase-js` (`^2.115.0`).
* **Access Layer:** `backend/src/db/supabaseClient.ts` provides `getAdminSupabaseClient()` using service-role key for backend operations. `lib/supabase.ts` handles client-side auth.

### 4. Authentication & Authorization
* **Auth Provider:** Supabase Auth (JWT tokens).
* **Middleware:** `backend/src/auth/middleware.ts` uses `jose` (`^6.2.10`) to verify Supabase JWT tokens on protected routes.
* **Account Authorization:** `userContext.ts` verifies user approval status (`approved === true`) before permitting trade execution or access.

### 5. Existing API Structure
* **Health:** `GET /health`
* **Market:** `GET /api/market/prices`
* **Pine / Alerts:** `GET /api/pine/levels`, `GET /api/pine/signals`, `POST /api/pine/webhook`
* **Trading:** `POST /api/trading/orders/market`, `POST /api/trading/orders/limit`, `POST /api/trading/positions/:id/close`, `POST /api/trading/positions/:id/modify`, `POST /api/trading/orders/:id/cancel`
* **WebSocket:** `GET /ws/market` (broadcasts live prices, positions, pending orders, and pine levels)

### 6. Market Data Integrations
* **Crypto (BTC/USD):** `CoinbaseWebSocketProvider.ts` (WebSocket stream).
* **Forex / Gold (XAU/USD):** `TwelveDataMarketProvider.ts` (REST polling with weekend status checks via `XausGoldProvider.ts`).
* **Price Storage:** `MarketPriceStore.ts` (Pub-sub in-memory store tracking price, timestamp, and status: `LIVE`, `STALE`, `OFFLINE`, `MARKET_CLOSED`).

### 7. Strategy Modules
* **Frontend Strategy Engine:** `lib/strategyEngine.ts` (evaluates rules-based setup metrics).
* **Pine Liquidity Engine:** `backend/src/alerts/pine/PineLiquidityEngine.ts` (detects liquidity levels: EQH/EQL, PWH/PWL, PDH/PDL, PMH/PML, Session H/L, SWH/SWL, tracks level touches, handles consumption, and formats alerts).

### 8. Existing Trading Modules
* **In-Memory State:** `PositionStore.ts` & `PendingOrderStore.ts` (thread-safe position and order state).
* **Trading Engine:** `TradingEngine.ts` (handles market order execution, limit order matching on live ticks, SL/TP monitoring, unrealized P&L calculations, partial closes).
* **Repositories:** `TradeRepository.ts`, `PendingOrderRepository.ts` (persists positions and orders to Supabase `trades` and `pending_orders` tables).
* **Startup Recovery:** `TradingStateRecovery.ts` (restores open positions and pending orders from database prior to enabling market data tick processing).

### 9. WebSocket / Live-Data Implementation
* **Server Route:** `backend/src/websocket/market.ts` registered with `@fastify/websocket`.
* **Data Streams:** Subscribes to `priceStore`, `positionStore`, `pendingOrderStore`, and `pineLevelService` to stream unified state updates to connected clients.

### 10. Background Jobs & Cron Workers
* **Stale Price Checker:** Runs every 5,000ms in `MarketDataService.ts`.
* **Twelve Data Poller:** Polls XAU/USD every 15,000ms in `TwelveDataMarketProvider.ts`.
* **Candle Processor:** Processes incoming price ticks for strategy level touches in `PineLevelService.ts`.

### 11. Existing Environment Variables
* **Backend (`backend/.env`):**
  * `PORT` (default: `4000`)
  * `NODE_ENV` (`development` | `production`)
  * `FRONTEND_URL` (CORS allowed origins)
  * `SUPABASE_URL`
  * `SUPABASE_SERVICE_ROLE_KEY`
  * `TELEGRAM_BOT_TOKEN`
  * `TELEGRAM_CHAT_ID`
  * `TWELVE_DATA_API_KEY`
  * `TWELVE_DATA_POLL_INTERVAL_MS`
  * `MARKET_DATA_STALE_AFTER_MS`
  * `MARKET_DATA_OFFLINE_AFTER_MS`
* **Frontend (`.env.local`):**
  * `NEXT_PUBLIC_SUPABASE_URL`
  * `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  * `NEXT_PUBLIC_BACKEND_URL`

### 12. Deployment Setup
* **Frontend:** Built with Next.js standard static/SSR toolchain (`npm run build`).
* **Backend:** Compiled with TypeScript `tsc` (`npm run build`), executed via Node `node dist/server.js`. Strict CORS validation enforced in production environments.

### 13. Logging System
* **Logger:** Pino (`pino` `^9.4.0`) with `pino-pretty` formatting in development.
* **Console Outputs:** Standardized console logs for engine ticks, state recovery, and provider status.

### 14. Error Handling
* **Custom Error Classes:** `TradingError` in `TradingEngine.ts`.
* **Atomic Rollback:** `atomicFillAndCreateTrade` in `PendingOrderRepository.ts` rolls back in-memory order states if DB insertion fails.
* **API Error Responses:** Structured Fastify error handlers returning `{ error: string }` with appropriate status codes (400, 401, 404, 500).

### 15. Database Schema
* **`trades` Table:** `id`, `user_id`, `date`, `time`, `exit_time`, `holding_time`, `symbol`, `side`, `strategy`, `entry_price`, `stop_loss`, `target_price`, `exit_price`, `quantity`, `pnl`, `fees`, `r_multiple`, `status` (`OPEN`, `WIN`, `LOSS`, `BREAKEVEN`), `order_type`, `notes`, `mistake_tag`, `screenshot_url`, `created_at`, `updated_at`.
* **`pending_orders` Table:** `id`, `user_id`, `instrument`, `side`, `order_type`, `limit_price`, `quantity`, `stop_loss`, `take_profit`, `strategy`, `status` (`PENDING`, `FILLED`, `CANCELLED`), `created_at`, `updated_at`.
* **Database RPC:** `fill_pending_order_and_create_trade`.

### 16. P&L Calculations
* **Realized P&L:** `(exitPrice - entryPrice) * quantity` for LONG, `(entryPrice - exitPrice) * quantity` for SHORT.
* **Unrealized P&L:** Computed on every live tick.
* **R-Multiple:** Calculated as `reward / risk` based on stop loss distance.
* **Analytics Aggregations:** `lib/analyticsAggregations.ts` & `lib/calculations.ts`.

### 17. Existing Dashboard & UI Components
* **Global App Layout:** `Sidebar.tsx`, `Header.tsx`, `MainLayout.tsx`.
* **Indian Market Component Shells (`components/indian-market/`):**
  * `IMOverviewView.tsx` (Overall NIFTY hedging dashboard shell)
  * `IMHeader.tsx` (Sub-navigation header bar)
  * `IMCurrentSignal.tsx` (Active strategy signal display shell)
  * `IMStrategy.tsx` (Strategy parameter breakdown shell)
  * `IMOptionChain.tsx` (Option chain grid shell)
  * `IMPositions.tsx` (Spread position list shell)
  * `IMMarketAnalysis.tsx` (Technical indicators & regime summary shell)
  * `IMNiftyDashboard.tsx` (Main NIFTY overview widget)
  * `IMStatusBadge.tsx` (Status badges for regimes & signals)

### 18. Broker Integrations
* **Current Mode:** Built-in paper trading engine.
* **Target Indian Brokers:** Broker interface abstraction required for Dhan and Kotak Neo API integration.
* **Default Mode:** `PAPER_TRADING = true`, `LIVE_TRADING = false` (locked OFF).

### 19. User Settings & Configuration
* **Settings Component:** `components/views/SettingsView.tsx`.
* **Storage Synchronization:** LocalStorage + Supabase cloud sync (`lib/cloudSync.ts`, `lib/storage.ts`).

### 20. Testing Infrastructure
* **Test Runner:** Vitest (`vitest` `^5.0.0`) with coverage via `@vitest/coverage-v8`.
* **Test Suite:** Located in `backend/src/**/__tests__/` covering market providers, Pine engine level consumption, trading state recovery, and DB operations.

---

## 2. Reusable Services & Architectural Boundaries

```
                 ┌──────────────────────────────────────────────┐
                 │          FRONTEND (Next.js / React 19)       │
                 │   components/indian-market/ (IMOverviewView) │
                 └──────────────────────┬───────────────────────┘
                                        │ (HTTP / WebSocket)
                 ┌──────────────────────▼───────────────────────┐
                 │       FASTIFY BACKEND (backend/src/)         │
                 └──────┬──────────────────────────────┬────────┘
                        │                              │
         ┌──────────────▼──────────────┐  ┌────────────▼──────────────┐
         │ EXISTING MARKET & TRADING   │  │   NEW NIFTY HEDGING SYSTEM │
         │ (BTC/USD, XAU/USD, Pine)    │  │ (backend/src/indian/)     │
         └──────────────┬──────────────┘  └────────────┬──────────────┘
                        │                              │
                        └──────────────┬───────────────┘
                                       │
                         ┌─────────────▼────────────┐
                         │   SUPABASE POSTGRESQL    │
                         └──────────────────────────┘
```

The existing architecture provides clear extension points:
1. **`MarketPriceStore`**: Can store `NIFTY` index prices alongside `BTC/USD` and `XAU/USD`.
2. **`TradingEngine` & Repositories**: Can be extended or complemented by a dedicated defined-risk multi-leg `HedgeOrderEngine`.
3. **Database Repositories**: Existing pattern in `TradeRepository.ts` and `PendingOrderRepository.ts` will be followed to implement Indian option strategy tables.

---

## 3. High-Level Blueprint of Files to be Created / Modified

### Files to be Created (`backend/src/indian/` & `backend/supabase/migrations/`)

1. **Types & Interfaces:**
   * `backend/src/indian/types.ts`: Structured types for NIFTY market data, option chains, regime classification, candidate spreads, risk parameters, charges, signals, and order legs.

2. **Market Data & Option Chain:**
   * `backend/src/indian/market/NiftyMarketDataService.ts`: NIFTY index & candle data service with stale-data protection and fallbacks.
   * `backend/src/indian/market/NiftyOptionChainService.ts`: Option chain fetcher, LTP, delta, OI, IV, liquidity, and bid/ask filter.

3. **Analysis & Strategy Engines:**
   * `backend/src/indian/regime/MarketRegimeEngine.ts`: Market regime classifier (BULLISH, BEARISH, RANGE, HIGH_VOLATILITY, EVENT_RISK, UNCLEAR).
   * `backend/src/indian/trend/MultiTimeframeTrendEngine.ts`: 1H & 15M trend alignment evaluator.
   * `backend/src/indian/levels/SupportResistanceEngine.ts`: Automatic S/R, PDH/PDL, PWH/PWL, VWAP, and OI-based support/resistance level detector.
   * `backend/src/indian/volatility/VolatilityEngine.ts`: ATR, IV percentile, and volatility regime classifier.
   * `backend/src/indian/events/EventFilterService.ts`: Macro event blackout filter.
   * `backend/src/indian/strategy/HedgingStrategyEngine.ts`: Strategy router (Bull Put Spread, Bear Call Spread, Iron Condor, or NO_TRADE).
   * `backend/src/indian/strategy/AdaptiveStrikeSelector.ts`: Dynamic spread candidate selector based on delta, S/R, ATR, liquidity, and risk/reward.
   * `backend/src/indian/strategy/StrategyScorer.ts`: 0–100 weighted scoring engine.

4. **Risk & Charges:**
   * `backend/src/indian/risk/RiskEngine.ts`: 1% capital risk manager and lot-sizing calculator.
   * `backend/src/indian/risk/ChargeCalculator.ts`: Exact brokerage, STT, Exchange fees, GST, SEBI fees, stamp duty, and slippage estimator.
   * `backend/src/indian/risk/DailyRiskController.ts`: Daily loss, daily profit target (e.g. ₹1,000 net target cap), max trades, and consecutive loss locks.

5. **Execution & Broker Interface:**
   * `backend/src/indian/broker/BrokerAdapter.ts`: Common interface (`getLTP`, `getOptionChain`, `placeOrder`, `cancelOrder`, `getPositions`).
   * `backend/src/indian/broker/PaperBrokerAdapter.ts`: High-fidelity paper trading execution simulator.
   * `backend/src/indian/broker/DhanBrokerAdapter.ts`: Dhan API v2 adapter shell.
   * `backend/src/indian/broker/KotakNeoBrokerAdapter.ts`: Kotak Neo API adapter shell.
   * `backend/src/indian/execution/HedgeOrderEngine.ts`: Hedge-first multi-leg execution and partial-fill recovery controller.
   * `backend/src/indian/execution/PositionReconciler.ts`: Database vs. Broker position reconciliation.

6. **Routes & Audit Logging:**
   * `backend/src/routes/indianTrading.ts`: Fastify route endpoints for signals, execution controls, paper/live mode, emergency stop, and backtesting.
   * `backend/src/indian/audit/AuditLogger.ts`: Full trace audit log recorder for every signal and execution decision.
   * `backend/supabase/migrations/20260913_nifty_auto_hedge_tables.sql`: Database schema for signals, multi-leg orders, positions, daily P&L, risk events, and audit logs.

7. **Backtest & Walk-Forward Validation:**
   * `backend/src/indian/backtest/BacktestEngine.ts`: Multi-regime backtester with transaction costs and walk-forward validation.

### Files to be Modified

1. `backend/src/server.ts`: Register `indianTradingRoutes` and initialize `NiftyMarketDataService`.
2. `backend/src/config/env.ts`: Add environment variable definitions for Dhan/Kotak API credentials and risk defaults.
3. `components/indian-market/IMOverviewView.tsx`: Connect live signal, regime, risk controls, and emergency stop to backend API.
4. `components/indian-market/IMCurrentSignal.tsx`: Render active defined-risk spreads, hedge legs, scores, and charge breakdowns.
5. `components/indian-market/IMStrategy.tsx`: Bind strategy weights and score rationale.
6. `components/indian-market/IMOptionChain.tsx`: Bind live option chain data feed.
7. `components/indian-market/IMPositions.tsx`: Render multi-leg defined-risk open spread positions.
8. `components/layout/Sidebar.tsx` & `MainLayout.tsx`: Add Indian Market tab navigation item cleanly into sidebar menu.

---

## 4. Potential Risks & Mitigation Strategies

| Potential Risk | Severity | Mitigation Strategy |
| :--- | :--- | :--- |
| **Unhedged Exposure on Partial Fills** | **CRITICAL** | Implement **Hedge-First Execution Engine** (Phase 20). If buy hedge leg fails to fill, emergency stop immediately cancels or closes the uncovered leg. |
| **Stale Market Data Signals** | **HIGH** | Strict timestamp validation and `STALE`/`OFFLINE` state checks before signal evaluation. `UNCLEAR` state yields `NO_TRADE`. |
| **Overfitting Strategy Parameters** | **MEDIUM** | Implement Phase 30 Walk-Forward Validation separating training data from out-of-sample data. |
| **Accidental Live Execution** | **CRITICAL** | Multi-layer lock: Default `PAPER_TRADING=true`, `LIVE_TRADING=false`. Live mode requires 8 explicit safety checks before placing any live broker order. |
| **Database vs. Broker Discrepancy** | **HIGH** | Continuous reconciliation worker in `PositionReconciler.ts` (Phase 24) locks new trade entry upon any position count or quantity mismatch. |

---

## 5. Audit Conclusion & Phase Transition

The repository audit is complete. The Trading Journey platform has a robust, clean architecture ready for the phased implementation of the **Automated Indian Market NIFTY Options Hedging System**.

**Phase 0 is complete. Awaiting user approval of Phase 0 audit before creating the implementation plan and beginning Phase 1 implementation.**
