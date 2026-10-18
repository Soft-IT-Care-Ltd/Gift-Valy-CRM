import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./db";
import { getEffectivePermissions } from "./rbac";
import { signInUserWhere } from "./sign-in-user";

// FUNNEL_LINER.md GV-5 — dashboard.funnelliner.com is shared by every Funnel
// Liner client, so Gift Valy's auth cookies carry their own names and can
// never collide with another shop's. __Secure-/__Host- prefixes only over
// https (browsers refuse them on plain http — development).
const secureCookies = (process.env.NEXTAUTH_URL ?? "").startsWith("https://");
const cookiePrefix = secureCookies ? "__Secure-" : "";
const cookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  secure: secureCookies,
};
export const SESSION_COOKIE_NAME = `${cookiePrefix}gv.session-token`;

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: 12 * 60 * 60 },
  pages: { signIn: "/login" },
  useSecureCookies: secureCookies,
  cookies: {
    sessionToken: { name: SESSION_COOKIE_NAME, options: cookieOptions },
    callbackUrl: { name: `${cookiePrefix}gv.callback-url`, options: cookieOptions },
    csrfToken: {
      name: `${secureCookies ? "__Host-" : ""}gv.csrf-token`,
      options: cookieOptions,
    },
  },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      // GV-5 — one box: a phone number or an email.
      credentials: {
        identifier: { label: "Phone or email", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.identifier || !credentials.password) return null;
        // The same match /api/platform/has-user answers with (active users only).
        const where = signInUserWhere(credentials.identifier);
        if (!where) return null;
        const user = await prisma.user.findFirst({
          where,
          include: { role: true },
        });
        if (!user || !user.isActive) return null;
        const ok = await bcrypt.compare(credentials.password, user.passwordHash);
        if (!ok) return null;
        return {
          id: String(user.id),
          name: user.name,
          email: user.email,
          role: user.role.name,
          teamId: user.teamId,
          mustChangePassword: user.mustChangePassword,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger }) {
      if (user) {
        token.uid = Number(user.id);
        token.role = user.role;
        token.teamId = user.teamId;
        token.mustChangePassword = user.mustChangePassword;
        token.permissions = await getEffectivePermissions(token.uid);
      } else if (trigger === "update" && token.uid) {
        // session.update() → re-read role/permissions/flags from DB
        const fresh = await prisma.user.findUnique({
          where: { id: token.uid },
          include: { role: true },
        });
        if (fresh) {
          token.role = fresh.role.name;
          token.teamId = fresh.teamId;
          token.mustChangePassword = fresh.mustChangePassword;
          token.permissions = await getEffectivePermissions(token.uid);
        }
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.uid;
      session.user.role = token.role;
      session.user.teamId = token.teamId;
      session.user.mustChangePassword = token.mustChangePassword;
      session.user.permissions = token.permissions ?? [];
      return session;
    },
  },
};
