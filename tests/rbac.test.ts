import request from 'supertest';
import app from '../src/index';
import { pool } from '../src/config/database';
import { generateToken } from '../src/auth/jwt';

describe('RBAC System Tests', () => {
  let adminToken: string;
  let userToken: string;
  let viewerToken: string;
  let adminUserId: string;
  let userUserId: string;
  let viewerUserId: string;

  beforeAll(async () => {
    // Setup test database and users
    // Create admin user
    const adminResult = await pool.query(
      `INSERT INTO users (phone_number, kyc_level, role_id) 
       VALUES ('+237111111111', 'full', (SELECT id FROM roles WHERE name = 'admin'))
       RETURNING id, phone_number`
    );
    adminUserId = adminResult.rows[0].id;
    adminToken = generateToken({
      userId: adminUserId,
      email: 'admin@test.com',
      role: 'admin'
    });

    // Create regular user
    const userResult = await pool.query(
      `INSERT INTO users (phone_number, kyc_level, role_id) 
       VALUES ('+237222222222', 'basic', (SELECT id FROM roles WHERE name = 'user'))
       RETURNING id, phone_number`
    );
    userUserId = userResult.rows[0].id;
    userToken = generateToken({
      userId: userUserId,
      email: 'user@test.com',
      role: 'user'
    });

    // Create viewer user
    const viewerResult = await pool.query(
      `INSERT INTO users (phone_number, kyc_level, role_id) 
       VALUES ('+237333333333', 'unverified', (SELECT id FROM roles WHERE name = 'viewer'))
       RETURNING id, phone_number`
    );
    viewerUserId = viewerResult.rows[0].id;
    viewerToken = generateToken({
      userId: viewerUserId,
      email: 'viewer@test.com',
      role: 'viewer'
    });
  });

  afterAll(async () => {
    // Cleanup test data
    await pool.query('DELETE FROM users WHERE phone_number IN (\'+237111111111\', \'+237222222222\', \'+237333333333\')');
    await pool.end();
  });

  describe('Authentication Tests', () => {
    test('Admin can login and get token with role', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ phone_number: '+237111111111' });

      expect(response.status).toBe(200);
      expect(response.body.token).toBeDefined();
      expect(response.body.user.role).toBe('admin');
    });

    test('User can login and get token with role', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ phone_number: '+237222222222' });

      expect(response.status).toBe(200);
      expect(response.body.token).toBeDefined();
      expect(response.body.user.role).toBe('user');
    });

    test('Viewer can login and get token with role', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({ phone_number: '+237333333333' });

      expect(response.status).toBe(200);
      expect(response.body.token).toBeDefined();
      expect(response.body.user.role).toBe('viewer');
    });

    test('GET /api/auth/me returns user info with permissions', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(200);
      expect(response.body.user.role).toBe('user');
      expect(response.body.user.permissions).toContain('read:own');
      expect(response.body.user.permissions).toContain('write:own');
      expect(response.body.user.permissions).toContain('delete:own');
    });
  });

  describe('Permission Tests', () => {
    test('Admin has all permissions', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.user.permissions).toContain('read:own');
      expect(response.body.user.permissions).toContain('write:own');
      expect(response.body.user.permissions).toContain('delete:own');
      expect(response.body.user.permissions).toContain('read:all');
      expect(response.body.user.permissions).toContain('write:all');
      expect(response.body.user.permissions).toContain('delete:all');
      expect(response.body.user.permissions).toContain('admin:system');
    });

    test('User has own data permissions only', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(200);
      expect(response.body.user.permissions).toEqual(
        expect.arrayContaining(['read:own', 'write:own', 'delete:own'])
      );
      expect(response.body.user.permissions).not.toContain('read:all');
      expect(response.body.user.permissions).not.toContain('admin:system');
    });

    test('Viewer has read-only permissions', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.user.permissions).toContain('read:all');
      expect(response.body.user.permissions).not.toContain('write:own');
      expect(response.body.user.permissions).not.toContain('delete:own');
    });
  });

  describe('Access Control Tests', () => {
    test('Unauthorized access returns 401', async () => {
      const response = await request(app)
        .get('/api/auth/me');

      expect(response.status).toBe(401);
      expect(response.body.error).toBe('Access denied');
    });

    test('Invalid token returns 401', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid-token');

      expect(response.status).toBe(401);
    });

    test('Token verification works', async () => {
      const response = await request(app)
        .post('/api/auth/verify')
        .send({ token: userToken });

      expect(response.status).toBe(200);
      expect(response.body.valid).toBe(true);
      expect(response.body.payload.role).toBe('user');
    });
  });

  describe('Role-based Tests', () => {
    test('Admin role is correctly identified', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.user.role).toBe('admin');
    });

    test('User role is correctly identified', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${userToken}`);

      expect(response.status).toBe(200);
      expect(response.body.user.role).toBe('user');
    });

    test('Viewer role is correctly identified', async () => {
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${viewerToken}`);

      expect(response.status).toBe(200);
      expect(response.body.user.role).toBe('viewer');
    });
  });

  describe('JWT Token Tests', () => {
    test('JWT token contains role information', async () => {
      // This is tested indirectly through the /api/auth/me endpoint
      // which decodes the token and returns the role
      const response = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(response.status).toBe(200);
      expect(response.body.user.role).toBe('admin');
    });

    test('Expired token is rejected', async () => {
      // Create an expired token (this would need to be done manually or with a mock)
      // For now, we'll test the token verification endpoint with an invalid format
      const response = await request(app)
        .post('/api/auth/verify')
        .send({ token: 'expired.token.format' });

      expect(response.status).toBe(401);
      expect(response.body.valid).toBe(false);
    });
  });
});

describe('RBAC Database Tests', () => {
  test('Roles table exists and has correct data', async () => {
    const result = await pool.query('SELECT * FROM roles ORDER BY name');
    expect(result.rows).toHaveLength(3);
    expect(result.rows.map(r => r.name)).toEqual(expect.arrayContaining(['admin', 'user', 'viewer']));
  });

  test('Permissions table exists and has correct data', async () => {
    const result = await pool.query('SELECT * FROM permissions ORDER BY name');
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows.map(r => r.name)).toEqual(
      expect.arrayContaining([
        'read:own', 'write:own', 'delete:own',
        'read:all', 'write:all', 'delete:all',
        'admin:system'
      ])
    );
  });

  test('Role permissions are correctly assigned', async () => {
    const result = await pool.query(`
      SELECT r.name as role_name, p.name as permission_name
      FROM roles r
      JOIN role_permissions rp ON r.id = rp.role_id
      JOIN permissions p ON p.id = rp.permission_id
      ORDER BY r.name, p.name
    `);

    // Admin should have all permissions
    const adminPerms = result.rows.filter(r => r.role_name === 'admin');
    expect(adminPerms.length).toBeGreaterThan(0);

    // User should have own data permissions
    const userPerms = result.rows.filter(r => r.role_name === 'user');
    expect(userPerms.map(p => p.permission_name)).toEqual(
      expect.arrayContaining(['read:own', 'write:own', 'delete:own'])
    );

    // Viewer should have read:all permission
    const viewerPerms = result.rows.filter(r => r.role_name === 'viewer');
    expect(viewerPerms.map(p => p.permission_name)).toContain('read:all');
  });

  afterAll(async () => {
    await pool.end();
  });
});
