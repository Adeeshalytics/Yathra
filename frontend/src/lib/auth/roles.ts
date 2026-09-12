import type { UserRole } from "@/lib/api/types";

export const ROLE_HOME: Record<UserRole, string> = {
  customer: "/account",
  operator: "/operator",
  admin: "/admin",
};

export const ROLE_LABEL: Record<UserRole, string> = {
  customer: "Customer",
  operator: "Bus operator",
  admin: "Administrator",
};

const AREA_ROLES: { prefix: string; role: UserRole }[] = [
  { prefix: "/admin", role: "admin" },
  { prefix: "/operator", role: "operator" },
  { prefix: "/account", role: "customer" },
];

function isWithin(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * Where to send a user after signing in. Only same-site relative paths are honoured (no
 * open redirects), and only if the user's role may actually open them.
 */
export function postLoginPath(role: UserRole, next?: string | null): string {
  const fallback = ROLE_HOME[role];
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return fallback;
  }
  const area = AREA_ROLES.find(({ prefix }) => isWithin(next, prefix));
  if (area && area.role !== role) return fallback;
  if (next === "/login" || next === "/register") return fallback;
  return next;
}
