export function resolveRoute(pathname) {
  if (pathname.startsWith("/api/")) {
    return { kind: "api" };
  }

  return { kind: "static" };
}
