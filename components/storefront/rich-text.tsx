import type { RichBlock, RichSpan } from "@/lib/catalog-website-shape";

// ROUND3 W-4 — the Website panel's description (paragraphs, **bold**, "- "
// lists), already parsed to blocks by the gate. Rendered as React text —
// never as HTML.

function Spans({ spans }: { spans: RichSpan[] }) {
  return spans.map((s, i) => (s.bold ? <strong key={i}>{s.text}</strong> : <span key={i}>{s.text}</span>));
}

export function RichText({ blocks, className = "" }: { blocks: RichBlock[]; className?: string }) {
  if (blocks.length === 0) return null;
  return (
    <div className={`sf-prose ${className}`}>
      {blocks.map((b, i) =>
        b.kind === "p" ? (
          <p key={i}>
            <Spans spans={b.spans} />
          </p>
        ) : (
          <ul key={i}>
            {b.items.map((item, j) => (
              <li key={j}>
                <Spans spans={item} />
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}
