import Link from "next/link";
import { copy } from "@/lib/storefront/copy";

// ROUND3 W-1/W-4 — the website's 404. Says nothing about the ERP behind it.
export default function StoreNotFound() {
  return (
    <div className="sf-container flex min-h-[55vh] flex-col items-center justify-center gap-4 py-16 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/shop/icon.png" alt="" width={96} height={96} className="size-24 rounded-[28%] mix-blend-multiply" />
      <h1 className="text-3xl">{copy.notFound.title}</h1>
      <p className="text-muted">{copy.notFound.body}</p>
      <Link href="/" className="sf-btn sf-btn-navy">
        {copy.notFound.home}
      </Link>
    </div>
  );
}
