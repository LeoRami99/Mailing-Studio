import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Servidor autónomo (.next/standalone) que se empaqueta dentro de la app de Electron.
  output: "standalone",
  // Evita que Next tome como raíz una carpeta superior con otro package-lock.json.
  outputFileTracingRoot: process.cwd(),
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    root: process.cwd(),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
