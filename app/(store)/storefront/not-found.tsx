import Link from "next/link";

// ROUND3 W-1 — the website's 404. Says nothing about the ERP behind it.
export default function StoreNotFound() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-xl font-medium">Page not found</p>
      <Link href="/" className="text-brand underline">
        Back to the home page
      </Link>
    </div>
  );
}
