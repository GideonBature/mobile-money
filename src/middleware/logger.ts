import { Request, Response, NextFunction } from "express";

/**
 * Request pathname without query string (avoids logging ?api_key=…, ?token=…, etc.).
 */
function loggedPath(req: Request): string {
  const raw = req.originalUrl ?? req.url ?? "/";
  const q = raw.indexOf("?");
  return (q >= 0 ? raw.slice(0, q) : raw) || "/";
}

/**
 * Logs each completed HTTP request. Uses pathname only (no query string),
 * and does not log headers or body, so API keys, tokens, and secrets in
 * URLs or payloads are not written to logs.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();
  let logged = false;

  const writeLog = (): void => {
    if (logged) return;
    logged = true;

    const durationNs = process.hrtime.bigint() - start;
    const responseTimeMs = Number(durationNs) / 1e6;

    const line = {
      timestamp: new Date().toISOString(),
      method: req.method,
      path: loggedPath(req),
      statusCode: res.statusCode,
      responseTimeMs: Math.round(responseTimeMs * 1000) / 1000,
    };

    console.log(JSON.stringify(line));
  };

  res.on("finish", writeLog);
  res.on("close", writeLog);

  next();
}
