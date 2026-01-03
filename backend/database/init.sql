
-- RapidTool-Fixture Database Schema (PostgreSQL)
-- Generated for production-ready architecture aligned with PRD
-- ===== EXTENSIONS =====
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ===== ENUMS =====
CREATE TYPE user_role AS ENUM ('user', 'team_member', 'team_lead', 'admin', 'super_admin');
CREATE TYPE user_status AS ENUM ('active', 'inactive', 'suspended');
CREATE TYPE organization_plan AS ENUM ('free', 'pro', 'enterprise');
CREATE TYPE subscription_status AS ENUM ('active', 'trial', 'expired');
CREATE TYPE project_status AS ENUM ('draft', 'in_progress', 'completed', 'archived');
CREATE TYPE file_format AS ENUM ('stl', 'step', '3mf');
CREATE TYPE upload_status AS ENUM ('uploaded', 'processing', 'ready', 'failed');
CREATE TYPE export_format AS ENUM ('stl', '3mf', 'pdf', 'part_list');
CREATE TYPE audit_action AS ENUM (
  'create_project', 'update_project', 'delete_project',
  'upload_model', 'process_model',
  'create_design', 'update_design', 'export_design',
  'share_project', 'user_login', 'user_register',
  'admin_action'
);
CREATE TYPE audit_resource AS ENUM ('project', 'model', 'export', 'user', 'organization');
CREATE TYPE audit_status AS ENUM ('success', 'failure');
CREATE TYPE component_category AS ENUM ('clamp', 'support', 'baseplate', 'feature');
CREATE TYPE notification_type AS ENUM ('processing_complete', 'export_ready', 'share_received', 'system');

-- ===== TABLES =====

-- Organizations
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(255) UNIQUE NOT NULL,
  owner_id UUID NOT NULL, -- Will be FK after users table
  plan organization_plan NOT NULL DEFAULT 'free',
  max_projects INT NOT NULL DEFAULT 10,
  max_storage_gb INT NOT NULL DEFAULT 5,
  subscription_status subscription_status NOT NULL DEFAULT 'trial',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  role user_role NOT NULL DEFAULT 'user',
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  status user_status NOT NULL DEFAULT 'active',
  mfa_enabled BOOLEAN DEFAULT FALSE,
  mfa_secret VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login TIMESTAMP,
  avatar_url VARCHAR(512),
  metadata JSONB DEFAULT '{}'::jsonb,
  CONSTRAINT email_check CHECK (email ~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$')
);

-- Add FK for organization owner
ALTER TABLE organizations ADD CONSTRAINT fk_org_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE RESTRICT;

-- Organization Members (for team management)
CREATE TABLE organization_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role user_role NOT NULL DEFAULT 'team_member',
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(organization_id, user_id)
);

-- Sessions (for token invalidation & management)
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_hash VARCHAR(255) NOT NULL UNIQUE,
  ip_address INET,
  user_agent TEXT,
  expires_at TIMESTAMP NOT NULL,
  revoked_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Projects (Fixture designs)
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  status project_status NOT NULL DEFAULT 'draft',
  thumbnail_url VARCHAR(512),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Project Sharing (collaboration)
CREATE TABLE project_shares (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  shared_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  shared_with_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  can_edit BOOLEAN DEFAULT FALSE,
  can_export BOOLEAN DEFAULT TRUE,
  shared_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, shared_with_user_id)
);

-- Model Uploads (Input 3D files)
CREATE TABLE model_uploads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  original_filename VARCHAR(255) NOT NULL,
  file_format file_format NOT NULL,
  file_size_bytes INT NOT NULL,
  s3_path VARCHAR(512) NOT NULL,
  original_triangle_count INT,
  optimized_triangle_count INT,
  status upload_status NOT NULL DEFAULT 'uploaded',
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP,
  metadata JSONB DEFAULT '{}'::jsonb -- bounding box, scale, etc.
);

-- Design Versions (versioning & rollback)
CREATE TABLE design_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version_number INT NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  description VARCHAR(500),
  is_current BOOLEAN DEFAULT FALSE,
  backup_data JSONB NOT NULL, -- full fixture state for rollback
  UNIQUE(project_id, version_number)
);

