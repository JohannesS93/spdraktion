export function getPostLoginRoute(role?: string | null): string {
  if (!role) return "/backend";
  if (role !== "admin") return "/admin/informationen";
  return "/backend";
}
