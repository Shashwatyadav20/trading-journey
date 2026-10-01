import { Phase25MarketSessionStatus } from "../types";

/**
 * Phase 25 — Strict Market Session Validator for NIFTY F&O (IST Timezone).
 * 
 * Rules:
 * - Market Hours: 09:15:00 to 15:30:00 IST (Mon-Fri, non-holiday)
 * - Pre-Market Hours: 09:00:00 to 09:15:00 IST (Mon-Fri, non-holiday)
 * - Market Closed: 15:30:00 to 09:00:00 IST next trading day
 * - Weekend: Saturday (Day 6) and Sunday (Day 0)
 * - Holiday: Official NSE trading holidays
 */

// List of official NSE Trading Holidays (YYYY-MM-DD in IST)
const NSE_TRADING_HOLIDAYS: Set<string> = new Set([
  "2026-01-26", // Republic Day
  "2026-03-03", // Holi
  "2026-03-27", // Good Friday
  "2026-04-14", // Dr. Ambedkar Jayanti
  "2026-05-01", // Maharashtra Day
  "2026-08-15", // Independence Day
  "2026-10-02", // Mahatma Gandhi Jayanti
  "2026-10-20", // Dussehra
  "2026-11-08", // Diwali Balipratipada
  "2026-11-24", // Guru Nanak Jayanti
  "2026-12-25", // Christmas
]);

export interface MarketSessionValidationResult {
  isValid: boolean;
  sessionStatus: Phase25MarketSessionStatus;
  istTimestamp: string;
  istDate: string;
  rejectionReason: string | null;
}

export class MarketSessionValidator {
  /**
   * Converts any Date, string, or number to IST Date components (Year, Month 1-12, Date, Hour 0-23, Minute 0-59, Day 0-6).
   */
  public getIstComponents(inputDate?: Date | string | number): {
    year: number;
    month: number;
    date: number;
    hours: number;
    minutes: number;
    seconds: number;
    dayOfWeek: number;
    isoIstString: string;
    dateString: string;
  } {
    const dateObj = inputDate ? new Date(inputDate) : new Date();
    if (isNaN(dateObj.getTime())) {
      throw new Error(`Invalid date provided to MarketSessionValidator: ${inputDate}`);
    }

    // Convert to IST offset (UTC + 5:30 = +330 minutes)
    const utcTime = dateObj.getTime() + dateObj.getTimezoneOffset() * 60_000;
    const istTime = new Date(utcTime + 330 * 60_000);

    const year = istTime.getFullYear();
    const month = istTime.getMonth() + 1; // 1-12
    const date = istTime.getDate();
    const hours = istTime.getHours();
    const minutes = istTime.getMinutes();
    const seconds = istTime.getSeconds();
    const dayOfWeek = istTime.getDay(); // 0 = Sun, 6 = Sat

    const monthStr = month < 10 ? `0${month}` : `${month}`;
    const dateStr = date < 10 ? `0${date}` : `${date}`;
    const hoursStr = hours < 10 ? `0${hours}` : `${hours}`;
    const minutesStr = minutes < 10 ? `0${minutes}` : `${minutes}`;
    const secondsStr = seconds < 10 ? `0${seconds}` : `${seconds}`;

    const dateString = `${year}-${monthStr}-${dateStr}`;
    const isoIstString = `${dateString}T${hoursStr}:${minutesStr}:${secondsStr}+05:30`;

    return {
      year,
      month,
      date,
      hours,
      minutes,
      seconds,
      dayOfWeek,
      isoIstString,
      dateString,
    };
  }

  /**
   * Returns current IST date string (YYYY-MM-DD).
   */
  public getIstDateString(inputDate?: Date | string | number): string {
    return this.getIstComponents(inputDate).dateString;
  }

  /**
   * Returns formatted IST ISO timestamp string (YYYY-MM-DDTHH:MM:SS+05:30).
   */
  public getIstTimestamp(inputDate?: Date | string | number): string {
    return this.getIstComponents(inputDate).isoIstString;
  }

  /**
   * Evaluates the current market session status in IST.
   */
  public getMarketSessionStatus(inputDate?: Date | string | number): Phase25MarketSessionStatus {
    const comp = this.getIstComponents(inputDate);

    // 1. Weekend Check (Saturday = 6, Sunday = 0)
    if (comp.dayOfWeek === 0 || comp.dayOfWeek === 6) {
      return "WEEKEND";
    }

    // 2. NSE Holiday Check
    if (NSE_TRADING_HOLIDAYS.has(comp.dateString)) {
      return "HOLIDAY";
    }

    // 3. Time of Day Check (IST)
    const timeInMinutes = comp.hours * 60 + comp.minutes;
    const preMarketStart = 9 * 60; // 09:00 IST = 540 min
    const marketOpenStart = 9 * 60 + 15; // 09:15 IST = 555 min
    const marketCloseEnd = 15 * 60 + 30; // 15:30 IST = 930 min

    if (timeInMinutes >= marketOpenStart && timeInMinutes < marketCloseEnd) {
      return "MARKET_OPEN";
    }

    if (timeInMinutes >= preMarketStart && timeInMinutes < marketOpenStart) {
      return "PRE_MARKET";
    }

    return "MARKET_CLOSED";
  }

  /**
   * Validates if trading can be executed for the given time.
   */
  public validateSessionForTrading(inputDate?: Date | string | number): MarketSessionValidationResult {
    const comp = this.getIstComponents(inputDate);
    const sessionStatus = this.getMarketSessionStatus(inputDate);

    if (sessionStatus === "MARKET_OPEN") {
      return {
        isValid: true,
        sessionStatus: "MARKET_OPEN",
        istTimestamp: comp.isoIstString,
        istDate: comp.dateString,
        rejectionReason: null,
      };
    }

    let rejectionReason = "MARKET_SESSION_CLOSED";
    if (sessionStatus === "HOLIDAY" || sessionStatus === "WEEKEND") {
      rejectionReason = "MARKET_CLOSED_OR_HOLIDAY";
    } else if (sessionStatus === "PRE_MARKET") {
      rejectionReason = "PRE_MARKET_TRADING_NOT_ALLOWED";
    }

    return {
      isValid: false,
      sessionStatus,
      istTimestamp: comp.isoIstString,
      istDate: comp.dateString,
      rejectionReason,
    };
  }

  /**
   * Utility to check if given timestamp is within MARKET_OPEN session.
   */
  public isMarketOpen(inputDate?: Date | string | number): boolean {
    return this.getMarketSessionStatus(inputDate) === "MARKET_OPEN";
  }
}

export const marketSessionValidator = new MarketSessionValidator();
