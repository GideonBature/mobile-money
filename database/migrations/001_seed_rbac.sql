-- Seed default roles and permissions for RBAC system

-- Insert default roles
INSERT INTO roles (name, description) VALUES 
('admin', 'Full access to all system resources'),
('user', 'Read/write access to own data'),
('viewer', 'Read-only access to public data')
ON CONFLICT (name) DO NOTHING;

-- Insert default permissions
INSERT INTO permissions (name, description) VALUES
('read:own', 'Read own data'),
('write:own', 'Write/update own data'),
('delete:own', 'Delete own data'),
('read:all', 'Read all data'),
('write:all', 'Write/update all data'),
('delete:all', 'Delete all data'),
('admin:system', 'Full system administration')
ON CONFLICT (name) DO NOTHING;

-- Assign permissions to roles

-- Admin role gets all permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'admin'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- User role gets read/write/delete own data permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'user' AND p.name IN ('read:own', 'write:own', 'delete:own')
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Viewer role gets read:all permission (can read public data)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'viewer' AND p.name = 'read:all'
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Set default role for existing users (if they don't have a role)
UPDATE users 
SET role_id = (SELECT id FROM roles WHERE name = 'user')
WHERE role_id IS NULL;
