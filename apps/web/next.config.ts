import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages ship TypeScript source; Next compiles them.
  transpilePackages: ["@care-circle/contracts", "@care-circle/e2e"],
  // Next dev refuses client assets to origins it doesn't know; judges may open 127.0.0.1.
  allowedDevOrigins: ["127.0.0.1"],
  // Keep the recording clean: no dev badge in the corner.
  devIndicators: false,
};

export default config;
