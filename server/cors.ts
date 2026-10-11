import type { RequestHandler } from "express";
export function corsPolicy(origins: string[]): RequestHandler {
  const allowed = new Set(origins);
  return (req, res, next) => {
    const origin = req.headers.origin;
    res.vary("Origin");
    if (origin) {
      if (!allowed.has(origin)) {
        res.status(403).json({ error: "Origin is not allowed" });
        return;
      }
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type",
      );
      res.setHeader("Access-Control-Max-Age", "600");
    }
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  };
}
