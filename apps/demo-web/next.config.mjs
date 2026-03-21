import { fileURLToPath } from "node:url";
import { config } from "dotenv";

config({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

/** @type {import('next').NextConfig} */
const nextConfig = {
  devIndicators: false,
  eslint: {
    ignoreDuringBuilds: true,
  },
  transpilePackages: ["@cua-sample/replay-schema"],
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
};

export default nextConfig;
