import fs from "fs";
import path from "path";
import http from "http";
import { fileURLToPath } from "url";
import { loadEnvFile } from "./local-dev/env.js";
import { enhanceResponse } from "./local-dev/http-helpers.js";
import { getMimeType, resolveStaticFile } from "./local-dev/static-files.js";
import { runApiHandler } from "./local-dev/api-local.js";
import { proxyApiRequest } from "./local-dev/api-proxy.js";
import { resolveRoute } from "./local-dev/routes.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const API_DIR = path.join(ROOT_DIR, "api");

loadEnvFile(path.join(ROOT_DIR, ".env.local"));

const PORT = Number(process.env.PORT || 3000);
const DEPLOYED_API_BASE_URL = (process.env.DEPLOYED_API_BASE_URL || "").replace(
  /\/+$/,
  "",
);

const server = http.createServer(async (req, res) => {
  enhanceResponse(res);

  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const route = resolveRoute(url.pathname);

    if (route.kind === "api") {
      if (DEPLOYED_API_BASE_URL) {
        await proxyApiRequest(
          req,
          res,
          DEPLOYED_API_BASE_URL,
          url.pathname,
          url.search,
        );
        return;
      }

      await runApiHandler(req, res, url.pathname, url.searchParams, API_DIR);
      return;
    }

    const lookupPath = route.mappedFile ? `/${route.mappedFile}` : url.pathname;
    const filePath = resolveStaticFile(PUBLIC_DIR, lookupPath);
    if (!filePath) {
      res.statusCode = 404;
      res.end("Not found");
      return;
    }

    res.setHeader("Content-Type", getMimeType(filePath));
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    console.error("Local server error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    } else {
      res.end();
    }
  }
});

server.listen(PORT, () => {
  console.log("Local dev server running");
  console.log(`- URL: http://localhost:${PORT}`);
  if (DEPLOYED_API_BASE_URL) {
    console.log(
      `- Mode: static public + proxied api (${DEPLOYED_API_BASE_URL})`,
    );
  } else {
    console.log("- Mode: static public + local api handlers");
  }
});
