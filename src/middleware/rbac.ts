import { Request, Response, NextFunction } from 'express';
import { pool } from '../config/database';

// Extend Request interface to include user role information
declare global {
  namespace Express {
    interface Request {
      userRole?: string;
      userPermissions?: string[];
    }
  }
}

export interface RBACRequest extends Request {
  user?: {
    id: string;
    role: string;
    permissions: string[];
  };
}

/**
 * Get user permissions from database based on their role
 */
async function getUserPermissions(roleId: string): Promise<string[]> {
  const query = `
    SELECT p.name as permission_name
    FROM permissions p
    JOIN role_permissions rp ON p.id = rp.permission_id
    WHERE rp.role_id = $1
  `;
  
  const result = await pool.query(query, [roleId]);
  return result.rows.map(row => row.permission_name);
}

/**
 * Get user role information from database
 */
async function getUserRole(userId: string): Promise<{ role_name: string; role_id: string } | null> {
  const query = `
    SELECT r.name as role_name, r.id as role_id
    FROM users u
    JOIN roles r ON u.role_id = r.id
    WHERE u.id = $1
  `;
  
  const result = await pool.query(query, [userId]);
  return result.rows.length > 0 ? result.rows[0] : null;
}

/**
 * Middleware to check if user has specific permission
 */
export function requirePermission(permission: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Check if user is authenticated (JWT middleware should have set jwtUser)
      if (!req.jwtUser) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Authentication required'
        });
      }

      // Get user role information
      const userRole = await getUserRole(req.jwtUser.userId);
      if (!userRole) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'User role not found'
        });
      }

      // Get user permissions
      const permissions = await getUserPermissions(userRole.role_id);
      
      // Attach role and permissions to request for downstream use
      req.userRole = userRole.role_name;
      req.userPermissions = permissions;

      // Check if user has the required permission
      if (!permissions.includes(permission)) {
        return res.status(403).json({
          error: 'Forbidden',
          message: `Insufficient permissions. Required: ${permission}`,
          userRole: userRole.role_name,
          userPermissions: permissions
        });
      }

      next();
    } catch (error) {
      console.error('RBAC permission check error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to check permissions'
      });
    }
  };
}

/**
 * Middleware to check if user has any of the specified permissions
 */
export function requireAnyPermission(permissions: string[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.jwtUser) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Authentication required'
        });
      }

      const userRole = await getUserRole(req.jwtUser.userId);
      if (!userRole) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'User role not found'
        });
      }

      const userPermissions = await getUserPermissions(userRole.role_id);
      
      req.userRole = userRole.role_name;
      req.userPermissions = userPermissions;

      // Check if user has any of the required permissions
      const hasPermission = permissions.some(permission => 
        userPermissions.includes(permission)
      );

      if (!hasPermission) {
        return res.status(403).json({
          error: 'Forbidden',
          message: `Insufficient permissions. Required any of: ${permissions.join(', ')}`,
          userRole: userRole.role_name,
          userPermissions: userPermissions
        });
      }

      next();
    } catch (error) {
      console.error('RBAC permission check error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to check permissions'
      });
    }
  };
}

/**
 * Middleware to check if user has specific role
 */
export function requireRole(role: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.jwtUser) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Authentication required'
        });
      }

      const userRole = await getUserRole(req.jwtUser.userId);
      if (!userRole) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'User role not found'
        });
      }

      req.userRole = userRole.role_name;
      req.userPermissions = await getUserPermissions(userRole.role_id);

      if (userRole.role_name !== role) {
        return res.status(403).json({
          error: 'Forbidden',
          message: `Insufficient role. Required: ${role}, Current: ${userRole.role_name}`
        });
      }

      next();
    } catch (error) {
      console.error('RBAC role check error:', error);
      return res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to check role'
      });
    }
  };
}

/**
 * Middleware to check if user can access their own data
 * This checks for 'read:own' or 'write:own' permissions based on the action
 */
export function requireOwnDataAccess(action: 'read' | 'write' | 'delete') {
  const permission = `${action}:own`;
  return requirePermission(permission);
}

/**
 * Middleware to check if user has admin-level access
 */
export const requireAdmin = requireRole('admin');

/**
 * Middleware to check if user can read data (own or all)
 */
export const requireReadAccess = requireAnyPermission(['read:own', 'read:all']);

/**
 * Middleware to check if user can write data (own or all)
 */
export const requireWriteAccess = requireAnyPermission(['write:own', 'write:all']);

/**
 * Middleware to attach role and permissions to request without checking access
 * Useful for endpoints that need user context but don't require specific permissions
 */
export async function attachUserContext(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.jwtUser) {
      return next();
    }

    const userRole = await getUserRole(req.jwtUser.userId);
    if (userRole) {
      req.userRole = userRole.role_name;
      req.userPermissions = await getUserPermissions(userRole.role_id);
    }

    next();
  } catch (error) {
    console.error('Failed to attach user context:', error);
    // Don't block the request, just continue without context
    next();
  }
}
