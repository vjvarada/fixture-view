# Database Setup Guide

**RapidTool-Fixture — MySQL (Local) & PostgreSQL (Production)**

---

## Quick Reference

**Local Development:** MySQL 8.0  
**Production:** PostgreSQL 15+  
**ORM:** Prisma  

---

## Local Development Setup (MySQL)

### Option 1: Docker (Recommended)

**Fastest and cleanest way to run MySQL locally**

```bash
# Start MySQL container
docker run --name rapidtool-mysql \
  -e MYSQL_ROOT_PASSWORD=root \
  -e MYSQL_DATABASE=rapidtool_fixture \
  -p 3306:3306 \
  -d mysql:8.0

# Verify it's running
docker ps

# View logs
docker logs rapidtool-mysql

# Stop container
docker stop rapidtool-mysql

# Start container again
docker start rapidtool-mysql

# Remove container (if needed)
docker stop rapidtool-mysql && docker rm rapidtool-mysql
```

**Connection String:**
```env
DATABASE_URL="mysql://root:root@localhost:3306/rapidtool_fixture"
```

---

### Option 2: Local Installation

#### Windows

1. **Download MySQL Installer**
   - Visit: https://dev.mysql.com/downloads/installer/
   - Download: MySQL Installer (Web or Full)

2. **Install MySQL**
   - Run installer
   - Choose "Developer Default" setup
   - Set root password: `root` (for local dev)
   - Complete installation

3. **Create Database**
   ```bash
   # Open MySQL Command Line Client
   mysql -u root -p
   
   # Create database
   CREATE DATABASE rapidtool_fixture;
   
   # Verify
   SHOW DATABASES;
   
   # Exit
   exit;
   ```

#### macOS

```bash
# Install with Homebrew
brew install mysql

# Start MySQL service
brew services start mysql

# Secure installation (set root password)
mysql_secure_installation

# Create database
mysql -u root -p
CREATE DATABASE rapidtool_fixture;
exit;
```

#### Linux (Ubuntu/Debian)

```bash
# Install MySQL
sudo apt update
sudo apt install mysql-server

# Start MySQL service
sudo systemctl start mysql
sudo systemctl enable mysql

# Secure installation
sudo mysql_secure_installation

# Create database
sudo mysql -u root -p
CREATE DATABASE rapidtool_fixture;
exit;
```

---

## Initialize Database with Prisma

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Configure Environment

```bash
# Copy example environment file
cp ../.env.example ../.env

# Edit .env file
# Make sure DATABASE_URL is set to MySQL:
DATABASE_URL="mysql://root:root@localhost:3306/rapidtool_fixture"
```

### 3. Generate Prisma Client

```bash
npx prisma generate
```

### 4. Run Database Migration

```bash
# Create and apply migration
npx prisma migrate dev --name init

# This will:
# 1. Create migration files
# 2. Apply migration to database
# 3. Generate Prisma Client
```

### 5. Verify Database

```bash
# Open Prisma Studio (database GUI)
npx prisma studio

# Opens at: http://localhost:5555
# You can view and edit data here
```

---

## Production Setup (PostgreSQL)

### Recommended Hosting Options

#### 1. Railway (Easiest)

**Free Tier:** $5 credit/month (enough for development)

```bash
# 1. Sign up at railway.app
# 2. Create new project
# 3. Add PostgreSQL database
# 4. Copy connection string

# Example connection string:
DATABASE_URL="postgresql://postgres:password@containers-us-west-123.railway.app:5432/railway"
```

**Pros:**
- ✅ Free tier available
- ✅ Automatic backups
- ✅ Easy deployment
- ✅ Built-in monitoring

---

#### 2. Render (Good Free Tier)

**Free Tier:** PostgreSQL with 90-day data retention

```bash
# 1. Sign up at render.com
# 2. Create PostgreSQL database
# 3. Copy connection string

# Example connection string:
DATABASE_URL="postgresql://user:pass@dpg-xxxxx.oregon-postgres.render.com/dbname"
```

**Pros:**
- ✅ Free tier available
- ✅ Automatic backups
- ✅ SSL connections
- ✅ Easy to use

---

#### 3. Supabase (PostgreSQL + APIs)

**Free Tier:** 500MB database, 2GB bandwidth

```bash
# 1. Sign up at supabase.com
# 2. Create new project
# 3. Get connection string from Settings > Database

# Example connection string:
DATABASE_URL="postgresql://postgres:password@db.xxxxx.supabase.co:5432/postgres"
```

**Pros:**
- ✅ Free tier available
- ✅ Built-in authentication (optional)
- ✅ Real-time subscriptions
- ✅ Storage included

---

#### 4. AWS RDS (Enterprise)

**Cost:** ~$15-30/month for small instance

```bash
# 1. Create RDS PostgreSQL instance
# 2. Configure security groups
# 3. Get connection string

# Example connection string:
DATABASE_URL="postgresql://admin:password@mydb.xxxxx.us-east-1.rds.amazonaws.com:5432/rapidtool"
```

**Pros:**
- ✅ Enterprise-grade
- ✅ Automatic backups
- ✅ High availability
- ✅ Scalable

---

### Migrating from MySQL to PostgreSQL

**When you're ready to deploy to production:**

#### Step 1: Update Prisma Schema

```prisma
// backend/prisma/schema.prisma
datasource db {
  provider = "postgresql"  // Changed from "mysql"
  url      = env("DATABASE_URL")
}
```

#### Step 2: Update Environment Variable

```env
# Production .env
DATABASE_URL="postgresql://user:pass@host:5432/database"
```

#### Step 3: Generate New Migration

