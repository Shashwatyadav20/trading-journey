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
  process.env.NEXT_PUBLIC_BACKEND_URL && !process.env.NEXT_PUBLIC_BACKEND_URL.includes("localhost")
    ? process.env.NEXT_PUBLIC_BACKEND_URL.replace(/\/$/, "")
    : typeof window !== "undefined" && !window.location.hostname.includes("localhost")
    ? "https://trading-journey-backend.onrender.com"
    : process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/$/, "") ?? "http://localhost:4000";

/**
 * Returns the full URL for an Indian-market backend API path.
 */
export function apiUrl(path: string): string {
  // If we're in the browser on Vercel and the path is /api/indian/swing/*, use relative URL
  // so Next.js App Router API route handles it directly with zero latency!
  if (typeof window !== "undefined" && path.startsWith("/api/indian/swing")) {
    return path;
  }
  return `${BACKEND_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

