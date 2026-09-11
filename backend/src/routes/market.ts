import { FastifyPluginAsync } from 'fastify';
import { priceStore } from '../market/MarketPriceStore';

const marketRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/market/prices', async (request, reply) => {
    const prices = priceStore.getAllPrices();
    const xau = prices.find(p => p.instrument === 'XAU/USD');
    console.log(`[MarketRoutes] GET /market/prices: XAU/USD price=${xau?.price} ts=${xau?.timestamp} status=${xau?.status}`);
    return prices;
  });

  fastify.get('/market/prices/:instrument', async (request: any, reply) => {
    const { instrument } = request.params;
    // URL decode might be needed for "BTC/USD"
    const decodedInstrument = decodeURIComponent(instrument);
    const price = priceStore.getPrice(decodedInstrument);
    
    if (!price) {
      reply.status(404).send({ error: "Instrument not found" });
      return;
    }
    return price;
  });
};

export default marketRoutes;
