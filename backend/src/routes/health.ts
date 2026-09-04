import { FastifyPluginAsync } from 'fastify';

const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/health', async (request, reply) => {
    return {
      status: 'ok',
      service: 'trading-backend',
      timestamp: new Date().toISOString()
    };
  });
};

export default healthRoutes;
