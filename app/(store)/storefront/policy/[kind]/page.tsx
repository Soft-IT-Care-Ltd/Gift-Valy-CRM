import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cachedSettings } from "@/lib/storefront/cached";
import { POLICY_KINDS, POLICY_TITLES, type PolicyKind } from "@/lib/storefront/settings-shape";

// ROUND3 W-4 — the policy texts from Settings → Website (W-7): delivery,
// refund & return, privacy, terms. A page exists once its text is filled in.
export const revalidate = 600;
export const dynamicParams = false;
export function generateStaticParams() {
  return POLICY_KINDS.map((kind) => ({ kind }));
}

type Props = { params: Promise<{ kind: string }> };
const isKind = (k: string): k is PolicyKind => (POLICY_KINDS as readonly string[]).includes(k);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { kind } = await params;
  if (!isKind(kind)) return {};
  // W-8 — the first lines of the text as the description.
  const text = (await cachedSettings()).policies[kind].replace(/\s+/g, " ").trim();
  const description = text.length > 155 ? `${text.slice(0, 154).trimEnd()}…` : text;
  return { title: POLICY_TITLES[kind], description: description || undefined, alternates: { canonical: `/policy/${kind}` } };
}

export default async function PolicyPage({ params }: Props) {
  const { kind } = await params;
  if (!isKind(kind)) notFound();
  const text = (await cachedSettings()).policies[kind];
  if (!text) notFound();
  return (
    <article className="sf-container max-w-3xl pt-8">
      <h1 className="mb-4 text-3xl md:text-4xl">{POLICY_TITLES[kind]}</h1>
      <div className="text-[16px] leading-[1.8] whitespace-pre-line text-body">{text}</div>
    </article>
  );
}
