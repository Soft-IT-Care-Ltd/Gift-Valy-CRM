import path from "node:path";
import { execSync } from "node:child_process";
import type { NextConfig } from "next";
import pkg from "./package.json";

// FUNNEL_LINER.md GV-2 — the usage endpoint reports the version and commit it
// was built from. No git (a tarball build) → no commit, not a failed build.
function gitCommit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

const nextConfig: NextConfig = {
  env: {
    APP_VERSION: pkg.version,
    APP_COMMIT: process.env.APP_COMMIT || gitCommit(),
  },
  // pdfkit reads font data files from its package dir at runtime — keep it
  // unbundled so those paths resolve from node_modules.
  serverExternalPackages: ["pdfkit", "fontkit"],
  // A stray lockfile in the home directory makes Next.js mis-infer the
  // workspace root — pin it to this app (cwd is the app dir under `npm run dev`).
  turbopack: { root: path.resolve(process.cwd()) },
};

export default nextConfig;
