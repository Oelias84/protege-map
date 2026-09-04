import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  // self-contained server bundle for the Docker image
  output: "standalone",
  eslint: { ignoreDuringBuilds: true },
  outputFileTracingRoot: root,
  turbopack: { root },
  webpack: (config) => {
    config.resolve.alias["@"] = root;
    return config;
  },
};

export default nextConfig;
