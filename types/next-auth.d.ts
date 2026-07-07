import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: number;
      role: string;
      teamId: number | null;
      mustChangePassword: boolean;
      permissions: string[];
    } & DefaultSession["user"];
  }

  interface User {
    role: string;
    teamId: number | null;
    mustChangePassword: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    uid: number;
    role: string;
    teamId: number | null;
    mustChangePassword: boolean;
    permissions: string[];
  }
}
