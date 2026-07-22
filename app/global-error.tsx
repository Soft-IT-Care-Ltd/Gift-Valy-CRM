"use client";

// Last-resort error boundary: replaces the root layout when client JS crashes,
// so users see a message instead of a silent white page. globals.css is NOT
// applied here (the root layout is gone) — inline styles only, no app imports.
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#fafafa",
          color: "#18181b",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          textAlign: "center",
          padding: 16,
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: 14, color: "#71717a", marginBottom: 20 }}>
            An unexpected error occurred{error?.digest ? ` (${error.digest})` : ""}.
            Please reload the page.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "10px 24px",
              fontSize: 15,
              borderRadius: 8,
              border: "none",
              background: "#7c3aed",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
