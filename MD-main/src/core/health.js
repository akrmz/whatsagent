"use strict";

const http = require("node:http");

/**
 * GET /healthz → 200 when connected to WhatsApp, 503 otherwise, with a small JSON body.
 * Listens on HEALTH_HOST:HEALTH_PORT (127.0.0.1:3000 by default; port 0 disables it).
 */
function startHealthServer(app) {
  const { port, host } = app.config.health;
  if (!port) return null;
  const server = http.createServer((req, res) => {
    if (req.method !== "GET" || req.url !== "/healthz") {
      res.writeHead(404, { "content-type": "application/json" });
      return res.end('{"error":"not found"}');
    }
    const h = app.health;
    const body = {
      status: h.state === "open" ? "ok" : "degraded",
      whatsapp: h.state,
      uptimeSeconds: Math.round((Date.now() - h.startedAt) / 1000),
      lastMessageAt: h.lastMessageAt ? new Date(h.lastMessageAt).toISOString() : null,
      commands: app.commands?.list.length ?? 0,
    };
    res.writeHead(h.state === "open" ? 200 : 503, { "content-type": "application/json", "cache-control": "no-store" });
    return res.end(JSON.stringify(body));
  });
  server.on("error", (err) => app.log.error({ err: err.message }, "health server failed"));
  server.listen(port, host, () => app.log.info({ host, port }, "health endpoint listening on /healthz"));
  return server;
}

module.exports = { startHealthServer };
