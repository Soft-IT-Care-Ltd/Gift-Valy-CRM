import { Suspense } from "react";
import { LoginForm } from "@/components/auth/login-form";

// FUNNEL_LINER.md GV-5 — sign in with a phone number or an email.
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ identifier?: string | string[] }>;
}) {
  const { identifier } = await searchParams;
  const initialIdentifier = (Array.isArray(identifier) ? identifier[0] : identifier ?? "")
    .trim()
    .slice(0, 255);
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 bg-muted/40 p-4">
      <Suspense>
        <LoginForm
          initialIdentifier={initialIdentifier}
          // Shown only once Funnel Liner's shared sign-in page is live.
          sharedSignin={process.env.SHARED_SIGNIN === "enabled"}
        />
      </Suspense>
      <p className="text-xs text-muted-foreground">
        Developed by{" "}
        <a
          href="https://softitcare.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-foreground underline-offset-2 hover:text-primary hover:underline"
        >
          Soft IT Care
        </a>
      </p>
    </main>
  );
}
