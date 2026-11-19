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

  /**
   * Strategy 03 4H Monitoring Runtime & Deployment Verification Endpoint (Read-Only).
   * Safe for monitoring: returns scheduler bootstrap status, execution environment,
   * active scheduler instance count, session cycle timestamps, and persistence status
   * without leaking any credentials or secrets.
   */
  fastify.get('/health/strategy03-4h-runtime', async (_request, reply) => {
    const { strategy03FourHourMonitoringService } = await import(
      '../indian/swing/research/strategy03/prebreakout/Strategy03FourHourMonitoringService'
    );
    const runtimeHealth = strategy03FourHourMonitoringService.getDeploymentHealth();
    return reply.send({
      status: 'ok',
      service: 'trading-backend',
      phase: '6.10.19.17',
      researchOnly: true,
      strategy03Active: false,
      executionEnabled: false,
      gitCommitSha: process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT_SHA ?? null,
      renderServiceId: process.env.RENDER_SERVICE_ID ? 'CONFIGURED' : null,
      runtimeHealth,
    });
  });
};

export default healthRoutes;
