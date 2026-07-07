import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit reads font data files from its package dir at runtime — keep it
  // unbundled so those paths resolve from node_modules.
  serverExternalPackages: ["pdfkit"],
  // A stray lockfile in the home directory makes Next.js mis-infer the
  // workspace root — pin it to this app (cwd is the app dir under `npm run dev`).
  turbopack: { root: path.resolve(process.cwd()) },
};

export default nextConfig;
