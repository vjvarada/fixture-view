# RapidTool-Fixture — Setup Guide

**Complete setup instructions for local development and production deployment**

---

## Prerequisites

### Required Software

1. **Node.js 20+**
   - Download: https://nodejs.org/
   - Verify: `node --version`

2. **Docker Desktop** (for PostgreSQL)
   - Windows: https://docs.docker.com/desktop/install/windows-install/
   - Mac: https://docs.docker.com/desktop/install/mac-install/
   - Linux: https://docs.docker.com/desktop/install/linux-install/
   - Verify: `docker --version`

3. **Git**
   - Download: https://git-scm.com/
   - Verify: `git --version`

---

## Quick Start (5 Minutes)

### 1. Clone Repository

```bash
git clone <repo-url>
cd fixture-view
```

### 2. Install Dependencies

```bash
# Install frontend dependencies
npm install

# Install backend dependencies
cd backend
npm install
cd ..
```

### 3. Start PostgreSQL (Docker)

```bash
docker run --name rapidtool-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=rapidtool_fixture \
  -p 5432:5432 \
  -d postgres:15

# Verify it's running
docker ps
```

### 4. Configure Environment

```bash
# Copy example environment file
cp .env.example .env

# .env is already configured for local PostgreSQL
# No changes needed for local development!
```

### 5. Initialize Database

```bash
cd backend

# Generate Prisma Client
npx prisma generate

# Run database migrations
npx prisma migrate dev --name init

# (Optional) Open Prisma Studio to view database
npx prisma studio
```

### 6. Start Development Servers

```bash
# Terminal 1: Start backend
cd backend
npm run dev
# Backend runs on: http://localhost:3000

# Terminal 2: Start frontend
npm run dev
# Frontend runs on: http://localhost:5173
```

### 7. Open Application

Open your browser to: **http://localhost:5173**

---

## Detailed Setup

### PostgreSQL with Docker

#### Start PostgreSQL

```bash
docker run --name rapidtool-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=rapidtool_fixture \
  -p 5432:5432 \
  -d postgres:15
```

#### Useful Docker Commands

```bash
# Check if running
docker ps

# View logs
docker logs rapidtool-postgres

# Stop PostgreSQL
docker stop rapidtool-postgres

# Start PostgreSQL (after stopping)
docker start rapidtool-postgres

# Restart PostgreSQL
docker restart rapidtool-postgres

# Remove container (if needed)
docker stop rapidtool-postgres
docker rm rapidtool-postgres
```

#### Connect to PostgreSQL

```bash
# Using Docker exec
docker exec -it rapidtool-postgres psql -U postgres -d rapidtool_fixture

# List tables
\dt

# Describe users table
\d users

# Exit
\q
```

---

### Environment Configuration

#### Backend Environment Variables

Create `backend/.env`:

```env
# Database
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/rapidtool_fixture

# JWT Secrets (generate new ones for production!)
JWT_ACCESS_SECRET=your-super-secret-access-token-key-change-in-production
JWT_REFRESH_SECRET=your-super-secret-refresh-token-key-change-in-production

# JWT Expiry
JWT_ACCESS_EXPIRES=15m
JWT_REFRESH_EXPIRES=7d

# Email (for verification and password reset)
EMAIL_FROM=noreply@rapidtool-fixture.com
EMAIL_HOST=smtp.example.com
EMAIL_PORT=587
EMAIL_USER=
EMAIL_PASSWORD=

# Application URLs
FRONTEND_URL=http://localhost:5173
API_URL=http://localhost:3000

# Environment
NODE_ENV=development
PORT=3000
CORS_ORIGIN=http://localhost:5173
```

#### Frontend Environment Variables

Create `.env`:

```env
VITE_API_URL=http://localhost:3000
VITE_APP_VERSION=1.0.0
```

---

### Database Management

#### Prisma Commands

```bash
cd backend

# Generate Prisma Client (after schema changes)
npx prisma generate

# Create new migration
npx prisma migrate dev --name migration_name

# Apply migrations (production)
npx prisma migrate deploy

# Reset database (WARNING: deletes all data!)
npx prisma migrate reset

# Open Prisma Studio (database GUI)
npx prisma studio

# Format schema file
npx prisma format

# Validate schema
npx prisma validate
```

#### Prisma Studio

```bash
npx prisma studio
```

Opens at: http://localhost:5555

Features:
- View all tables
- Edit data directly
- Filter and search
- Add/delete records

---

## Development Workflow

### Daily Workflow

```bash
# 1. Start PostgreSQL (if not running)
docker start rapidtool-postgres

# 2. Start backend (Terminal 1)
cd backend
npm run dev

# 3. Start frontend (Terminal 2)
npm run dev

# 4. Open browser
# http://localhost:5173
```

### Making Database Changes

```bash
# 1. Edit backend/prisma/schema.prisma

# 2. Create migration
cd backend
npx prisma migrate dev --name add_new_field

# 3. Prisma Client is automatically regenerated
```

### Testing

