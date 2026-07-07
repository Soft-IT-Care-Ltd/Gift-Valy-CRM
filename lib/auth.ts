import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./db";
import { getEffectivePermissions } from "./rbac";

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: 12 * 60 * 60 },
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials.password) return null;
        const user = await prisma.user.findUnique({
          where: { email: credentials.email.trim().toLowerCase() },
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
