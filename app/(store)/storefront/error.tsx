"use client";

import { useEffect } from "react";
import { copy } from "@/lib/storefront/copy";

// ROUND3 W-4 — a page that failed to build says so plainly, with a reload.
export default function StoreError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div role="alert" className="sf-container flex flex-col items-center gap-4 py-20 text-center">
      <h1 className="text-2xl">{copy.errorPage.title}</h1>
      <p className="text-muted">{copy.errorPage.body}</p>
      <button type="button" className="sf-btn sf-btn-navy" onClick={() => window.location.reload()}>
        {copy.errorPage.reload}
      </button>
    </div>
  );
}
