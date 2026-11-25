import type { Metadata } from "next";
import { CheckoutForm } from "@/components/storefront/checkout-form";
import { copy } from "@/lib/storefront/copy";

// ROUND3 W-5 — the checkout. The form and the bag live in the browser; the
// order endpoint (POST /api/shop/order) prices everything itself. Never indexed.
// W-9 — the bag and checkout are never cached (their data is the browser's
// and /api/shop/*, both no-store); the shell is rendered per request too.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: copy.checkout.title, robots: { index: false, follow: false } };

export default function CheckoutPage() {
  return (
    <div className="sf-container pt-6 pb-10">
      <h1 className="mb-4 text-3xl">{copy.checkout.title}</h1>
      <CheckoutForm />
    </div>
  );
}