-- Fixture Configurations (design state)
CREATE TABLE fixture_configurations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  design_version_id UUID NOT NULL REFERENCES design_versions(id) ON DELETE CASCADE,
  model_upload_id UUID NOT NULL REFERENCES model_uploads(id) ON DELETE RESTRICT,
  baseplate_type VARCHAR(100),
  baseplate_config JSONB DEFAULT '{}'::jsonb,
  supports JSONB DEFAULT '[]'::jsonb,
  clamps JSONB DEFAULT '[]'::jsonb,
  features JSONB DEFAULT '{}'::jsonb,
  boolean_operations JSONB DEFAULT '[]'::jsonb,
  material VARCHAR(100),
  estimated_weight_g DECIMAL(10, 2),
  estimated_print_time_min INT,
  estimated_cost_usd DECIMAL(10, 2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Exports (generated output files)
CREATE TABLE exports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  design_version_id UUID NOT NULL REFERENCES design_versions(id) ON DELETE CASCADE,
  exported_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  format export_format NOT NULL,
  file_size_bytes INT,
  s3_path VARCHAR(512) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP, -- 30-day retention
  download_count INT DEFAULT 0,
  last_downloaded_at TIMESTAMP,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Component Library (pre-defined clamps, supports)
CREATE TABLE component_library (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(255) NOT NULL,
  category component_category NOT NULL,
  type VARCHAR(100) NOT NULL,
  description TEXT,
  model_3d_url VARCHAR(512),
  parameters JSONB DEFAULT '{}'::jsonb,
  tags TEXT[] DEFAULT ARRAY[]::TEXT[],
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  is_custom BOOLEAN DEFAULT FALSE,
  created_by_org_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  metadata JSONB DEFAULT '{}'::jsonb
);

-- Audit Logs (GDPR compliance & security)
CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  action audit_action NOT NULL,
  resource_type audit_resource NOT NULL,
  resource_id UUID,
  old_values JSONB,
  new_values JSONB,
  ip_address INET,
  user_agent TEXT,
  status audit_status NOT NULL DEFAULT 'success',
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Notifications
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type notification_type NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT,
  resource_id UUID,
  is_read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- API Keys (for integrations like Fractory, Xometry)
CREATE TABLE api_keys (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  key_hash VARCHAR(255) NOT NULL UNIQUE,
  service VARCHAR(50) NOT NULL, -- 'fractory', 'xometry', etc.
  last_used_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  revoked_at TIMESTAMP
);

-- ===== INDEXES =====
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_organization ON users(organization_id);
CREATE INDEX idx_users_status ON users(status);

CREATE INDEX idx_organizations_owner ON organizations(owner_id);
CREATE INDEX idx_organizations_slug ON organizations(slug);

CREATE INDEX idx_organization_members_org ON organization_members(organization_id);
CREATE INDEX idx_organization_members_user ON organization_members(user_id);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE INDEX idx_projects_user_org ON projects(user_id, organization_id);
CREATE INDEX idx_projects_created_at ON projects(created_at DESC);
CREATE INDEX idx_projects_status ON projects(status);
CREATE INDEX idx_projects_deleted_at ON projects(deleted_at) WHERE deleted_at IS NULL; -- soft deletes

CREATE INDEX idx_project_shares_project ON project_shares(project_id);
CREATE INDEX idx_project_shares_shared_with ON project_shares(shared_with_user_id);

CREATE INDEX idx_model_uploads_project ON model_uploads(project_id);
CREATE INDEX idx_model_uploads_status ON model_uploads(status);
CREATE INDEX idx_model_uploads_created ON model_uploads(created_at DESC);

CREATE INDEX idx_design_versions_project ON design_versions(project_id, version_number DESC);
CREATE INDEX idx_design_versions_is_current ON design_versions(project_id, is_current);

CREATE INDEX idx_fixture_configs_design ON fixture_configurations(design_version_id);

CREATE INDEX idx_exports_design ON exports(design_version_id);
CREATE INDEX idx_exports_user ON exports(exported_by);
CREATE INDEX idx_exports_created ON exports(created_at DESC);

CREATE INDEX idx_component_library_category ON component_library(category);
CREATE INDEX idx_component_library_type ON component_library(type);
CREATE INDEX idx_component_library_tags ON component_library USING gin(tags);

CREATE INDEX idx_audit_logs_user_org_date ON audit_logs(user_id, organization_id, created_at DESC);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);

CREATE INDEX idx_notifications_user ON notifications(user_id, is_read, created_at DESC);

CREATE INDEX idx_api_keys_user_service ON api_keys(user_id, service);

-- ===== VIEWS =====

-- Active projects view (excludes soft-deleted)
CREATE VIEW active_projects AS
SELECT * FROM projects WHERE deleted_at IS NULL;

-- User project permissions (for authorization checks)
CREATE VIEW user_project_access AS
SELECT 
  p.id as project_id,
  p.user_id as owner_id,
  u.id as user_id,
  'owner' as access_level
