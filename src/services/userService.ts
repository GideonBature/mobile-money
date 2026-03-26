import { pool } from '../config/database';

export interface User {
  id: string;
  phone_number: string;
  kyc_level: string;
  role_id?: string;
  role_name?: string;
  created_at: Date;
  updated_at: Date;
}

export interface CreateUserRequest {
  phone_number: string;
  kyc_level?: string;
  role_name?: string;
}

export interface LoginRequest {
  phone_number: string;
  // In a real app, you would have password or other auth method
}

/**
 * Get user by phone number with role information
 */
export async function getUserByPhoneNumber(phoneNumber: string): Promise<User | null> {
  const query = `
    SELECT 
      u.id,
      u.phone_number,
      u.kyc_level,
      u.role_id,
      u.created_at,
      u.updated_at,
      r.name as role_name
    FROM users u
    LEFT JOIN roles r ON u.role_id = r.id
    WHERE u.phone_number = $1
  `;
  
  const result = await pool.query(query, [phoneNumber]);
  return result.rows.length > 0 ? result.rows[0] : null;
}

/**
 * Get user by ID with role information
 */
export async function getUserById(userId: string): Promise<User | null> {
  const query = `
    SELECT 
      u.id,
      u.phone_number,
      u.kyc_level,
      u.role_id,
      u.created_at,
      u.updated_at,
      r.name as role_name
    FROM users u
    LEFT JOIN roles r ON u.role_id = r.id
    WHERE u.id = $1
  `;
  
  const result = await pool.query(query, [userId]);
  return result.rows.length > 0 ? result.rows[0] : null;
}

/**
 * Create a new user with optional role
 */
export async function createUser(userData: CreateUserRequest): Promise<User> {
  const { phone_number, kyc_level = 'unverified', role_name = 'user' } = userData;
  
  // Get role ID
  const roleQuery = 'SELECT id FROM roles WHERE name = $1';
  const roleResult = await pool.query(roleQuery, [role_name]);
  
  if (roleResult.rows.length === 0) {
    throw new Error(`Role '${role_name}' not found`);
  }
  
  const roleId = roleResult.rows[0].id;
  
  const query = `
    INSERT INTO users (phone_number, kyc_level, role_id)
    VALUES ($1, $2, $3)
    RETURNING id, phone_number, kyc_level, role_id, created_at, updated_at
  `;
  
  const result = await pool.query(query, [phone_number, kyc_level, roleId]);
  const user = result.rows[0];
  
  // Get role name
  user.role_name = role_name;
  
  return user;
}

/**
 * Update user role
 */
export async function updateUserRole(userId: string, roleName: string): Promise<User> {
  // Get role ID
  const roleQuery = 'SELECT id FROM roles WHERE name = $1';
  const roleResult = await pool.query(roleQuery, [roleName]);
  
  if (roleResult.rows.length === 0) {
    throw new Error(`Role '${roleName}' not found`);
  }
  
  const roleId = roleResult.rows[0].id;
  
  const query = `
    UPDATE users 
    SET role_id = $1, updated_at = CURRENT_TIMESTAMP
    WHERE id = $2
    RETURNING id, phone_number, kyc_level, role_id, created_at, updated_at
  `;
  
  const result = await pool.query(query, [roleId, userId]);
  
  if (result.rows.length === 0) {
    throw new Error('User not found');
  }
  
  const user = result.rows[0];
  user.role_name = roleName;
  
  return user;
}

/**
 * Authenticate user (simplified for demo)
 * In a real app, you would verify phone number via OTP, password, etc.
 */
export async function authenticateUser(phoneNumber: string): Promise<User | null> {
  const user = await getUserByPhoneNumber(phoneNumber);
  
  if (!user) {
    // Auto-create user for demo (in production, require proper registration)
    try {
      return await createUser({ phone_number: phoneNumber });
    } catch (error) {
      console.error('Failed to create user:', error);
      return null;
    }
  }
  
  return user;
}

/**
 * Get all users with their roles (admin function)
 */
export async function getAllUsers(): Promise<User[]> {
  const query = `
    SELECT 
      u.id,
      u.phone_number,
      u.kyc_level,
      u.role_id,
      u.created_at,
      u.updated_at,
      r.name as role_name
    FROM users u
    LEFT JOIN roles r ON u.role_id = r.id
    ORDER BY u.created_at DESC
  `;
  
  const result = await pool.query(query);
  return result.rows;
}

/**
 * Get user permissions
 */
export async function getUserPermissions(userId: string): Promise<string[]> {
  const query = `
    SELECT p.name as permission_name
    FROM permissions p
    JOIN role_permissions rp ON p.id = rp.permission_id
    JOIN users u ON u.role_id = rp.role_id
    WHERE u.id = $1
  `;
  
  const result = await pool.query(query, [userId]);
  return result.rows.map(row => row.permission_name);
}
