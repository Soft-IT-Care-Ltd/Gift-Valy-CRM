"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";

export function LoginForm({
  initialIdentifier,
  sharedSignin,
}: {
  initialIdentifier: string;
  sharedSignin: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [identifier, setIdentifier] = useState(initialIdentifier);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const res = await signIn("credentials", {
      identifier,
      password,
      redirect: false,
    });
    setLoading(false);
    if (res?.error) {
      setError("Invalid phone/email or password, or account deactivated.");
      return;
    }
    router.push(searchParams.get("callbackUrl") ?? "/");
    router.refresh();
  }

  return (
    <Card className="w-full max-w-sm">
      <CardHeader className="text-center">
        <div className="flex justify-center">
          <Image
            src="/gift-valy-logo.png"
            alt="Gift Valy"
            width={815}
            height={246}
            priority
            className="h-12 w-auto"
          />
        </div>
        <CardDescription className="mt-3">
          Business Management — sign in
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="identifier">Phone or email</Label>
            <Input
              id="identifier"
              type="text"
              inputMode="email"
              autoComplete="username"
              placeholder="017XXXXXXXX or your email"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              autoFocus={!initialIdentifier}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              // /login?identifier=… (from the shared sign-in page): the box is
              // filled, so the cursor goes straight to the password.
              autoFocus={!!initialIdentifier}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={loading}>
            {loading ? "Signing in…" : "Sign in"}
          </Button>
        </form>
        {sharedSignin && (
          // FUNNEL_LINER.md GV-5 — /go/switch belongs to the shared sign-in
          // page (the proxy): it forgets the shop remembered on this device.
          <p className="mt-4 text-center text-xs text-muted-foreground">
            Not your shop?{" "}
            <a
              href="/go/switch"
              className="font-medium text-foreground underline-offset-2 hover:text-primary hover:underline"
            >
              Sign in with another number
            </a>
          </p>
        )}
      </CardContent>
    </Card>
  );
}
