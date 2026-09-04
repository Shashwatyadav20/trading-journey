export interface PriceResult {
  price: number;
  fetchedAt: string;
}

export class CoinGeckoClient {
  private static instance: CoinGeckoClient | null = null;
  private cache: Map<string, PriceResult> = new Map();
  private lastFetchTime: number = 0;
  private minFetchIntervalMs: number = 6000;
  private backoffMs: number = 0;
  private backoffUntil: number = 0;
  private inFlightPromise: Promise<Map<string, PriceResult>> | null = null;

  public static getInstance(): CoinGeckoClient {
    if (!CoinGeckoClient.instance) {
      CoinGeckoClient.instance = new CoinGeckoClient();
    }
    return CoinGeckoClient.instance;
  }

  public static resetInstance(): void {
    CoinGeckoClient.instance = new CoinGeckoClient();
  }

  public setMinFetchIntervalMs(ms: number): void {
    this.minFetchIntervalMs = ms;
  }

  public getBackoffUntil(): number {
    return this.backoffUntil;
  }

  public async fetchPrices(coinIds: string[]): Promise<Map<string, PriceResult>> {
    const now = Date.now();

    if (now < this.backoffUntil) {
      const remainingBackoff = this.backoffUntil - now;
      console.warn(
        `[CoinGeckoClient] Skipping fetch during backoff. Next retry in ${remainingBackoff}ms (at ${new Date(this.backoffUntil).toISOString()}).`
      );
      return this.cache;
    }

    if (this.inFlightPromise) {
      return this.inFlightPromise;
    }

    if (this.lastFetchTime > 0 && (now - this.lastFetchTime) < this.minFetchIntervalMs && this.cache.size > 0) {
      return this.cache;
    }

    this.inFlightPromise = this.executeFetch(coinIds);
    try {
      return await this.inFlightPromise;
    } finally {
      this.inFlightPromise = null;
    }
  }

  private async executeFetch(coinIds: string[]): Promise<Map<string, PriceResult>> {
    const defaultIds = ["bitcoin", "pax-gold"];
    const allIds = Array.from(new Set([...defaultIds, ...coinIds]));
    const idsParam = allIds.join(",");
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${idsParam}&vs_currencies=usd`;

    console.log(`[CoinGeckoClient] Poll started for ids=${idsParam} at ${new Date().toISOString()}`);

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url, {
        signal: controller.signal,
        cache: "no-store",
        headers: {
          "Accept": "application/json",
        },
      });
      clearTimeout(timer);

      const cacheControl = res.headers.get("cache-control") || "none";
      const age = res.headers.get("age") || "none";
      const retryAfterHeader = res.headers.get("retry-after");

      if (res.status === 429) {
        let retryAfterSec = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 0;
        if (isNaN(retryAfterSec) || retryAfterSec <= 0) {
          retryAfterSec = 10;
        }
        this.backoffMs = Math.min(this.backoffMs ? this.backoffMs * 2 : retryAfterSec * 1000, 60000);
        this.backoffUntil = Date.now() + this.backoffMs;

        let body = "";
        try {
          body = await res.text();
        } catch {
          body = "<failed to read response body>";
        }

        const err = new Error(
          `HTTP 429 Too Many Requests for ids=${idsParam}. ` +
          `Cache-Control: ${cacheControl}, Age: ${age}, Retry-After: ${retryAfterHeader || "none"}. ` +
          `Response body: ${body}. Backing off for ${this.backoffMs}ms until ${new Date(this.backoffUntil).toISOString()}.`
        );
        (err as any).status = 429;
        (err as any).responseBody = body;
        throw err;
      }

      if (!res.ok) {
        let body = "";
        try {
          body = await res.text();
        } catch {
          body = "<failed to read response body>";
        }
        const err = new Error(`HTTP error ${res.status} ${res.statusText} for ids=${idsParam}. Response body: ${body}`);
        (err as any).status = res.status;
        (err as any).responseBody = body;
        throw err;
      }

      const data = await res.json();
      console.log(
        `[CoinGeckoClient] Poll succeeded for ids=${idsParam}. HTTP 200 OK. Cache-Control: ${cacheControl}, Age: ${age}`
      );

      const fetchedAt = new Date().toISOString();
      const updatedMap = new Map<string, PriceResult>();

      for (const id of allIds) {
        const rawPrice = data?.[id]?.usd;
        const price = typeof rawPrice === "number" ? rawPrice : parseFloat(rawPrice);
        if (typeof price === "number" && Number.isFinite(price) && price > 0) {
          const result: PriceResult = { price, fetchedAt };
          this.cache.set(id, result);
          updatedMap.set(id, result);
        }
      }

      this.lastFetchTime = Date.now();
      this.backoffMs = 0;
      this.backoffUntil = 0;

      return this.cache;
    } catch (err: any) {
      const statusInfo = err?.status ? ` HTTP status: ${err.status}.` : "";
      const bodyInfo = err?.responseBody ? ` Response body: ${err.responseBody}.` : "";
      console.error(
        `[CoinGeckoClient] Poll failed for ids=${idsParam}:${statusInfo}${bodyInfo} errorName=${err?.name || "Error"} errorMessage=${err?.message || String(err)}`
      );
      throw err;
    }
  }
}
