import fs from "fs";
import path from "path";

export function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
  };
  return map[ext] || "application/octet-stream";
}

export function resolveStaticFile(publicDir, pathname) {
  const normalized = pathname === "/" ? "/index.html" : pathname;
  const decoded = decodeURIComponent(normalized);
  const safePath = path.normalize(decoded).replace(/^([.][.][/\\])+/, "");

  const candidates = [];
  const exact = path.join(publicDir, safePath);
  candidates.push(exact);

  if (!path.extname(safePath)) {
    candidates.push(path.join(publicDir, `${safePath}.html`));
    candidates.push(path.join(publicDir, safePath, "index.html"));
  }

  for (const candidate of candidates) {
    if (!candidate.startsWith(publicDir)) continue;
    if (!fs.existsSync(candidate)) continue;

    const stat = fs.statSync(candidate);
    if (stat.isDirectory()) {
      const indexFile = path.join(candidate, "index.html");
      if (fs.existsSync(indexFile)) return indexFile;
      continue;
    }

    return candidate;
  }

  return null;
}
