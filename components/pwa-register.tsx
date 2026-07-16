"use client";

import { useEffect } from "react";

// Registers /sw.js (SPEC §16 Phase 4 — mobile PWA). Production only: a service
// worker in dev would cache-fight HMR and serve stale bundles.
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("Service worker registration failed:", err);
    });
  }, []);
  return null;
}
