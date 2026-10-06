/**
 * Centralised backend URL helper.
 *
 * All Indian-market (and other backend) API calls MUST use this helper so that
 * the production Vercel deployment reaches the Render backend instead of the
 * unreachable http://localhost:4000.
 *
 * Set NEXT_PUBLIC_BACKEND_URL in:
 *   - .env.local  →  http://localhost:4000   (local development)
 *   - Vercel dashboard  →  https://<your-render-app>.onrender.com  (production)
 *
 * NEVER hardcode http://localhost:4000 in component files.
 */
export const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "") ??
  "http://localhost:4000";

/**
 * Returns the full URL for an Indian-market backend API path.
 *
 * @example
 *   apiUrl("/api/indian/signal")
 *   // → "https://my-app.onrender.com/api/indian/signal"
 */
export function apiUrl(path: string): string {
  return `${BACKEND_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
