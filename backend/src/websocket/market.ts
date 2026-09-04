import { FastifyPluginAsync } from 'fastify';
import { priceStore } from '../market/MarketPriceStore';
import { tradingEventBus } from './trading';

const websocketRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/ws/market', { websocket: true }, (connection: any, req) => {
    // In @fastify/websocket v11, connection may be the WebSocket directly or contain .socket
    const socket = connection.socket || connection;

    const isSocketOpen = () => {
      return socket && (socket.readyState === 1 || socket.readyState === socket.OPEN);
    };

    // Send initial snapshot to the client
    const prices = priceStore.getAllPrices();
    prices.forEach((price) => {
      if (isSocketOpen()) {
        socket.send(JSON.stringify({
          type: "priceUpdate",
          data: price
        }));
      }
    });

    // Subscribe to store updates
    const onPriceUpdate = (price: any) => {
      if (isSocketOpen()) {
        socket.send(JSON.stringify({
          type: "priceUpdate",
          data: price
        }));
      }
    };

    priceStore.subscribe(onPriceUpdate);

    // Subscribe to trading events
    const onTradingEvent = (type: string) => (data: any) => {
      if (isSocketOpen()) {
        socket.send(JSON.stringify({
          type,
          data
        }));
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

    const cleanup = () => {
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
      socket.on('close', cleanup);
      socket.on('error', (err: any) => {
        fastify.log.error(err);
        cleanup();
      });
    }
  });
};

export default websocketRoutes;

