import { Request, Response, NextFunction } from "express";
import { verifyOAuthAccessToken } from "../auth/oauth";
import { verifyToken, JWTPayload } from "../auth/jwt";

export interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
    clientId?: string;
    scopes?: string[];
  };
}

// Extend Request interface to include JWT user information
declare global {
  namespace Express {
    interface Request {
      jwtUser?: JWTPayload;
    }
  }
}

/**
 * Middleware to require a valid administrative API key or token.
 * For this implementation, we check for an X-API-Key header.
 */
export const requireAuth = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const apiKey = req.header("X-API-Key");
  const adminKey = process.env.ADMIN_API_KEY || "dev-admin-key";

  if (apiKey && apiKey === adminKey) {
    (req as AuthRequest).user = {
      id: "admin-system",
      role: "admin",
    };

    return next();
  }

  const authorization = req.header("Authorization");
  const bearerToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];

  if (bearerToken) {
    try {
      const claims = verifyOAuthAccessToken(bearerToken);
      (req as AuthRequest).user = {
        id: claims.sub,
        role: claims.role,
        clientId: claims.client_id,
        scopes: claims.scope.split(/\s+/).filter(Boolean),
      };

      return next();
    } catch {
      return res.status(401).json({
        error: "Unauthorized",
        message: "Invalid or expired bearer token",
      });
    }
  }

  return res.status(401).json({
    error: "Unauthorized",
    message: "Valid administrative API key or OAuth bearer token required",
  });
};

/**
 * JWT Authentication middleware that verifies JWT tokens
 * and attaches user information to the request object
 */
export function authenticateToken(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    res.status(401).json({
      error: 'Access denied',
      message: 'No token provided',
    });
    return;
  }

  try {
    const decoded = verifyToken(token);
    req.jwtUser = decoded;
    next();
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'Token has expired') {
        res.status(401).json({
          error: 'Token expired',
          message: 'Please log in again',
        });
      } else if (error.message === 'Invalid token') {
        res.status(401).json({
          error: 'Invalid token',
          message: 'Token is malformed or tampered with',
        });
      } else {
        res.status(401).json({
          error: 'Authentication failed',
          message: error.message,
        });
      }
    } else {
      res.status(401).json({
        error: 'Authentication failed',
        message: 'Unknown error occurred',
      });
    }
  }
}

/**
 * Optional JWT authentication middleware that attaches user information
 * if a valid token is present, but doesn't block requests without tokens
 */
export function optionalAuthentication(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    next();
    return;
  }

  try {
    const decoded = verifyToken(token);
    req.jwtUser = decoded;
  } catch (error) {
    // Silently ignore token errors for optional authentication
    // The request can proceed without user information
  }

  next();
}