```bash
# Generate Prisma client for PostgreSQL
npx prisma generate

# Create migration for PostgreSQL
npx prisma migrate dev --name switch_to_postgresql

# Or deploy directly to production
npx prisma migrate deploy
```

#### Step 4: Test Thoroughly

```bash
# Run tests against PostgreSQL
npm test

# Verify all queries work
# Check JSON fields (MySQL JSON vs PostgreSQL JSONB)
```

---

## Database Differences (MySQL vs PostgreSQL)

### What Prisma Handles Automatically

✅ **Data Types**
- UUID generation
- JSON/JSONB fields
- Timestamps
- Boolean values

✅ **Queries**
- SELECT, INSERT, UPDATE, DELETE
- Relations and joins
- Filtering and sorting

✅ **Migrations**
- Schema changes
- Index creation
- Foreign keys

### What to Watch For

⚠️ **Case Sensitivity**
- MySQL: Case-insensitive by default
- PostgreSQL: Case-sensitive
- Solution: Use `.toLowerCase()` for email comparisons

⚠️ **JSON Performance**
- MySQL: JSON type (slower)
- PostgreSQL: JSONB type (faster, indexed)
- Solution: Test JSON queries in both databases

⚠️ **Full-Text Search**
- MySQL: FULLTEXT indexes
- PostgreSQL: Built-in full-text search
- Solution: Use Prisma's search features

---

## Common Commands

### MySQL Commands

```bash
# Connect to MySQL
mysql -u root -p

# Show databases
SHOW DATABASES;

# Use database
USE rapidtool_fixture;

# Show tables
SHOW TABLES;

# Describe table
DESCRIBE users;

# Drop database (careful!)
DROP DATABASE rapidtool_fixture;
```

### PostgreSQL Commands

```bash
# Connect to PostgreSQL
psql -U postgres

# List databases
\l

# Connect to database
\c rapidtool_fixture

# List tables
\dt

# Describe table
\d users

# Drop database (careful!)
DROP DATABASE rapidtool_fixture;

# Exit
\q
```

### Prisma Commands

```bash
# Generate Prisma Client
npx prisma generate

# Create migration
npx prisma migrate dev --name migration_name

# Apply migrations (production)
npx prisma migrate deploy

# Reset database (development only!)
npx prisma migrate reset

# Open Prisma Studio
npx prisma studio

# Format schema file
npx prisma format

# Validate schema
npx prisma validate

# Pull schema from database
npx prisma db pull

# Push schema to database (prototype)
npx prisma db push
```

---

## Troubleshooting

### MySQL Connection Issues

**Error: "Can't connect to MySQL server"**
```bash
# Check if MySQL is running
docker ps  # If using Docker
# or
sudo systemctl status mysql  # If installed locally

# Check port 3306 is not in use
netstat -an | grep 3306
```

**Error: "Access denied for user"**
```bash
# Reset MySQL root password
# Stop MySQL
# Start with --skip-grant-tables
# Reset password
ALTER USER 'root'@'localhost' IDENTIFIED BY 'root';
FLUSH PRIVILEGES;
```

### PostgreSQL Connection Issues

**Error: "Connection refused"**
```bash
# Check if PostgreSQL is running
docker ps  # If using Docker

# Check connection string format
# Should be: postgresql://USER:PASSWORD@HOST:PORT/DATABASE
```

**Error: "SSL connection required"**
```env
# Add SSL parameter to connection string
DATABASE_URL="postgresql://user:pass@host:5432/db?sslmode=require"
```

### Prisma Issues

**Error: "Prisma Client not generated"**
```bash
# Regenerate Prisma Client
npx prisma generate
```

**Error: "Migration failed"**
```bash
# Reset database (development only!)
npx prisma migrate reset

# Or manually drop database and recreate
```

---

## Performance Tips

### MySQL Optimization

```sql
-- Add indexes for frequently queried fields
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_projects_user_id ON projects(user_id);

-- Analyze tables
ANALYZE TABLE users;
```

### PostgreSQL Optimization

```sql
-- Add indexes
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_projects_user_id ON projects(user_id);

-- Analyze tables
ANALYZE users;

-- Vacuum database (cleanup)
VACUUM ANALYZE;
```

---

## Backup & Restore

### MySQL Backup

```bash
# Backup database
mysqldump -u root -p rapidtool_fixture > backup.sql

# Restore database
mysql -u root -p rapidtool_fixture < backup.sql
```

### PostgreSQL Backup

```bash
# Backup database
pg_dump -U postgres rapidtool_fixture > backup.sql

# Restore database
psql -U postgres rapidtool_fixture < backup.sql
```

---

## Summary

### Local Development (MySQL)
```bash
# 1. Start MySQL
docker run --name rapidtool-mysql \
  -e MYSQL_ROOT_PASSWORD=root \
  -e MYSQL_DATABASE=rapidtool_fixture \
  -p 3306:3306 -d mysql:8.0

# 2. Set environment
DATABASE_URL="mysql://root:root@localhost:3306/rapidtool_fixture"

# 3. Run migrations
cd backend
npx prisma generate
npx prisma migrate dev --name init

# 4. Start development
npm run dev
```

### Production (PostgreSQL)
```bash
# 1. Create PostgreSQL database (Railway/Render/Supabase)

# 2. Update Prisma schema
# Change provider to "postgresql"

# 3. Set environment
DATABASE_URL="postgresql://user:pass@host:5432/database"

# 4. Deploy migrations
npx prisma migrate deploy

# 5. Deploy application
```

---

**Recommendation:** Start with MySQL locally, switch to PostgreSQL for production. This is a proven approach used by many successful companies.

**Last Updated:** December 23, 2025
