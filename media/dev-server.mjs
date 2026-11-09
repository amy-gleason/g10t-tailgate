import http from "node:http";
import { Miniflare } from "miniflare";

// Local emulation only. These values are not production secrets and are not
// deployed. Production stays off until R2, the Worker, and secrets are approved.
const mf = new Miniflare({
  modules: true,
  scriptPath: new URL("./src/index.js", import.meta.url).pathname,
  modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
  r2Buckets: ["MEDIA"],
  compatibilityDate: "2026-03-01",
  bindings: {
    GUEST_PIN_LSU: "local-test-pin",
    GUEST_PIN_KENTUCKY: "local-test-pin",
    OWNER_TOKEN: "local-owner-token",
    UPLOADS_ENABLED: "true",
    POSTS_ENABLED: "true",
  },
});

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  const response = await mf.dispatchFetch(`http://127.0.0.1:8787${req.url}`, {
    method: req.method,
    headers,
    body: body.length ? body : undefined,
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(bytes);
});

server.listen(8787, "127.0.0.1", () => {
  console.log("media emulation http://127.0.0.1:8787");
});
