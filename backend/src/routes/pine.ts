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
 * POST /pine/telegram/test  (PROTECTED — requires approved Supabase JWT)
 *   Sends a single connectivity test message to the configured Telegram chat.
 *   Returns { sent: boolean, configured: boolean }.
 *   Never returns TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID in the response.
 *
 * Analytical endpoints are unauthenticated (no user PII).
 * CORS is already configured globally in server.ts.
 */
import { FastifyPluginAsync } from 'fastify';
import { pineLevelService } from '../alerts/PineLevelService';
import { authenticateRequest } from '../auth/middleware';
import { sendTelegramMessage, isTelegramConfigured } from '../alerts/telegram/TelegramClient';

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

  /**
   * POST /pine/telegram/test
   * ========================
   * Sends a single connectivity test message to the configured Telegram chat.
   *
   * Security:
   *   - Protected by authenticateRequest (Supabase JWT + approved user check).
   *   - Never returns TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID in the response.
   *   - Response contains only { sent: boolean, configured: boolean }.
   *
   * Rate limiting:
   *   - Guarded by approved-user authentication — not publicly accessible.
   *
   * Use this to verify Telegram connectivity after configuring credentials.
   */
  fastify.post('/pine/telegram/test', {
    preHandler: authenticateRequest,
  }, async (_request, reply) => {
    const configured = isTelegramConfigured();
    const result = await sendTelegramMessage(
      '🟢 *Trading Journey Telegram Test*\n\nTelegram alert delivery is connected successfully.'
    );
    // Never return token, chat_id, or any credential in the response.
    reply.status(200).send({
      sent: result.sent,
      configured,
    });
  });
};

export default pineRoutes;
