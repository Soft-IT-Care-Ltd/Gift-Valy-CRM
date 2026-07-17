import type { Metadata } from "next";
import "./ds.css";

export const metadata: Metadata = {
  title: "Design System — Soft IT Care",
  description: "Colour theme, foundations, components, and patterns for Soft IT Care.",
};

export default function DesignSystemLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
