import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyWebsocket from '@fastify/websocket';
import { env } from './config/env';
import healthRoutes from './routes/health';
import marketRoutes from './routes/market';
import tradingRoutes from './routes/trading';
import websocketRoutes from './websocket/market';
import { marketDataService } from './market/MarketDataService';
import { tradingStateRecovery } from './trading/TradingStateRecovery';

// Ensure trading engine singleton is created at module load time.
// This subscribes TradingEngine to priceStore BEFORE market data starts.
// (Market data only starts after recovery completes in the start() function.)
import './trading/TradingEngine';

const server = Fastify({
  logger: {
    transport: env.NODE_ENV === 'development' ? {
      target: 'pino-pretty',
      options: {
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    } : undefined
  }
});

// Configure CORS
server.register(cors, {
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);

    const allowedOrigins = (env.FRONTEND_URL || '')
      .split(',')
      .map((o) => o.trim().replace(/\/$/, ''))
      .filter(Boolean);

    const cleanOrigin = origin.replace(/\/$/, '');

    if (
      env.NODE_ENV === 'development' ||
      allowedOrigins.includes(cleanOrigin) ||
      cleanOrigin.endsWith('.vercel.app') ||
      cleanOrigin.startsWith('http://localhost:') ||
      cleanOrigin.startsWith('http://127.0.0.1:')
    ) {
      return cb(null, true);
    }

    server.log.warn(
      `[CORS] Rejected origin: ${origin} (FRONTEND_URL: ${env.FRONTEND_URL})`
    );
    return cb(new Error('Not allowed by CORS'), false);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
});

// Register WebSocket
server.register(fastifyWebsocket);

// Register routes
server.register(healthRoutes);
server.register(marketRoutes);
server.register(tradingRoutes);
server.register(websocketRoutes);

// Graceful shutdown
const closeListeners = ['SIGINT', 'SIGTERM'];
closeListeners.forEach(signal => {
  process.on(signal, async () => {
    server.log.info(`${signal} signal received: closing HTTP server`);
    marketDataService.stop();
    try {
      await server.close();
      server.log.info('HTTP server closed');
      process.exit(0);
    } catch (err) {
      server.log.error(err);
      process.exit(1);
    }
  });
});

const start = async () => {
  try {
    // ─── Step 1: Recover persisted state BEFORE market ticks begin ────────────
    // This is CRITICAL for ordering: market tick processing must not start
    // until all OPEN positions and PENDING orders are restored into memory.
    // If recovery fails, we treat it as a fatal startup error unless Supabase keys are missing in dev.
    server.log.info('[Recovery] Starting trading state recovery...');
    try {
      const { positions, pendingOrders } = await tradingStateRecovery.recover();
      server.log.info(
        `[Recovery] Restored ${positions} open position(s) and ${pendingOrders} pending order(s).`
      );
    } catch (recoveryErr: any) {
      if (!env.SUPABASE_SERVICE_ROLE_KEY || !env.SUPABASE_URL) {
        server.log.warn(
          `[Recovery] Supabase credentials not configured — starting server with empty in-memory state.`
        );
      } else {
        server.log.error(
          `[Recovery] FATAL: Failed to recover trading state. Market tick processing will NOT start.`
        );
        server.log.error(`[Recovery] Error detail: ${recoveryErr.message}`);
        process.exit(1);
      }
    }

    // ─── Step 2: Start market data (ticks now have full state in memory) ──────
    marketDataService.start();

    // ─── Step 3: Start HTTP server ────────────────────────────────────────────
    await server.listen({ port: env.PORT, host: '0.0.0.0' });
    server.log.info(`Server is listening on port ${env.PORT}`);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
};

start();