```bash
# Frontend tests
npm test

# Backend tests
cd backend
npm test

# E2E tests
npm run test:e2e
```

---

## Troubleshooting

### PostgreSQL Issues

**Error: "Can't connect to PostgreSQL"**

```bash
# Check if container is running
docker ps

# If not running, start it
docker start rapidtool-postgres

# Check logs for errors
docker logs rapidtool-postgres
```

**Error: "Port 5432 already in use"**

```bash
# Check what's using port 5432
netstat -an | grep 5432

# Stop other PostgreSQL instance or change port
docker run --name rapidtool-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=rapidtool_fixture \
  -p 5433:5432 \
  -d postgres:15

# Update DATABASE_URL to use port 5433
```

**Error: "Container name already exists"**

```bash
# Remove existing container
docker rm rapidtool-postgres

# Or use different name
docker run --name rapidtool-postgres-2 ...
```

### Prisma Issues

**Error: "Prisma Client not generated"**

```bash
cd backend
npx prisma generate
```

**Error: "Migration failed"**

```bash
# Reset database (WARNING: deletes all data!)
npx prisma migrate reset

# Or manually fix migration files in prisma/migrations/
```

**Error: "Environment variable not found: DATABASE_URL"**

```bash
# Make sure .env file exists in backend/
cd backend
ls -la .env

# If missing, copy from example
cp ../.env.example .env
```

### Frontend Issues

**Error: "Cannot connect to API"**

```bash
# Check if backend is running
curl http://localhost:3000/health

# Check VITE_API_URL in .env
cat .env | grep VITE_API_URL
```

**Error: "Port 5173 already in use"**

```bash
# Kill process using port 5173
# Windows
netstat -ano | findstr :5173
taskkill /PID <PID> /F

# Mac/Linux
lsof -ti:5173 | xargs kill -9
```

---

## Production Deployment

### Database Setup (PostgreSQL)

#### Option 1: Railway (Recommended)

1. Sign up at https://railway.app
2. Create new project
3. Add PostgreSQL database
4. Copy connection string
5. Update production environment variables

**Connection String Format:**
```
postgresql://postgres:password@containers-us-west-123.railway.app:5432/railway
```

#### Option 2: Render

1. Sign up at https://render.com
2. Create PostgreSQL database
3. Copy connection string
4. Update production environment variables

**Connection String Format:**
```
postgresql://user:pass@dpg-xxxxx.oregon-postgres.render.com/dbname
```

#### Option 3: Supabase

1. Sign up at https://supabase.com
2. Create new project
3. Get connection string from Settings > Database
4. Update production environment variables

**Connection String Format:**
```
postgresql://postgres:password@db.xxxxx.supabase.co:5432/postgres
```

### Deploy Backend

```bash
cd backend

# Set production environment variables
# DATABASE_URL=<production-postgresql-url>
# NODE_ENV=production
# JWT_ACCESS_SECRET=<strong-random-secret>
# JWT_REFRESH_SECRET=<strong-random-secret>

# Run migrations
npx prisma migrate deploy

# Start production server
npm start
```

### Deploy Frontend

```bash
# Build frontend
npm run build

# Deploy to Vercel/Netlify/etc
# Or serve with nginx
```

---

## Production Checklist

### Security

- [ ] Change all JWT secrets to strong random values
- [ ] Enable HTTPS/TLS
- [ ] Set secure cookie flags (HttpOnly, Secure, SameSite)
- [ ] Configure CORS with specific origins
- [ ] Enable rate limiting
- [ ] Set up database SSL connections
- [ ] Configure security headers (Helmet.js)

### Database

- [ ] Use managed PostgreSQL (Railway/Render/Supabase)
- [ ] Enable automated backups
- [ ] Set up connection pooling
- [ ] Configure database SSL
- [ ] Monitor database performance

### Email

- [ ] Configure production email service (SendGrid/AWS SES)
- [ ] Set up SPF, DKIM, DMARC records
- [ ] Test email deliverability

### Monitoring

- [ ] Set up error tracking (Sentry)
- [ ] Configure application monitoring
- [ ] Set up database monitoring
- [ ] Configure audit log retention

---

## Summary

### Local Development Setup

```bash
# 1. Start PostgreSQL
docker run --name rapidtool-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=rapidtool_fixture \
  -p 5432:5432 -d postgres:15

# 2. Install dependencies
npm install
cd backend && npm install && cd ..

# 3. Setup environment
cp .env.example .env

# 4. Initialize database
cd backend
npx prisma generate
npx prisma migrate dev --name init

# 5. Start servers
npm run dev  # Frontend
cd backend && npm run dev  # Backend
```

### Production Deployment

```bash
# 1. Create PostgreSQL database (Railway/Render/Supabase)
# 2. Set production environment variables
# 3. Deploy migrations: npx prisma migrate deploy
# 4. Deploy backend and frontend
```

---

**You're all set!** 🎉

Start developing with PostgreSQL locally and deploy to production with the same database.

**Last Updated:** December 24, 2025
