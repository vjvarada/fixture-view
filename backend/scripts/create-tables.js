import postgres from 'postgres';
import dotenv from 'dotenv';

dotenv.config();

const sql = postgres(process.env.DATABASE_URL, {
  max: 1,
  idle_timeout: 20,
  connect_timeout: 10
});

async function createTables() {
  try {
    console.log('🔄 Creating database tables...\n');

    // Create users table
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        email_verified BOOLEAN DEFAULT false,
        verification_token TEXT,
        verification_token_expiry TIMESTAMP,
        password_reset_token TEXT,
        password_reset_expiry TIMESTAMP,
        failed_login_attempts INTEGER DEFAULT 0,
        locked_until TIMESTAMP,
        mfa_enabled BOOLEAN DEFAULT false,
        mfa_secret TEXT,
        name TEXT,
        avatar_url TEXT,
        preferences JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_login_at TIMESTAMP,
        deleted_at TIMESTAMP
      )
    `;
    console.log('✅ Created: users');

    // Create refresh_tokens table
    await sql`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT UNIQUE NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        revoked BOOLEAN DEFAULT false,
        revoked_at TIMESTAMP,
        replaced_by_token TEXT,
        ip_address TEXT,
        user_agent TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    console.log('✅ Created: refresh_tokens');

    // Create audit_logs table
    await sql`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        resource_type TEXT,
        resource_id TEXT,
        ip_address TEXT,
        user_agent TEXT,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    console.log('✅ Created: audit_logs');

    // Create projects table
    await sql`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT,
        thumbnail_url TEXT,
        is_public BOOLEAN DEFAULT false,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        deleted_at TIMESTAMP
      )
    `;
    console.log('✅ Created: projects');

    // Create design_versions table
    await sql`
      CREATE TABLE IF NOT EXISTS design_versions (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        version_number INTEGER NOT NULL,
        design_data JSONB NOT NULL,
        thumbnail_url TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project_id, version_number)
      )
    `;
    console.log('✅ Created: design_versions');

    // Create exports table
    await sql`
      CREATE TABLE IF NOT EXISTS exports (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        format TEXT NOT NULL,
        file_url TEXT NOT NULL,
        file_size INTEGER,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP
      )
    `;
    console.log('✅ Created: exports');

    // Create shared_projects table
    await sql`
      CREATE TABLE IF NOT EXISTS shared_projects (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        share_token TEXT UNIQUE NOT NULL,
        password_hash TEXT,
        expires_at TIMESTAMP,
        max_views INTEGER,
        view_count INTEGER DEFAULT 0,
        allow_download BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    console.log('✅ Created: shared_projects');

    // Create cloud_backups table
    await sql`
      CREATE TABLE IF NOT EXISTS cloud_backups (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        backup_url TEXT NOT NULL,
        backup_size INTEGER,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    console.log('✅ Created: cloud_backups');

    // Create indexes
    console.log('\n🔄 Creating indexes...');
    
    await sql`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens(token_hash)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_projects_user_id ON projects(user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_design_versions_project_id ON design_versions(project_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_exports_user_id ON exports(user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_exports_project_id ON exports(project_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_shared_projects_project_id ON shared_projects(project_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_cloud_backups_user_id ON cloud_backups(user_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_cloud_backups_project_id ON cloud_backups(project_id)`;
    
    console.log('✅ Created indexes');

    // Verify tables
    const tables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `;

    console.log('\n📊 Database tables created:');
    tables.forEach(t => console.log('  ✓', t.table_name));

    await sql.end();
    console.log('\n✅ Database setup completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error creating tables:', error.message);
    console.error(error);
    process.exit(1);
  }
}

createTables();
