import type { NextConfig } from "next";
import { withWorkflow } from "workflow/next";

const nextConfig: NextConfig = {
  transpilePackages: ["@repo/ui", "@settle-kit/core", "@settle-kit/react", "@settle-kit/server"],
};

export default withWorkflow(nextConfig);
