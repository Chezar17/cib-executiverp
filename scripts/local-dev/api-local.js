import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";
import { readJsonBody, toQueryObject } from "./http-helpers.js";

export async function runApiHandler(req, res, pathname, searchParams, apiDir) {
  let endpoint = pathname.replace(/^\/api\//, "");
  // Legacy finance paths → single api/finance.js (Hobby: max 12 serverless functions)
  const financeLegacy = {
    "finance-balance": "balance",
    "finance-cards": "cards",
    "finance-expenses": "expenses",
    "finance-income": "income"
  }
  if (financeLegacy[endpoint]) {
    const merged = new URLSearchParams(searchParams);
    merged.set("__f", financeLegacy[endpoint]);
    searchParams = merged;
    endpoint = "finance"
  }
  const filePath = path.join(apiDir, `${endpoint}.js`);

  if (!filePath.startsWith(apiDir) || !fs.existsSync(filePath)) {
    return res.status(404).json({ error: "Not found" });
  }

  req.query = toQueryObject(searchParams);
  req.body =
    req.method === "GET" || req.method === "HEAD"
      ? {}
      : await readJsonBody(req);

  const moduleUrl = `${pathToFileURL(filePath).href}?v=${Date.now()}`;
  const mod = await import(moduleUrl);
  const handler = mod.default;

  if (typeof handler !== "function") {
    return res.status(500).json({ error: "Invalid API handler" });
  }

  await handler(req, res);
}
