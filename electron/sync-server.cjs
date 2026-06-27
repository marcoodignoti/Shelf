const https = require("node:https");
const { ensureSyncCert } = require("./sync-certs.cjs");
const { pickPort } = require("./sync-network.cjs");
const { SYNC_RATE_LIMIT_MAX_PER_MINUTE } = require("./backend-helpers.cjs");

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (!raw) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

// Per-key sliding-window rate limiter. Keyed by the auth token (or "anon" for
// unauthenticated requests) so a single misbehaving paired device can be
// throttled without affecting others.
function createRateLimiter(maxPerMinute) {
  const buckets = new Map(); // key -> { count, windowStart }
  function hit(key) {
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || now - b.windowStart > 60_000) {
      b = { count: 0, windowStart: now };
      buckets.set(key, b);
    }
    b.count += 1;
    return b.count <= maxPerMinute;
  }
  return { hit };
}

// HTTPS server bound to the chosen port. Delegates all routing to the resolver
// and applies per-token rate limiting. The cert is generated on first start
// and reloaded on subsequent starts (see sync-certs.cjs).
function createSyncServer({ configDir, resolver, portRange }) {
  let server = null;
  let port = null;
  const limiter = createRateLimiter(SYNC_RATE_LIMIT_MAX_PER_MINUTE);

  async function start() {
    if (server) return { port };
    const { cert, key } = await ensureSyncCert(configDir);
    port = await pickPort(portRange);
    server = https.createServer({ cert, key }, async (req, res) => {
      try {
        const auth = req.headers.authorization || "";
        const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : null;
        const rateKey = token || "anon";
        if (!limiter.hit(rateKey)) {
          res.writeHead(429, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "rate limit" }));
          return;
        }
        const body = await readBody(req);
        const result = await resolver.resolve({
          method: req.method,
          path: req.url,
          headers: req.headers,
          body,
          authToken: token,
        });
        res.writeHead(result.status, {
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        });
        res.end(result.body === null || result.body === undefined ? "" : JSON.stringify(result.body));
      } catch (err) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: String(err.message || err) }));
      }
    });
    await new Promise((resolve) => server.listen(port, "0.0.0.0", resolve));
    return { port };
  }

  async function stop() {
    if (!server) return;
    await new Promise((resolve) => server.close(resolve));
    server = null;
    port = null;
  }

  return {
    start,
    stop,
    get port() {
      return port;
    },
  };
}

module.exports = { createSyncServer };
