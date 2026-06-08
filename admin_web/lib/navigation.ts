export function getPostLoginRoute(role?: string | null): string {
  if (!role) return "/backend";
  return "/backend";
}
