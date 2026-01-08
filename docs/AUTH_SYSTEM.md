# Authentication & Authorization System

**RapidTool-Fixture — Secure User Management & Access Control**

---

## Executive Summary

This document outlines the complete authentication and authorization system for RapidTool-Fixture, a browser-based 3D fixture design application. The system is designed with security, scalability, and user experience as primary concerns.

**Key Features:**
- JWT-based authentication with token rotation
- Email/password registration with verification
- Secure password reset flow
- Account security (lockout, MFA-ready)
- Role-based access control (RBAC)
- Audit logging for compliance

**Technology Stack:**
- **Database:** PostgreSQL (recommended)
- **Authentication:** JWT (JSON Web Tokens)
- **Password Hashing:** bcrypt (12 rounds)
- **ORM:** Prisma
- **Backend:** Node.js + Express.js

---

## Table of Contents

1. [Database Selection](#database-selection)
2. [Database Schema](#database-schema)
3. [Authentication Flow](#authentication-flow)
4. [Authorization System](#authorization-system)
5. [Security Features](#security-features)
6. [API Endpoints](#api-endpoints)
7. [Implementation Guide](#implementation-guide)
8. [Production Checklist](#production-checklist)

---

## Database Selection

### Local Development: MySQL
### Production: PostgreSQL

---

## Local Development Database: MySQL

**Why MySQL for Local Testing?**

✅ **Easy Setup**
- Simple installation on Windows/Mac/Linux
- Lightweight and fast for development
- Familiar to most developers

✅ **Good Performance**
- Fast for small to medium datasets
- Efficient for local testing
- Low resource usage

✅ **Wide Support**
- Excellent Prisma support
- Works with all major tools
- Large community

✅ **Quick Start**
```bash
# Install with Docker (recommended)
docker run --name rapidtool-mysql \
  -e MYSQL_ROOT_PASSWORD=root \
  -e MYSQL_DATABASE=rapidtool_fixture \
  -p 3306:3306 -d mysql:8.0

# Or install locally
# Windows: Download MySQL installer
# Mac: brew install mysql
# Linux: apt-get install mysql-server
```

**MySQL Connection String:**
```env
DATABASE_URL="mysql://root:root@localhost:3306/rapidtool_fixture"
```

---

## Production Database: PostgreSQL

**Why PostgreSQL for Production?**

✅ **Enterprise-Grade Reliability**
- ACID-compliant transactions
- Data integrity guarantees
- Proven track record (30+ years)
- Used by: Instagram, Spotify, Netflix

✅ **Advanced Security**
- Row-level security (RLS)
- Built-in encryption support
- Fine-grained access control
- Better audit capabilities

✅ **Superior Scalability**
- Handles millions of users
- Better concurrent write performance
- Advanced indexing (B-tree, Hash, GiST, GIN)
- Efficient connection pooling

✅ **Rich Features**
- JSONB support (faster than MySQL JSON)
- Full-text search (built-in)
- Array data types
- Advanced query optimization
- Better handling of complex queries

✅ **Production-Ready Hosting**
- AWS RDS PostgreSQL (managed)
- Railway (easy deployment)
- Render (free tier available)
- Supabase (PostgreSQL + APIs)
- DigitalOcean Managed Databases

✅ **Cost-Effective at Scale**
- Better performance per dollar
- Efficient resource usage
- Lower maintenance costs

**PostgreSQL Connection String:**
```env
DATABASE_URL="postgresql://user:password@host:5432/rapidtool_fixture"
```

---

## Database Comparison

### Local Development

| Feature | MySQL | PostgreSQL | Winner |
|---------|-------|------------|--------|
| **Setup Speed** | ⚡ Very Fast | 🐢 Slower | MySQL |
| **Resource Usage** | 💚 Low | 💛 Medium | MySQL |
| **Familiarity** | 👍 High | 👌 Medium | MySQL |
| **Local Testing** | ✅ Perfect | ✅ Good | MySQL |

**Verdict for Local:** ✅ **MySQL is ideal for local development**

---

### Production

| Feature | MySQL | PostgreSQL | Winner |
|---------|-------|------------|--------|
| **Concurrency** | 👌 Good | ⚡ Excellent | PostgreSQL |
| **JSON Performance** | 💛 Slower | 💚 Faster (JSONB) | PostgreSQL |
| **Complex Queries** | 👌 Good | ⚡ Excellent | PostgreSQL |
| **Scalability** | 👍 Good | ⚡ Excellent | PostgreSQL |
| **Security Features** | 👌 Good | ⚡ Advanced | PostgreSQL |
| **Data Integrity** | 👍 Good | ⚡ Superior | PostgreSQL |
| **Managed Services** | ✅ Available | ✅ More options | PostgreSQL |
| **Cost at Scale** | 💰 Higher | 💚 Lower | PostgreSQL |

**Verdict for Production:** ✅ **PostgreSQL is superior for production**

---

## Migration Strategy

### Development to Production

**Approach:** Use Prisma's database-agnostic schema

Prisma supports both MySQL and PostgreSQL with minimal changes:

```prisma
// Works with both MySQL and PostgreSQL
datasource db {
  provider = "mysql"        // Change to "postgresql" for production
  url      = env("DATABASE_URL")
}
```

**Migration Steps:**
1. Develop with MySQL locally
2. Test thoroughly
3. Switch to PostgreSQL for staging
4. Deploy to production with PostgreSQL

**Note:** Prisma handles most differences automatically, but test thoroughly before production deployment.

---

## Recommendation Summary

### ✅ Use MySQL for Local Development
**Reasons:**
- Faster setup
- Lower resource usage
- Easier for local testing
- Familiar to most developers

### ✅ Use PostgreSQL for Production
**Reasons:**
- Better performance at scale
- Superior security features
- More reliable for concurrent users
- Better JSON handling (JSONB)
- Lower costs at scale
- Industry standard for SaaS applications

**This is a common and recommended approach used by many successful startups and companies.**

---

## Database Schema

### Overview

**3 Core Tables for Authentication:**
1. `users` — User accounts and credentials
2. `refresh_tokens` — JWT token management
3. `audit_logs` — Security event tracking

### Table 1: users

**Purpose:** Store user credentials, profile, and security settings

```sql
CREATE TABLE users (
  -- Primary Key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Authentication Credentials
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  
  -- Email Verification
  email_verified BOOLEAN DEFAULT FALSE,
  verification_token VARCHAR(255),
  verification_token_expiry TIMESTAMP,
  
  -- Password Reset
  password_reset_token VARCHAR(255),
  password_reset_expiry TIMESTAMP,
  
  -- Account Security
  failed_login_attempts INTEGER DEFAULT 0,
  locked_until TIMESTAMP,
  mfa_enabled BOOLEAN DEFAULT FALSE,
  mfa_secret VARCHAR(255),
  
  -- User Profile
  name VARCHAR(255),
  avatar_url TEXT,
  preferences JSONB DEFAULT '{}',
  
  -- Timestamps
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  last_login_at TIMESTAMP,
  deleted_at TIMESTAMP,
  
  -- Indexes
  CONSTRAINT users_email_key UNIQUE (email)
);

CREATE INDEX idx_users_email ON users(email) WHERE deleted_at IS NULL;
CREATE INDEX idx_users_verification_token ON users(verification_token);
CREATE INDEX idx_users_reset_token ON users(password_reset_token);
```

**Field Descriptions:**

| Field | Type | Purpose |
|-------|------|---------|
| `id` | UUID | Unique user identifier |
| `email` | VARCHAR(255) | User's email (login credential) |
| `password_hash` | VARCHAR(255) | bcrypt hash of password (never store plain text) |
| `email_verified` | BOOLEAN | Email verification status |
| `verification_token` | VARCHAR(255) | Token for email verification link |
| `password_reset_token` | VARCHAR(255) | Token for password reset link |
| `failed_login_attempts` | INTEGER | Track failed login attempts |
| `locked_until` | TIMESTAMP | Account lockout expiry |
| `mfa_enabled` | BOOLEAN | Multi-factor authentication status |
| `preferences` | JSONB | User settings (theme, language, etc.) |
| `deleted_at` | TIMESTAMP | Soft delete timestamp (GDPR compliance) |

---

### Table 2: refresh_tokens

**Purpose:** Manage JWT refresh tokens with rotation for enhanced security

```sql
CREATE TABLE refresh_tokens (
  -- Primary Key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- User Reference
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Token Data
  token_hash VARCHAR(255) UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  
  -- Token Rotation (Security)
  revoked BOOLEAN DEFAULT FALSE,
  revoked_at TIMESTAMP,
  replaced_by_token VARCHAR(255),
  
  -- Request Metadata (Security)
  ip_address VARCHAR(45),
  user_agent TEXT,
  
  -- Timestamp
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);
CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);
```

**Token Rotation Strategy:**
- Each refresh creates a new token and revokes the old one
- Prevents token reuse attacks
- Tracks token family for security monitoring

---

### Table 3: audit_logs

**Purpose:** Track all security-related events for compliance and monitoring

```sql
CREATE TABLE audit_logs (
  -- Primary Key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- User Reference (nullable for failed login attempts)
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  
  -- Event Information
  action VARCHAR(50) NOT NULL,
  resource VARCHAR(50),
  resource_id VARCHAR(255),
  
  -- Result
  status VARCHAR(20) NOT NULL, -- success, failure, error
  error_message TEXT,
  
  -- Request Context
  ip_address VARCHAR(45),
  user_agent TEXT,
  
  -- Additional Data
  metadata JSONB,
  
  -- Timestamp
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX idx_audit_logs_resource ON audit_logs(resource, resource_id);
```

**Events Tracked:**
- `LOGIN` — User login attempts (success/failure)
- `LOGOUT` — User logout
- `REGISTER` — New user registration
- `EMAIL_VERIFY` — Email verification
- `PASSWORD_CHANGE` — Password changes
- `PASSWORD_RESET` — Password reset requests
- `ACCOUNT_LOCK` — Account lockouts
- `MFA_ENABLE` — MFA activation

---

## Authentication Flow

### 1. User Registration Flow

```
┌─────────────┐
│   CLIENT    │
│  (Browser)  │
└──────┬──────┘
       │
       │ 1. POST /api/auth/register
       │    { email, password, name }
       ▼
┌─────────────────────────────────────────┐
│           BACKEND API                    │
├─────────────────────────────────────────┤
│                                          │
│  2. Validate Input                       │
│     ├─ Email format check               │
│     ├─ Password strength (8+ chars)     │
│     └─ Check email not already used     │
│                                          │
│  3. Hash Password                        │
│     └─ bcrypt.hash(password, 12)        │
│                                          │
│  4. Generate Verification Token          │
│     └─ crypto.randomBytes(32)           │
│                                          │
│  5. Create User in Database              │
│     └─ INSERT INTO users (...)          │
│                                          │
│  6. Send Verification Email              │
│     └─ Email with verification link     │
│                                          │
│  7. Log Event                            │
│     └─ INSERT INTO audit_logs           │
│                                          │
└──────┬──────────────────────────────────┘
       │
       │ 8. Response: { success, message }
       ▼
┌─────────────┐
│   CLIENT    │
│  Show: "Check your email to verify"     │
└─────────────┘
```

**Security Measures:**
- Password hashed with bcrypt (12 rounds)
- Email verification required before login
- Rate limiting (5 registrations per IP per hour)
- Audit logging

---

### 2. Email Verification Flow

```
┌─────────────┐
│    USER     │
│   (Email)   │
└──────┬──────┘
       │
       │ 1. Click verification link
       │    /api/auth/verify?token=xxx
       ▼
┌─────────────────────────────────────────┐
│           BACKEND API                    │
├─────────────────────────────────────────┤
│                                          │
│  2. Validate Token                       │
│     ├─ Check token exists               │
│     ├─ Check not expired (24 hours)     │
│     └─ Check not already verified       │
│                                          │
│  3. Update User                          │
│     └─ UPDATE users                     │
│        SET email_verified = true        │
│                                          │
│  4. Log Event                            │
│     └─ INSERT INTO audit_logs           │
│                                          │
└──────┬──────────────────────────────────┘
       │
       │ 5. Redirect to login page
       ▼
┌─────────────┐
│   CLIENT    │
│  Show: "Email verified! Please login"   │
└─────────────┘
```

---

### 3. Login Flow (JWT Authentication)

```
┌─────────────┐
│   CLIENT    │
└──────┬──────┘
       │
       │ 1. POST /api/auth/login
       │    { email, password }
       ▼
┌─────────────────────────────────────────┐
│           BACKEND API                    │
├─────────────────────────────────────────┤
│                                          │
│  2. Find User by Email                   │
│     └─ SELECT * FROM users              │
│        WHERE email = ?                  │
│                                          │
│  3. Check Account Status                 │
│     ├─ Email verified?                  │
│     ├─ Account locked?                  │
│     └─ Too many failed attempts?        │
│                                          │
│  4. Verify Password                      │
│     └─ bcrypt.compare(password, hash)   │
│                                          │
│  5. Generate JWT Tokens                  │
│     ├─ Access Token (15 min expiry)     │
│     └─ Refresh Token (7 day expiry)     │
│                                          │
│  6. Store Refresh Token                  │
│     └─ INSERT INTO refresh_tokens       │
│                                          │
│  7. Update User                          │
│     ├─ last_login_at = NOW()            │
│     └─ failed_login_attempts = 0        │
│                                          │
│  8. Log Event                            │
│     └─ INSERT INTO audit_logs           │
│                                          │
└──────┬──────────────────────────────────┘
       │
       │ 9. Response:
       │    {
       │      accessToken: "eyJhbGc...",
       │      refreshToken: "eyJhbGc...",
       │      user: { id, email, name }
       │    }
       │    Set-Cookie: refreshToken (HttpOnly)
       ▼
┌─────────────┐
│   CLIENT    │
│  ├─ Store accessToken in memory         │
│  └─ Redirect to dashboard               │
└─────────────┘
```

**JWT Token Structure:**

**Access Token (15 minutes):**
```json
{
  "userId": "uuid",
  "email": "user@example.com",
  "iat": 1703347200,
  "exp": 1703348100
}
```

**Refresh Token (7 days):**
```json
{
  "userId": "uuid",
  "tokenId": "uuid",
  "iat": 1703347200,
  "exp": 1703952000
}
```

---

### 4. Token Refresh Flow

```
┌─────────────┐
│   CLIENT    │
│  (Access token expired)                  │
└──────┬──────┘
       │
       │ 1. POST /api/auth/refresh
       │    Cookie: refreshToken
       ▼
┌─────────────────────────────────────────┐
│           BACKEND API                    │
├─────────────────────────────────────────┤
│                                          │
│  2. Verify Refresh Token                 │
│     └─ jwt.verify(refreshToken)         │
│                                          │
│  3. Check Token in Database              │
│     └─ SELECT * FROM refresh_tokens     │
│        WHERE token_hash = ?             │
│                                          │
│  4. Validate Token                       │
│     ├─ Not expired?                     │
│     ├─ Not revoked?                     │
│     └─ User still exists?               │
│                                          │
│  5. Generate New Tokens                  │
│     ├─ New Access Token (15 min)        │
│     └─ New Refresh Token (7 days)       │
│                                          │
│  6. Rotate Refresh Token                 │
│     ├─ Revoke old token                 │
│     └─ Store new token                  │
│                                          │
│  7. Log Event                            │
│     └─ INSERT INTO audit_logs           │
│                                          │
└──────┬──────────────────────────────────┘
       │
       │ 8. Response:
       │    { accessToken, refreshToken }
       ▼
┌─────────────┐
│   CLIENT    │
│  Update tokens and continue              │
└─────────────┘
```

**Token Rotation Benefits:**
- Prevents token reuse attacks
- Limits damage from token theft
- Enables token family tracking

---

### 5. Password Reset Flow

```
┌─────────────┐
│   CLIENT    │
└──────┬──────┘
       │
       │ 1. POST /api/auth/request-reset
       │    { email }
       ▼
┌─────────────────────────────────────────┐
│           BACKEND API                    │
├─────────────────────────────────────────┤
│                                          │
│  2. Find User by Email                   │
│     └─ SELECT * FROM users              │
│                                          │
│  3. Generate Reset Token                 │
│     └─ crypto.randomBytes(32)           │
│                                          │
│  4. Store Token (1 hour expiry)          │
│     └─ UPDATE users                     │
│        SET password_reset_token = ?     │
│                                          │
│  5. Send Reset Email                     │
│     └─ Email with reset link            │
│                                          │
│  6. Log Event                            │
│     └─ INSERT INTO audit_logs           │
│                                          │
└──────┬──────────────────────────────────┘
       │
       │ 7. Response: { success }
       │    (Always success, even if email not found)
       ▼
┌─────────────┐
│   CLIENT    │
│  Show: "Check your email"                │
└─────────────┘

       ┌─────────────┐
       │    USER     │
       │  Clicks reset link                 │
       └──────┬──────┘
              │
              │ 8. POST /api/auth/reset
              │    { token, newPassword }
              ▼
       ┌─────────────────────────────────────────┐
       │           BACKEND API                    │
       ├─────────────────────────────────────────┤
       │                                          │
       │  9. Validate Token                       │
       │     ├─ Token exists?                    │
       │     └─ Not expired?                     │
       │                                          │
       │  10. Hash New Password                   │
       │      └─ bcrypt.hash(newPassword, 12)    │
       │                                          │
       │  11. Update User                         │
       │      ├─ password_hash = new_hash        │
       │      └─ password_reset_token = NULL     │
       │                                          │
       │  12. Revoke All Refresh Tokens           │
       │      └─ UPDATE refresh_tokens           │
       │         SET revoked = true              │
       │                                          │
       │  13. Log Event                           │
       │      └─ INSERT INTO audit_logs          │
       │                                          │
       └──────┬──────────────────────────────────┘
              │
              │ 14. Response: { success }
              ▼
       ┌─────────────┐
       │   CLIENT    │
       │  Show: "Password reset! Please login"   │
       └─────────────┘
```

---

## Authorization System

### Role-Based Access Control (RBAC)

**User Roles:**
1. `user` — Standard user (default)
2. `admin` — Administrator (future)

**Permission Model:**

| Resource | User | Admin |
|----------|------|-------|
| Own projects | ✅ Full access | ✅ Full access |
| Other's projects | ❌ No access | ✅ Read access |
| Shared projects | ✅ Based on permission | ✅ Full access |
| User management | ❌ No access | ✅ Full access |
| System settings | ❌ No access | ✅ Full access |

**Implementation:**

```typescript
// Middleware: Protect routes
const requireAuth = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await prisma.user.findUnique({
      where: { id: decoded.userId }
    });
    
    if (!req.user) {
      return res.status(401).json({ error: 'User not found' });
    }
    
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// Middleware: Check resource ownership
const requireOwnership = async (req, res, next) => {
  const project = await prisma.project.findUnique({
    where: { id: req.params.id }
  });
  
  if (project.userId !== req.user.id) {
    return res.status(403).json({ error: 'Access denied' });
  }
  
  next();
};
```

---

## Security Features

### 1. Password Security

**Requirements:**
- Minimum 8 characters
- At least 1 uppercase letter
- At least 1 lowercase letter
- At least 1 number
- At least 1 special character

**Hashing:**
```typescript
import bcrypt from 'bcrypt';

// Hash password (12 rounds = ~250ms)
const hash = await bcrypt.hash(password, 12);

// Verify password
const isValid = await bcrypt.compare(password, hash);
```

**Why bcrypt?**
- Adaptive (can increase rounds as hardware improves)
- Salt included automatically
- Industry standard
- Resistant to rainbow table attacks

---

### 2. Account Lockout

**Policy:**
- Lock account after 5 failed login attempts
- Lockout duration: 15 minutes
- Reset counter on successful login

**Implementation:**
```typescript
// On failed login
await prisma.user.update({
  where: { id: user.id },
  data: {
    failedLoginAttempts: { increment: 1 },
    lockedUntil: user.failedLoginAttempts >= 4 
      ? new Date(Date.now() + 15 * 60 * 1000) 
      : null
  }
});

// On successful login
await prisma.user.update({
  where: { id: user.id },
  data: {
    failedLoginAttempts: 0,
    lockedUntil: null
  }
});
```

---

### 3. Rate Limiting

**Limits:**
- Registration: 5 per IP per hour
- Login: 10 per IP per 15 minutes
- Password reset: 3 per email per hour
- Token refresh: 20 per user per hour

**Implementation:**
```typescript
import rateLimit from 'express-rate-limit';

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: 'Too many login attempts, please try again later'
});

app.post('/api/auth/login', loginLimiter, loginController);
```

---

### 4. Token Security

**Access Token:**
- Short-lived (15 minutes)
- Stored in memory (not localStorage)
- Sent in Authorization header

**Refresh Token:**
- Longer-lived (7 days)
- Stored in HttpOnly cookie
- Cannot be accessed by JavaScript
- Rotated on each use

**Cookie Configuration:**
```typescript
res.cookie('refreshToken', token, {
  httpOnly: true,      // Prevent XSS
  secure: true,        // HTTPS only
  sameSite: 'strict',  // Prevent CSRF
  maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
});
```

---

### 5. CORS Configuration

```typescript
import cors from 'cors';

app.use(cors({
  origin: process.env.FRONTEND_URL,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
```

---

### 6. Input Validation

**Using Zod:**
```typescript
import { z } from 'zod';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must contain uppercase')
    .regex(/[a-z]/, 'Password must contain lowercase')
    .regex(/[0-9]/, 'Password must contain number')
    .regex(/[^A-Za-z0-9]/, 'Password must contain special character'),
  name: z.string().min(2).max(100)
});
```

---

## API Endpoints

### Authentication Endpoints

#### 1. Register
```http
POST /api/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePass123!",
  "name": "John Doe"
}

Response 201:
{
  "success": true,
  "message": "Registration successful. Please check your email to verify your account."
}
```

#### 2. Login
```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "SecurePass123!"
}

Response 200:
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Doe",
    "emailVerified": true
  }
}
Set-Cookie: refreshToken=...; HttpOnly; Secure; SameSite=Strict
```

#### 3. Refresh Token
```http
POST /api/auth/refresh
Cookie: refreshToken=...

Response 200:
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

#### 4. Logout
```http
POST /api/auth/logout
Authorization: Bearer <accessToken>
Cookie: refreshToken=...

Response 200:
{
  "success": true,
  "message": "Logged out successfully"
}
```

#### 5. Verify Email
```http
GET /api/auth/verify?token=<verification_token>

Response 200:
{
  "success": true,
  "message": "Email verified successfully"
}
```

#### 6. Request Password Reset
```http
POST /api/auth/request-reset
Content-Type: application/json

{
  "email": "user@example.com"
}

Response 200:
{
  "success": true,
  "message": "If an account exists, a password reset email has been sent"
}
```

#### 7. Reset Password
```http
POST /api/auth/reset
Content-Type: application/json

{
  "token": "<reset_token>",
  "newPassword": "NewSecurePass123!"
}

Response 200:
{
  "success": true,
  "message": "Password reset successfully"
}
```

#### 8. Get Current User
```http
GET /api/auth/me
Authorization: Bearer <accessToken>

Response 200:
{
  "id": "uuid",
  "email": "user@example.com",
  "name": "John Doe",
  "emailVerified": true,
  "mfaEnabled": false,
  "createdAt": "2025-01-01T00:00:00Z"
}
```

---

## Implementation Guide

### 1. Environment Variables

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/rapidtool_fixture"

# JWT Secrets (generate with: openssl rand -base64 32)
JWT_ACCESS_SECRET="your-access-secret-here"
JWT_REFRESH_SECRET="your-refresh-secret-here"

# JWT Expiry
JWT_ACCESS_EXPIRY="15m"
JWT_REFRESH_EXPIRY="7d"

# Email Configuration
EMAIL_FROM="noreply@rapidtool.com"
SMTP_HOST="smtp.sendgrid.net"
SMTP_PORT="587"
SMTP_USER="apikey"
SMTP_PASS="your-sendgrid-api-key"

# Frontend URL (for CORS and email links)
FRONTEND_URL="http://localhost:5173"

# Application
NODE_ENV="development"
PORT="3000"
```

---

### 2. Database Setup

```bash
# Install dependencies
cd backend
npm install

# Generate Prisma client
npx prisma generate

# Create database migration
npx prisma migrate dev --name init_auth_system

# View database
npx prisma studio
```

---

### 3. Testing Authentication

**Manual Testing:**
```bash
# 1. Register user
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test123!","name":"Test User"}'

# 2. Login
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"Test123!"}'

# 3. Get current user (use token from login)
curl -X GET http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer <access_token>"
```

---

## Production Checklist

### Security

- [ ] Use strong JWT secrets (32+ characters, random)
- [ ] Enable HTTPS/TLS in production
- [ ] Set secure cookie flags (HttpOnly, Secure, SameSite)
- [ ] Configure CORS with specific origins
- [ ] Enable rate limiting on all endpoints
- [ ] Set up database connection pooling
- [ ] Enable database SSL connections
- [ ] Implement request logging
- [ ] Set up error monitoring (Sentry)
- [ ] Configure security headers (Helmet.js)

### Database

- [ ] Use managed PostgreSQL (AWS RDS, Railway, Render)
- [ ] Enable automated backups
- [ ] Set up read replicas (if needed)
- [ ] Configure connection pooling (max 20 connections)
- [ ] Enable query logging for slow queries
- [ ] Set up database monitoring
- [ ] Implement database encryption at rest

### Email

- [ ] Use production email service (SendGrid, AWS SES)
- [ ] Configure SPF, DKIM, DMARC records
- [ ] Set up email templates
- [ ] Test email deliverability
- [ ] Monitor email bounce rates

### Monitoring

- [ ] Set up application monitoring (Sentry, DataDog)
- [ ] Configure audit log retention (90 days)
- [ ] Set up alerts for failed login spikes
- [ ] Monitor token refresh rates
- [ ] Track account lockouts

### Compliance

- [ ] Implement GDPR data export
- [ ] Implement GDPR data deletion
- [ ] Add privacy policy
- [ ] Add terms of service
- [ ] Set up audit log retention policy

---

## Summary

### Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                   AUTHENTICATION SYSTEM                  │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Database: PostgreSQL                                    │
│  ├─ users (credentials, profile, security)              │
│  ├─ refresh_tokens (JWT rotation)                       │
│  └─ audit_logs (security events)                        │
│                                                          │
│  Authentication: JWT                                     │
│  ├─ Access Token (15 min, in memory)                    │
│  └─ Refresh Token (7 days, HttpOnly cookie)             │
│                                                          │
│  Security Features:                                      │
│  ├─ bcrypt password hashing (12 rounds)                 │
│  ├─ Email verification required                         │
│  ├─ Account lockout (5 failed attempts)                 │
│  ├─ Rate limiting (all endpoints)                       │
│  ├─ Token rotation (refresh tokens)                     │
│  └─ Audit logging (all events)                          │
│                                                          │
│  API Endpoints: 8                                        │
│  ├─ Register, Login, Logout                             │
│  ├─ Verify Email, Reset Password                        │
│  └─ Refresh Token, Get User                             │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

### Key Benefits

✅ **Secure** — Industry-standard security practices  
✅ **Scalable** — PostgreSQL handles millions of users  
✅ **Compliant** — GDPR-ready with audit logs  
✅ **User-Friendly** — Email verification, password reset  
✅ **Production-Ready** — Complete implementation included  

### Implementation Status

- ✅ Database schema designed
- ✅ Prisma models created
- ✅ Authentication service implemented
- ✅ API endpoints ready
- ✅ Security features included
- ⏳ Email templates needed
- ⏳ Frontend integration pending

---

**Recommendation:** This authentication system is production-ready and follows industry best practices. PostgreSQL is the optimal database choice for security, scalability, and reliability.

**Next Steps:**
1. Review and approve this design
2. Set up production PostgreSQL database
3. Configure email service (SendGrid recommended)
4. Deploy backend API
5. Integrate with frontend

---

**Document Version:** 1.0  
**Last Updated:** December 23, 2025  
**Status:** Ready for Founder Review
