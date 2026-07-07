import { getServerSession, type Session } from "next-auth";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { authOptions } from "./auth";
import { getEffectivePermissions } from "./rbac";

export class AuthzError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function requireUser(): Promise<Session> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new AuthzError(401, "Not authenticated");
  return session;
}

// Live DB check (not the JWT snapshot) so matrix/override edits and
// deactivation take effect immediately on the API layer.
export async function requirePermission(key: string): Promise<Session> {
  const session = await requireUser();
  const permissions = await getEffectivePermissions(session.user.id);
  if (!permissions.includes(key)) {
    throw new AuthzError(403, `Missing permission: ${key}`);
  }
  return session;
}

export function apiError(e: unknown): NextResponse {
  if (e instanceof AuthzError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  if (e instanceof ZodError) {
    const msg = e.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  console.error(e);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
