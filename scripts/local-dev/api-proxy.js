import { readRawBody } from "./http-helpers.js";

function getForwardHeaders(req, bodyBuffer) {
  const headers = { ...req.headers };

  delete headers.host;
  delete headers.connection;
  delete headers.origin;
  delete headers.referer;
  delete headers.expect;

  if (bodyBuffer && bodyBuffer.length > 0) {
    headers["content-length"] = String(bodyBuffer.length);
  } else {
    delete headers["content-length"];
  }

  return headers;
}

export async function proxyApiRequest(
  req,
  res,
  targetBaseUrl,
  pathname,
  search,
) {
  const method = req.method || "GET";
  const targetUrl = `${targetBaseUrl}${pathname}${search}`;
  const hasBody = !["GET", "HEAD"].includes(method);
  const bodyBuffer = hasBody ? await readRawBody(req) : null;

  const upstreamRes = await fetch(targetUrl, {
    method,
    headers: getForwardHeaders(req, bodyBuffer),
    body: hasBody ? bodyBuffer : undefined,
    redirect: "manual",
  });

  const responseBuffer = Buffer.from(await upstreamRes.arrayBuffer());

  console.log(`[PROXY] ${method} ${pathname} → ${upstreamRes.status} (${responseBuffer.length}b)`);
  if (upstreamRes.status >= 400) {
    console.log(`        body: ${responseBuffer.toString('utf8').slice(0, 200)}`);
  }

  res.statusCode = upstreamRes.status;

  for (const [key, value] of upstreamRes.headers.entries()) {
    if (key.toLowerCase() === "transfer-encoding") continue;
    res.setHeader(key, value);
  }

  res.end(responseBuffer);
}
