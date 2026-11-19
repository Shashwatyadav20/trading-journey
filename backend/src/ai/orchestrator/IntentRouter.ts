import { sanitizeUntrustedText } from "../evidence/EvidenceSchema";

export type AIIntent =
  | "COMPANY_RESEARCH"
  | "MARKET_INTELLIGENCE"
  | "INSTITUTIONAL_INTELLIGENCE"
  | "NEWS_MACRO"
  | "PORTFOLIO_INTELLIGENCE"
  | "OPTIONS_INTELLIGENCE"
  | "RISK_INTELLIGENCE"
  | "MULTI_AGENT_RESEARCH"
  | "GENERAL_TRADING_EDUCATION"
  | "UNKNOWN";

export type RegisteredAgentId =
  | "company_research"
  | "market_intelligence"
  | "institutional_intelligence"
  | "news_macro"
  | "portfolio_intelligence"
  | "options_intelligence"
  | "risk_intelligence";

export interface IntentRoutingDecision {
  intent: AIIntent;
  workflowName: string;
  selectedAgents: RegisteredAgentId[];
  extractedSymbol: string | null;
  rationale: string;
}

const KNOWN_NSE_SYMBOLS = new Set([
  "RELIANCE",
  "TCS",
  "INFY",
  "HDFCBANK",
  "ICICIBANK",
  "SBIN",
  "BAJFINANCE",
  "LT",
  "BHARTIARTL",
  "AXISBANK",
  "KOTAKBANK",
  "ITC",
  "TATAMOTORS",
  "SUNPHARMA",
  "MARUTI",
  "WIPRO",
  "TITAN",
  "ADANIENT",
  "TRENT",
  "BEL",
  "SOLARINDS",
  "HAL",
  "ASIANPAINT",
  "HINDUNILVR",
  "NTPC",
  "POWERGRID",
  "ONGC",
  "COALINDIA",
  "TATASTEEL",
  "JSWSTEEL",
  "NIFTY",
  "BANKNIFTY",
  "FINNIFTY",
  "SENSEX",
]);

const INDEX_SYMBOLS = new Set(["NIFTY", "BANKNIFTY", "FINNIFTY", "SENSEX"]);

export function extractNseSymbolFromQuery(
  query: string,
  explicitSymbol?: string | null
): string | null {
  if (explicitSymbol && typeof explicitSymbol === "string") {
    const cleaned = explicitSymbol
      .trim()
      .toUpperCase()
      .replace(/^NSE:/i, "")
      .replace(/\.NS$/i, "")
      .replace(/\.BO$/i, "");
    if (/^[A-Z0-9&-]{1,20}$/.test(cleaned)) {
      return cleaned;
    }
  }

  const prefixed = query.match(/\bNSE:([A-Z0-9&-]{2,20})\b/i);
  if (prefixed?.[1]) {
    return prefixed[1].toUpperCase();
  }

  const suffixed = query.match(/\b([A-Z0-9&-]{2,20})\.(?:NS|BO)\b/i);
  if (suffixed?.[1]) {
    return suffixed[1].toUpperCase();
  }

  const tokens = query.toUpperCase().split(/[^A-Z0-9&-]+/).filter(Boolean);
  for (const token of tokens) {
    if (KNOWN_NSE_SYMBOLS.has(token)) {
      return token;
    }
  }

  return null;
}

