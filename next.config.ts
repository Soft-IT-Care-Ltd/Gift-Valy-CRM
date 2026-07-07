import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit reads font data files from its package dir at runtime — keep it
  // unbundled so those paths resolve from node_modules.
  serverExternalPackages: ["pdfkit"],
};

export default nextConfig;
