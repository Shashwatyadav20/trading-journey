import type { NextConfig } from "next";

const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/indian/:path*",
        destination: `${backendUrl}/api/indian/:path*`,
      },
      {
        source: "/api/pine/:path*",
        destination: `${backendUrl}/api/pine/:path*`,
      },
      {
        source: "/market/:path*",
        destination: `${backendUrl}/market/:path*`,
      },
      {
        source: "/health",
        destination: `${backendUrl}/health`,
      },
    ];
  },
};

export default nextConfig;
