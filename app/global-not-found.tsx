import type { Metadata } from "next";

// ROUND3 W-1 — an address that matches no route at all. The website and the
// ERP have separate root layouts, so there is no shared one to render a 404
// in. Plain on purpose: it says nothing about which app answered.
export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false },
};

export default function GlobalNotFound() {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, 'Noto Sans Bengali', sans-serif", background: "#fffaf5", color: "#1f1a17" }}>
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
          <p style={{ fontSize: 20, margin: 0 }}>Page not found</p>
        </div>
      </body>
    </html>
  );
}