export class IntentRouter {
  public route(
    rawQuery: string,
    explicitSymbol?: string | null
  ): IntentRoutingDecision {
    const sanitized = sanitizeUntrustedText(rawQuery);
    const lower = sanitized.toLowerCase();
    const symbol = extractNseSymbolFromQuery(sanitized, explicitSymbol);
    const isEquitySymbol = Boolean(symbol && !INDEX_SYMBOLS.has(symbol));

    // 0. General Trading Education (definitional/conceptual queries without a live symbol)
    if (
      !symbol &&
      /^\s*(what\s+is|what\s+are|explain|how\s+does|how\s+do|define|meaning\s+of|difference\s+between)\b/i.test(
        lower
      )
    ) {
      return {
        intent: "GENERAL_TRADING_EDUCATION",
        workflowName: "EDUCATIONAL_RESPONSE",
        selectedAgents: [],
        extractedSymbol: null,
        rationale:
          "General trading/financial education query without live data agent requirements.",
      };
    }

    // 1. Options Intelligence
    if (
      /\b(option\s*chain|options?|calls?|puts?|strike|expiry|open\s*interest|\boi\b|pcr|max\s*pain|implied\s*volatility|\biv\b|delta|gamma|theta|vega|straddle|strangle)\b/i.test(
        lower
      )
    ) {
      return {
        intent: "OPTIONS_INTELLIGENCE",
        workflowName: "OPTIONS_REVIEW",
        selectedAgents: ["options_intelligence", "risk_intelligence"],
        extractedSymbol: symbol ?? "NIFTY",
        rationale:
          "Query references options chain, Greeks, OI, PCR, or volatility metrics.",
      };
    }

    // 2. Risk & Scenario Intelligence
    if (
      /\b(risk|drawdown|max\s*loss|stress\s*test|scenario|gap[\s-]*(up|down)|hedge\s*coverage|stop[\s-]*loss\s*exposure)\b/i.test(
        lower
      )
    ) {
      return {
        intent: "RISK_INTELLIGENCE",
        workflowName: "RISK_AND_PORTFOLIO_REVIEW",
        selectedAgents: ["risk_intelligence", "portfolio_intelligence"],
        extractedSymbol: symbol,
        rationale:
          "Query references portfolio risk, max loss, hedge coverage, or stress scenarios.",
      };
    }

    // 3. Portfolio Intelligence
    if (
      /\b(portfolio|holdings?|my\s*positions?|allocation|sector\s*exposure|concentration|unrealized|realized\s*p&?l|pnl)\b/i.test(
        lower
      )
    ) {
      return {
        intent: "PORTFOLIO_INTELLIGENCE",
        workflowName: "PORTFOLIO_REVIEW",
        selectedAgents: ["portfolio_intelligence", "risk_intelligence"],
        extractedSymbol: symbol,
        rationale:
          "Query references user portfolio holdings, allocations, P&L, or concentration.",
      };
    }

    // 4. Full Multi-Agent Research
    if (
      /\b((?:full|complete|comprehensive|360[\s-]*degree)\s*(?:research|analysis)|deep\s*dive|360\s*analysis|all\s*agents|combining\s+fundamentals)\b/i.test(
        lower
      ) &&
      isEquitySymbol
    ) {
      return {
        intent: "MULTI_AGENT_RESEARCH",
        workflowName: "FULL_RESEARCH",
        selectedAgents: [
          "company_research",
          "institutional_intelligence",
          "market_intelligence",
          "news_macro",
        ],
        extractedSymbol: symbol,
        rationale:
          "Query requests full multi-agent research for an NSE equity.",
      };
    }

    // 5. Institutional Intelligence
    if (
      /\b(fii|dii|fpi|mutual\s*fund|promoter|pledge|shareholding|institutional\s*(?:flow|holding|activity|buying|selling))\b/i.test(
        lower
      )
    ) {
      return {
        intent: "INSTITUTIONAL_INTELLIGENCE",
        workflowName: "INSTITUTIONAL_FLOW_AND_OWNERSHIP",
        selectedAgents: isEquitySymbol
          ? ["institutional_intelligence", "company_research"]
          : ["institutional_intelligence"],
        extractedSymbol: symbol,
        rationale:
          "Query focuses on FII/DII flows, mutual fund holdings, or promoter pledges.",
      };
    }

    // 6. News & Macro Intelligence
    if (
      /\b(news|rbi|repo\s*rate|monetary\s*policy|cpi|wpi|gdp|iip|fiscal\s*deficit|fed|fomc|crude\s*oil|usd\/?inr|macro(?:-?economic|economics)?|inflation|interest\s*rates?|economy|economic\s*(?:data|developments?|indicators?|growth)|announcement|earnings\s*release|order\s*win)\b/i.test(
        lower
      )
    ) {
      return {
        intent: "NEWS_MACRO",
        workflowName: "NEWS_AND_MACRO_ANALYSIS",
        selectedAgents: isEquitySymbol
          ? ["news_macro", "company_research"]
          : ["news_macro"],
        extractedSymbol: symbol,
        rationale:
          "Query focuses on corporate announcements, RBI policy, Indian macro, or global macro.",
      };
    }

    // 7. Market Intelligence
    if (
      /\b(market\s*(?:overview|breadth|regime|mood|status)|india\s*vix|\bvix\b|advances?\s*(?:and|\/)\s*declines?|sector\s*(?:strength|rotation)|banknifty|finnifty|sensex|nifty\s*50)\b/i.test(
        lower
      ) ||
      (symbol !== null && INDEX_SYMBOLS.has(symbol))
    ) {
      return {
        intent: "MARKET_INTELLIGENCE",
        workflowName: "MARKET_ANALYSIS",
        selectedAgents: ["market_intelligence", "news_macro"],
        extractedSymbol: symbol,
        rationale:
          "Query focuses on index intelligence, market breadth, sector strength, VIX, or regime.",
      };
    }

    // 8. Company Research (symbol present or fundamental keywords)
    if (
      isEquitySymbol ||
      /\b(fundamental|valuation|p\/?e|p\/?b|ebitda|pat|eps|revenue|quarterly\s*results?|bull\s*vs\s*bear|company\s*research)\b/i.test(
        lower
      )
    ) {
      return {
        intent: "COMPANY_RESEARCH",
        workflowName: "COMPANY_ANALYSIS",
        selectedAgents: [
          "company_research",
          "institutional_intelligence",
          "news_macro",
        ],
        extractedSymbol: symbol,
        rationale:
          "Query focuses on equity fundamentals, valuation, catalysts, and company research.",
      };
    }

    // 9. General Trading Education (no specialist data agents needed)
    if (
      /\b(what\s+is|explain|how\s+does|define|meaning\s+of|difference\s+between)\b/i.test(
        lower
      )
    ) {
      return {
        intent: "GENERAL_TRADING_EDUCATION",
        workflowName: "EDUCATIONAL_RESPONSE",
        selectedAgents: [],
        extractedSymbol: null,
        rationale:
          "General trading/financial education query without live data agent requirements.",
      };
    }

    // 10. Unknown
    return {
      intent: "UNKNOWN",
      workflowName: "UNCLASSIFIED",
      selectedAgents: [],
      extractedSymbol: null,
      rationale:
        "Query did not match a specific NSE research, market, portfolio, options, or risk domain.",
    };
  }
}

export const intentRouter = new IntentRouter();
