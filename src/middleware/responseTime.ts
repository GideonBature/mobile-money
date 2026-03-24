import { Request, Response, NextFunction } from 'express';

export const responseTime = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const start = Date.now();

  const originalSend = res.send;

  res.send = function (body) {
    const duration = Date.now() - start;
    res.setHeader('X-Response-Time', `${duration}ms`);
    return originalSend.call(this, body);
  };

  next();
};