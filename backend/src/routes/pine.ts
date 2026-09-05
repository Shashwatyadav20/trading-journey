/**
 * Pine Liquidity Routes
 * =====================
 * Read-only REST endpoints exposing the PineLevelService output.
 *
 * GET /pine/instruments
 *   Returns the list of supported instruments.
 *
 * GET /pine/levels/:instrument?tf=15
 *   Returns ActiveLevel[] for the requested instrument and chart timeframe.
 *   instrument is URL-encoded, e.g. "BTC%2FUSD" for "BTC/USD".
 *
 * GET /pine/signals/:instrument
 *   Returns active PineSignal[] detected by PineSignalEngine.
 *
 * GET /pine/zone/:instrument
 *   Returns PremiumDiscountZoneState for the requested instrument.
 *
 * GET /pine/candles/:instrument
 *   Returns historical seed candles generated/fetched during bootstrap.
 *
 * GET /pine/metadata/:instrument
 *   Returns historical/live data source metadata and parity status.
 *
 * These endpoints are unauthenticated (analytical data only, no user PII).
 * CORS is already configured globally in server.ts.
 */
import { FastifyPluginAsync } from 'fastify';
import { pineLevelService } from '../alerts/PineLevelService';

const pineRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/pine/instruments', async (_request, _reply) => {
    return { instruments: pineLevelService.getSupportedInstruments() };
  });

  fastify.get('/pine/levels/:instrument', async (request: any, _reply) => {
    const instrument = decodeURIComponent(request.params.instrument);
    const tfParam = parseInt(request.query?.tf as string, 10);
    const chartTF = !isNaN(tfParam) && tfParam > 0 ? tfParam : 15;

    const levels = pineLevelService.getLevels(instrument, chartTF);
    return {
      instrument,
      chartTF,
      levels,
      timestamp: new Date().toISOString(),
    };
  });

  fastify.get('/pine/signals/:instrument', async (request: any, _reply) => {
    const instrument = decodeURIComponent(request.params.instrument);
    const signals = pineLevelService.getSignals(instrument);
    return {
      instrument,
      count: signals.length,
      signals,
      timestamp: new Date().toISOString(),
    };
  });

  fastify.get('/pine/zone/:instrument', async (request: any, _reply) => {
    const instrument = decodeURIComponent(request.params.instrument);
    const zone = pineLevelService.getPDZoneState(instrument);
    if (!zone) {
      return { instrument, zone: null, timestamp: new Date().toISOString() };
    }
    return { instrument, zone, timestamp: new Date().toISOString() };
  });

  fastify.get('/pine/candles/:instrument', async (request: any, _reply) => {
    const instrument = decodeURIComponent(request.params.instrument);
    const candles = pineLevelService.getHistoricalCandles(instrument);
    return {
      instrument,
      count: candles.length,
      candles,
      timestamp: new Date().toISOString(),
    };
  });

  fastify.get('/pine/metadata/:instrument', async (request: any, _reply) => {
    const instrument = decodeURIComponent(request.params.instrument);
    const metadata = pineLevelService.getSourceMetadata(instrument);
    return {
      instrument,
      metadata,
      timestamp: new Date().toISOString(),
    };
  });
};

export default pineRoutes;
