import { BrokerInstrument } from "./IBrokerAdapter";

export interface InstrumentValidationResult {
  valid: boolean;
  reason: string | null;
  instrument?: BrokerInstrument;
}

export class InstrumentMasterResolver {
  private defaultLotSize = 65; // Default NIFTY Lot Size (dynamically aligned when provider verifies)
  private currentProviderLotSize: number | null = null;
  private knownContracts: Map<string, BrokerInstrument> = new Map();

  constructor(defaultLotSize: number = 65) {
    this.defaultLotSize = defaultLotSize;
  }


  public setLotSize(lotSize: number): void {
    if (lotSize > 0) {
      this.defaultLotSize = lotSize;
      this.currentProviderLotSize = lotSize;
    }
  }

  public getLotSize(): number {
    return this.currentProviderLotSize ?? this.defaultLotSize;
  }

  public getCurrentProviderLotSize(): number | null {
    return this.currentProviderLotSize;
  }

  /**
   * Generates canonical trading symbol for NIFTY options.
   * e.g. NIFTY2692424500CE
   */
  public generateTradingSymbol(
    underlying: string,
    expiryIso: string,
    strike: number,
    optionType: "CE" | "PE"
  ): string {
    const dt = new Date(expiryIso);
    const year = dt.getUTCFullYear().toString().slice(-2);
    const month = (dt.getUTCMonth() + 1).toString().padStart(2, "0");
    const day = dt.getUTCDate().toString().padStart(2, "0");
    const symbolClean = underlying.toUpperCase();
    return `${symbolClean}${year}${month}${day}${strike}${optionType.toUpperCase()}`;
  }

  /**
   * Resolves and validates contract parameters against instrument master.
   */
  public resolveInstrument(
    underlying: string,
    expiryIso: string,
    strike: number,
    optionType: "CE" | "PE"
  ): InstrumentValidationResult {
    if (!underlying || underlying.toUpperCase() !== "NIFTY") {
      return { valid: false, reason: `Invalid underlying: ${underlying}. Expected NIFTY.` };
    }

    if (!expiryIso || isNaN(new Date(expiryIso).getTime())) {
      return { valid: false, reason: `Invalid expiry timestamp format: ${expiryIso}` };
    }

    if (strike <= 0 || strike % 50 !== 0) {
      return { valid: false, reason: `Invalid strike price: ${strike}. NIFTY strikes must be multiples of 50.` };
    }

    if (optionType !== "CE" && optionType !== "PE") {
      return { valid: false, reason: `Invalid option type: ${optionType}. Expected CE or PE.` };
    }

    const tradingSymbol = this.generateTradingSymbol(underlying, expiryIso, strike, optionType);
    const cacheKey = `${tradingSymbol}`;

    const effectiveLotSize = this.getLotSize();

    let instrument = this.knownContracts.get(cacheKey);
    if (!instrument || instrument.lotSize !== effectiveLotSize) {
      instrument = {
        symbol: underlying.toUpperCase(),
        tradingSymbol,
        instrumentToken: `TOK_${tradingSymbol}`,
        exchange: "NFO",
        strike,
        optionType,
        expiry: expiryIso,
        lotSize: effectiveLotSize,
        tickSize: 0.05,
      };
      this.knownContracts.set(cacheKey, instrument);
    }

    return {
      valid: true,
      reason: null,
      instrument,
    };
  }

  /**
   * Phase 18: Verifies lot size against data provider.
   * Treats provider data as the source of truth for the active contract.
   * If provider lot size is null or unverified -> LOT_SIZE_UNVERIFIED -> NO_TRADE.
   */
  public verifyLotSizeFromProvider(providerLotSize: number | null): {
    verified: boolean;
    reason: string | null;
    currentLotSize: number | null;
  } {
    if (providerLotSize === null || providerLotSize === undefined || !Number.isFinite(providerLotSize) || providerLotSize <= 0) {
      this.currentProviderLotSize = null;
      return {
        verified: false,
        reason: "LOT_SIZE_UNVERIFIED",
        currentLotSize: null,
      };
    }

    // Dynamic alignment with provider source of truth
    this.currentProviderLotSize = Math.round(providerLotSize);
    this.defaultLotSize = Math.round(providerLotSize);

    return {
      verified: true,
      reason: null,
      currentLotSize: this.currentProviderLotSize,
    };
  }
}

export const instrumentMasterResolver = new InstrumentMasterResolver();


