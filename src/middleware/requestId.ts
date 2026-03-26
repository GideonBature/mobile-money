import { randomUUID } from "crypto";
import { Request, Response, NextFunction } from "express";

export const requestId = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const request = req as Request & { id: string };
  request.id = (req.headers["x-request-id"] as string) || randomUUID();
  res.setHeader("X-Request-ID", request.id);
  next();
};