FROM projects p
JOIN users u ON p.user_id = u.id
UNION ALL
SELECT 
  ps.project_id,
  p.user_id as owner_id,
  ps.shared_with_user_id as user_id,
  CASE WHEN ps.can_edit THEN 'editor' ELSE 'viewer' END as access_level
FROM project_shares ps
JOIN projects p ON ps.project_id = p.id;

-- ===== TRIGGERS =====

-- Update updated_at timestamp on users table
CREATE TRIGGER update_users_timestamp BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- Update updated_at timestamp on organizations table
CREATE TRIGGER update_orgs_timestamp BEFORE UPDATE ON organizations
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- Update updated_at timestamp on projects table
CREATE TRIGGER update_projects_timestamp BEFORE UPDATE ON projects
FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- Maintain is_current flag for design versions (only one per project)
CREATE TRIGGER update_design_version_current AFTER UPDATE OF is_current ON design_versions
FOR EACH ROW EXECUTE FUNCTION maintain_design_version_current();

-- Auto-create audit log on project delete
CREATE TRIGGER audit_project_delete AFTER DELETE ON projects
FOR EACH ROW EXECUTE FUNCTION create_audit_log_on_delete();

-- ===== HELPER FUNCTIONS =====

-- Generic update timestamp
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Ensure only one current design version per project
CREATE OR REPLACE FUNCTION maintain_design_version_current()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.is_current THEN
    UPDATE design_versions SET is_current = FALSE
    WHERE project_id = NEW.project_id AND id != NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Auto-audit on delete
CREATE OR REPLACE FUNCTION create_audit_log_on_delete()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_logs (
    user_id, resource_type, resource_id, action, old_values, status, created_at
  ) VALUES (
    OLD.user_id, 'project', OLD.id, 'delete_project',
    jsonb_build_object('name', OLD.name, 'status', OLD.status),
    'success', CURRENT_TIMESTAMP
  );
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- ===== STORED PROCEDURES =====

-- Purge old audit logs (GDPR: 90-day retention)
CREATE OR REPLACE FUNCTION purge_old_audit_logs(days_to_keep INT DEFAULT 90)
RETURNS INT AS $$
DECLARE
  deleted_rows INT;
BEGIN
  DELETE FROM audit_logs WHERE created_at < CURRENT_TIMESTAMP - (days_to_keep || ' days')::INTERVAL;
  GET DIAGNOSTICS deleted_rows = ROW_COUNT;
  RETURN deleted_rows;
END;
$$ LANGUAGE plpgsql;

-- Purge expired exports (30-day retention)
CREATE OR REPLACE FUNCTION purge_expired_exports()
RETURNS INT AS $$
DECLARE
  deleted_rows INT;
BEGIN
  DELETE FROM exports WHERE expires_at IS NOT NULL AND expires_at < CURRENT_TIMESTAMP;
  GET DIAGNOSTICS deleted_rows = ROW_COUNT;
  RETURN deleted_rows;
END;
$$ LANGUAGE plpgsql;

-- Calculate organization storage usage
CREATE OR REPLACE FUNCTION calculate_org_storage_usage(org_id UUID)
RETURNS BIGINT AS $$
BEGIN
  RETURN (
    SELECT COALESCE(SUM(mu.file_size_bytes), 0) +
           COALESCE(SUM(e.file_size_bytes), 0)
    FROM model_uploads mu
    JOIN projects p ON mu.project_id = p.id
    LEFT JOIN exports e ON p.id = (
      SELECT project_id FROM design_versions dv WHERE dv.id = e.design_version_id
    )
    WHERE p.organization_id = org_id
  );
END;
$$ LANGUAGE plpgsql;

-- ===== SEED DATA (Optional) =====

-- Insert default components library
INSERT INTO component_library (name, category, type, description, parameters, is_custom)
VALUES
  ('Toggle Clamp - M10', 'clamp', 'toggle_clamp', 'Vertical toggle clamp', '{\"thread_size\": \"M10\", \"clamping_force_n\": 1000}', FALSE),
  ('Cylindrical Support - 20mm', 'support', 'cylindrical_support', 'Cylindrical support pillar', '{\"diameter_mm\": 20, \"adjustable\": true}', FALSE),
  ('Rectangular Block Support', 'support', 'rectangular_support', 'Rectangular block support', '{\"width_mm\": 30, \"depth_mm\": 30}', FALSE),
  ('Perforated Panel Baseplate', 'baseplate', 'perforated_panel', 'Standard perforated panel with M5 holes', '{\"hole_spacing_mm\": 25, \"thickness_mm\": 10}', FALSE);

