// ROUND3 W-1 — the website's home, until the real pages land (W-4).
export default function StoreHome() {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/shop/logo.png" alt="Gift Valy" width={240} height={72} />
      <p className="text-lg text-muted">Gifts delivered anywhere in Bangladesh — our website is opening soon.</p>
    </div>
  );
}
