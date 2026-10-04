/**
 * Fixed-window in-memory rate limiter keyed by client IP.
 * The map is pruned on every call, so memory stays bounded by active clients.
 */
export function createRateLimiter({ windowMs, max, now = () => Date.now() }) {
  const hits = new Map();

  function prune(t) {
    for (const [key, entry] of hits) {
      if (entry.resetAt <= t) hits.delete(key);
    }
  }

  function check(key) {
    const t = now();
    prune(t);
    let entry = hits.get(key);
    if (!entry) {
      entry = { count: 0, resetAt: t + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    return {
      allowed: entry.count <= max,
      retryAfterSeconds: Math.ceil((entry.resetAt - t) / 1000),
    };
  }

  function middleware(req, res, next) {
    const { allowed, retryAfterSeconds } = check(req.ip);
    if (allowed) return next();
    res.set("Retry-After", String(retryAfterSeconds));
    return res.status(429).json({ error: "Too many requests. Try again later." });
  }

  return { check, middleware, size: () => hits.size };
}
