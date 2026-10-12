import { FastifyPluginAsync } from 'fastify';
import { dailyScanPersistenceService } from '../db/DailyScanPersistenceService';

const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/health', async (_request, reply) => {
    const persistenceHealth = await dailyScanPersistenceService.checkPersistenceHealth();
    return reply.send({
      status: 'ok',
      service: 'trading-backend',
      timestamp: new Date().toISOString(),
      persistence: {
        configured: persistenceHealth.configured,
        reachable: persistenceHealth.reachable,
        mode: persistenceHealth.mode,
      },
    });
  });

  /**
   * Dedicated persistence health check endpoint.
   * Safe for monitoring: never leaks database passwords, keys, or JWT tokens.
   */
  fastify.get('/health/persistence', async (_request, reply) => {
    const health = await dailyScanPersistenceService.checkPersistenceHealth();
    const statusCode = health.configured && !health.reachable ? 503 : 200;
    return reply.status(statusCode).send(health);
  });
};

export default healthRoutes;
