import { marketSessionValidator } from "./MarketSessionValidator";
import { instrumentMasterResolver } from "../broker/InstrumentMasterResolver";
import { dhanBrokerAdapter } from "../broker/DhanBrokerAdapter";

export interface ExpiryValidationResult {
  isValid: boolean;
  selectedExpiry: string;
  currentDate: string;
  expiryStatus: "VALID" | "EXPIRED" | "UNVERIFIED";
  providerSource: string;
  rejectionReason: string | null;
}

export class ExpiryValidator {
  /**
   * Resolves currently active and verified expiries from available providers.
   * Priority 1: Dhan HQ API when configured
   * Priority 2: Verified Instrument Master / Provider Metadata
   */
  public getAvailableExpiries(customProviderExpiries?: string[]): {
    expiries: string[];
    providerSource: string;
  } {
    if (customProviderExpiries && customProviderExpiries.length > 0) {
      return {
        expiries: customProviderExpiries,
        providerSource: "CUSTOM_PROVIDER_LIST",
      };
    }

    if (dhanBrokerAdapter.isConfigured()) {
      // If Dhan is configured, query Dhan instrument master
      const dhanMaster = instrumentMasterResolver.getDhanInstrumentMaster();
      if (dhanMaster && dhanMaster.size > 0) {
        const expiries = Array.from(
          new Set(Array.from(dhanMaster.values()).map((inst) => inst.expiry))
        ).sort();
        return {
          expiries,
          providerSource: "DHAN_INSTRUMENT_MASTER",
        };
      }
    }

    // Default: Instrument Master Resolver
    const masterExpiries = instrumentMasterResolver.getAvailableExpiries();
    if (masterExpiries && masterExpiries.length > 0) {
      return {
        expiries: masterExpiries,
        providerSource: "PROVIDER_INSTRUMENT_MASTER",
      };
    }

    return {
      expiries: [],
      providerSource: "UNAVAILABLE",
    };
  }

  /**
   * Validates selected contract expiry against current IST date and provider contract universe.
   */
  public validateExpiry(
    selectedExpiry: string,
    currentDateInput?: string | Date,
    availableExpiriesInput?: string[]
  ): ExpiryValidationResult {
    const currentDate = marketSessionValidator.getIstDateString(currentDateInput);

    if (!selectedExpiry || selectedExpiry === "N/A" || selectedExpiry.trim() === "") {
      return {
        isValid: false,
        selectedExpiry: selectedExpiry || "UNKNOWN",
        currentDate,
        expiryStatus: "UNVERIFIED",
        providerSource: "UNAVAILABLE",
        rejectionReason: "EXPIRY_NOT_VERIFIED",
      };
    }

    // Hard Rule 1: Expiry must NOT be in the past relative to current IST date
    if (selectedExpiry < currentDate) {
      return {
        isValid: false,
        selectedExpiry,
        currentDate,
        expiryStatus: "EXPIRED",
        providerSource: "DATE_CHECK",
        rejectionReason: "EXPIRED_CONTRACT",
      };
    }

    // Hard Rule 2: Expiry must be verified against provider's contract universe
    const { expiries: providerExpiries, providerSource } =
      this.getAvailableExpiries(availableExpiriesInput);

    if (providerExpiries.length > 0) {
      const isVerified = providerExpiries.includes(selectedExpiry);
      if (!isVerified) {
        return {
          isValid: false,
          selectedExpiry,
          currentDate,
          expiryStatus: "UNVERIFIED",
          providerSource,
          rejectionReason: "EXPIRY_NOT_VERIFIED",
        };
      }
    }

    return {
      isValid: true,
      selectedExpiry,
      currentDate,
      expiryStatus: "VALID",
      providerSource,
      rejectionReason: null,
    };
  }
}

export const expiryValidator = new ExpiryValidator();
