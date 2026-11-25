import type { Metadata } from "next";
import { notFound } from "next/navigation";

// ROUND3 W-4 — any address the website doesn't have (an ERP path typed on
// the public domain included) is the website's own "not found" page, inside
// the website's layout.
export const metadata: Metadata = { title: "Page not found", robots: { index: false } };

export default function Missing() {
  notFound();
}
