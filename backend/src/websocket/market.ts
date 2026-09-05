import { FastifyPluginAsync } from 'fastify';
import { priceStore } from '../market/MarketPriceStore';
import { tradingEventBus } from './trading';

const websocketRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/ws/market', { websocket: true }, (connection: any, req) => {
    const origin = req?.headers?.origin || 'unknown';
    fastify.log.info(`[WebSocket] Upgrade connection received on /ws/market | origin="${origin}"`);

    // In @fastify/websocket v11, connection may be the WebSocket directly or contain .socket
    const socket = connection.socket || connection;

    if (!socket) {
      fastify.log.error(`[WebSocket] Handshake failed: unable to resolve socket from connection object | origin="${origin}"`);
      return;
    }

    fastify.log.info(`[WebSocket] Handshake accepted & connection opened | origin="${origin}"`);

    const isSocketOpen = () => {
      return socket && (socket.readyState === 1 || socket.readyState === socket.OPEN);
    };

    let totalMessagesSent = 0;

    // Send initial snapshot to the client
    try {
      const prices = priceStore.getAllPrices();
      fastify.log.info(`[WebSocket] Preparing initial market snapshot | count=${prices.length} origin="${origin}"`);
      prices.forEach((price) => {
        if (isSocketOpen()) {
          socket.send(JSON.stringify({
            type: "priceUpdate",
            data: price
          }));
          totalMessagesSent++;
        }
      });
      fastify.log.info(`[WebSocket] Initial snapshot successfully sent | instruments=${prices.map(p => p.instrument).join(',')} origin="${origin}"`);
    } catch (err: any) {
      fastify.log.error(`[WebSocket] Error sending initial snapshot: ${err?.message || String(err)} | origin="${origin}"`);
    }

    // Subscribe to store updates
    const onPriceUpdate = (price: any) => {
      if (isSocketOpen()) {
        try {
          socket.send(JSON.stringify({
            type: "priceUpdate",
            data: price
          }));
          totalMessagesSent++;
        } catch (err: any) {
          fastify.log.error(`[WebSocket] Error sending price update: ${err?.message || String(err)} | origin="${origin}"`);
        }
      }
    };

    priceStore.subscribe(onPriceUpdate);
    fastify.log.info(`[WebSocket] Subscribed to MarketPriceStore live updates | origin="${origin}"`);

    // Subscribe to trading events
    const onTradingEvent = (type: string) => (data: any) => {
      if (isSocketOpen()) {
        try {
          socket.send(JSON.stringify({
            type,
            data
          }));
          totalMessagesSent++;
        } catch (err: any) {
          fastify.log.error(`[WebSocket] Error sending trading event ${type}: ${err?.message || String(err)} | origin="${origin}"`);
        }
      }
    };

    const onPositionCreated = onTradingEvent("positionCreated");
    const onPositionUpdated = onTradingEvent("positionUpdated");
    const onPositionClosed = onTradingEvent("positionClosed");
    
    const onPendingOrderCreated = onTradingEvent("pendingOrderCreated");
    const onPendingOrderUpdated = onTradingEvent("pendingOrderUpdated");
    const onPendingOrderFilled = onTradingEvent("pendingOrderFilled");
    const onPendingOrderCancelled = onTradingEvent("pendingOrderCancelled");

    tradingEventBus.on("positionCreated", onPositionCreated);
    tradingEventBus.on("positionUpdated", onPositionUpdated);
    tradingEventBus.on("positionClosed", onPositionClosed);
    
    tradingEventBus.on("pendingOrderCreated", onPendingOrderCreated);
    tradingEventBus.on("pendingOrderUpdated", onPendingOrderUpdated);
    tradingEventBus.on("pendingOrderFilled", onPendingOrderFilled);
    tradingEventBus.on("pendingOrderCancelled", onPendingOrderCancelled);

    const cleanup = (reason: string) => {
      fastify.log.info(`[WebSocket] Cleaning up subscriptions (${reason}) | totalMessagesSent=${totalMessagesSent} origin="${origin}"`);
      priceStore.unsubscribe(onPriceUpdate);
      tradingEventBus.off("positionCreated", onPositionCreated);
      tradingEventBus.off("positionUpdated", onPositionUpdated);
      tradingEventBus.off("positionClosed", onPositionClosed);
      
      tradingEventBus.off("pendingOrderCreated", onPendingOrderCreated);
      tradingEventBus.off("pendingOrderUpdated", onPendingOrderUpdated);
      tradingEventBus.off("pendingOrderFilled", onPendingOrderFilled);
      tradingEventBus.off("pendingOrderCancelled", onPendingOrderCancelled);
    };

    if (socket && typeof socket.on === 'function') {
      socket.on('close', (code: number, reasonBuf: Buffer) => {
        const reasonStr = reasonBuf ? reasonBuf.toString() : '';
        fastify.log.info(`[WebSocket] Socket closed | code=${code} reason="${reasonStr || 'none'}" origin="${origin}" totalMessagesSent=${totalMessagesSent}`);
        cleanup(`closed code=${code}`);
      });
      socket.on('error', (err: any) => {
        fastify.log.error(`[WebSocket] Socket error: ${err?.message || String(err)} | origin="${origin}"`);
        cleanup(`error=${err?.message || String(err)}`);
      });
    }
  });
};

export default websocketRoutes;

