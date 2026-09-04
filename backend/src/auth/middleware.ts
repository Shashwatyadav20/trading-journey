import { FastifyReply, FastifyRequest } from "fastify";
import {
  extractVerifiedUser,
  requireApprovedUser,
  AuthenticationError,
  AuthorizationError,
  VerifiedUser,
} from "../trading/userContext";

// Extend Fastify's request type with the verified user identity
declare module "fastify" {
  interface FastifyRequest {
    verifiedUser?: VerifiedUser;
  }
}

/**
 * Fastify preHandler: Authenticate + Authorize trading requests.
 *
 * 1. Verifies the Supabase JWT from Authorization: Bearer <token>
 * 2. Checks profiles.approved === true for the verified user
 * 3. Attaches request.verifiedUser for use in route handlers
 *
 * Returns 401 for authentication failures.
 * Returns 403 for authorization failures (unapproved user).
 * Returns 500 for unexpected errors.
 */
export async function authenticateRequest(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  try {
    const verifiedUser = await extractVerifiedUser(request);
    await requireApprovedUser(verifiedUser.userId);
    request.verifiedUser = verifiedUser;
  } catch (err) {
    if (err instanceof AuthenticationError) {
      reply.status(401).send({ error: err.message });
      return;
    }
    if (err instanceof AuthorizationError) {
      reply.status(403).send({ error: err.message });
      return;
    }
    // Unexpected error — fail closed, do not reveal internals
    request.log.error(err, "Unexpected error in authenticateRequest");
    reply.status(500).send({ error: "Internal Server Error" });
  }
}

/**
 * Retrieves the verified user from the request context.
 * Throws if the route was not protected by authenticateRequest.
 * This is the ONLY safe way to get the user ID in a route handler.
 */
export function getVerifiedUser(request: FastifyRequest): VerifiedUser {
  if (!request.verifiedUser) {
    throw new Error(
      "getVerifiedUser() called on an unprotected route. " +
      "Add authenticateRequest as a preHandler first."
    );
  }
  return request.verifiedUser;
}
