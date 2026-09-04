import { FastifyRequest } from "fastify";
import { jwtVerify, createRemoteJWKSet } from "jose";
import { env } from "../config/env";
import { getAdminSupabaseClient } from "../db/supabaseClient";

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthorizationError";
  }
}

/**
 * Cached JWKS remote keyset for Supabase JWT verification.
 * Lazily created on first verification call.
 */
let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJWKS(): ReturnType<typeof createRemoteJWKSet> {
  if (!_jwks) {
    if (!env.SUPABASE_URL) {
      throw new AuthenticationError("SUPABASE_URL is not configured.");
    }
    // Supabase exposes its JWT public keys at this standard endpoint
    const jwksUrl = new URL(`${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json`);
    _jwks = createRemoteJWKSet(jwksUrl);
  }
  return _jwks;
}

/**
 * Represents the verified identity from a Supabase JWT.
 */
export interface VerifiedUser {
  userId: string;  // = JWT sub = auth.uid()
}

/**
 * Extracts and cryptographically verifies the Supabase JWT from the
 * Authorization: Bearer <token> header.
 *
 * Security guarantees:
 * - Signature is verified against Supabase's public JWKS endpoint.
 * - Token expiry (exp) is enforced automatically by jose.
 * - The user ID comes ONLY from the verified JWT `sub` claim.
 * - x-user-id header is IGNORED entirely.
 * - Request body / query params are NEVER used for identity.
 */
export async function extractVerifiedUser(request: FastifyRequest): Promise<VerifiedUser> {
  const authHeader = request.headers["authorization"];

  if (!authHeader) {
    throw new AuthenticationError("Missing Authorization header.");
  }

  if (!authHeader.startsWith("Bearer ")) {
    throw new AuthenticationError("Authorization header must use the Bearer scheme.");
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    throw new AuthenticationError("Bearer token is empty.");
  }

  let payload: any;
  try {
    const { payload: jwtPayload } = await jwtVerify(token, getJWKS());
    payload = jwtPayload;
  } catch (err: any) {
    // Do not leak internal error details
    if (err?.code === "ERR_JWT_EXPIRED") {
      throw new AuthenticationError("Access token has expired. Please sign in again.");
    }
    throw new AuthenticationError("Invalid or malformed access token.");
  }

  const userId = payload.sub as string | undefined;
  if (!userId || typeof userId !== "string") {
    throw new AuthenticationError("Access token missing user identity (sub claim).");
  }

  // Basic UUID format sanity check (Supabase always uses UUIDs)
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(userId)) {
    throw new AuthenticationError("Access token contains an invalid user identity.");
  }

  return { userId };
}

/**
 * Checks that the verified user is approved in `profiles.approved`.
 * Uses the service-role client so the check is server-authoritative.
 *
 * Throws AuthorizationError (403) if the user is not approved.
 */
export async function requireApprovedUser(userId: string): Promise<void> {
  const supabase = getAdminSupabaseClient();

  const { data, error } = await supabase
    .from("profiles")
    .select("approved")
    .eq("id", userId)
    .maybeSingle<{ approved: boolean }>();

  if (error) {
    // Fail closed: if we can't read approval status, deny access
    throw new AuthorizationError("Could not verify account status. Access denied.");
  }

  if (!data || data.approved !== true) {
    throw new AuthorizationError("Your account is pending admin approval.");
  }
}

// ─── TEST / DEV ONLY BYPASS ─────────────────────────────────────────────────
// This bypass is only active when ALLOW_TEST_AUTH=true in the environment.
// It MUST NOT be set in production. It is for the vitest test suite only.
const TEST_AUTH_ENABLED = process.env.ALLOW_TEST_AUTH === "true";

/**
 * @internal TEST USE ONLY
 *
 * Returns a mock VerifiedUser for unit tests.
 * Only works when ALLOW_TEST_AUTH=true environment variable is set.
 * Throws if called in production context.
 */
export function _testExtractUser(userId: string): VerifiedUser {
  if (!TEST_AUTH_ENABLED) {
    throw new AuthenticationError("Test auth bypass is not enabled.");
  }
  return { userId };
}
