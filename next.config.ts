import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        aggregateTimeout: 300,
        ignored: ["**/.git/**", "**/.next/**", "**/node_modules/**"],
        poll: 1000,
      };
    }

    return config;
  },
};

export default nextConfig;
