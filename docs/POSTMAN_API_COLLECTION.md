# RapidTool-Fixture API - Postman Collection

**Base URL:** `http://localhost:3000/api`  
**Version:** 1.0  
**Last Updated:** December 30, 2025

---

## 📋 Table of Contents

1. [Authentication Endpoints](#authentication-endpoints)
2. [Environment Variables](#environment-variables)
3. [Common Headers](#common-headers)
4. [Error Responses](#error-responses)
5. [Testing Workflow](#testing-workflow)

---

## 🔐 Authentication Endpoints

### 1. Register New User

**POST** `/auth/register`

Creates a new user account and sends verification email.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!@#",
  "confirmPassword": "SecurePass123!@#",
  "name": "John Doe"
}
```

**Success Response (201):**
```json
{
  "success": true,
  "message": "Registration successful. Please check your email to verify your account.",
  "data": {
    "user": {
      "id": "uuid-here",
      "email": "user@example.com",
      "emailVerified": false
    },
    "verificationToken": "token-here-in-development-only"
  }
}
```

**Error Responses:**
- **400** - Validation error (weak password, invalid email, etc.)
- **409** - Email already exists
- **429** - Too many registration attempts (rate limit: 3 per hour)
- **500** - Server error

**Notes:**
- Password must be at least 8 characters with uppercase, lowercase, number, and special character
- Verification token only returned in development mode
- Email will be sent with verification link

---

### 2. Login

**POST** `/auth/login`

Authenticate user and receive access token.

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "SecurePass123!@#"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": {
      "id": "uuid-here",
      "email": "user@example.com",
      "emailVerified": true
    },
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**Response Headers:**
```
Set-Cookie: refresh_token=...; HttpOnly; Secure; SameSite=Strict; Path=/api/auth
```

**Error Responses:**
- **400** - Invalid credentials
- **403** - Account locked (too many failed attempts)
- **429** - Too many login attempts (rate limit: 5 per 15 minutes)
- **500** - Server error

**Notes:**
- Access token expires in 15 minutes
- Refresh token stored in HttpOnly cookie (7 days)
- Account locks after 5 failed attempts for 15 minutes

---

### 3. Refresh Access Token

**POST** `/auth/refresh`

Get a new access token using refresh token from cookie.

**Request Body:**
```json
{}
```

**Required Cookies:**
```
refresh_token=<token-from-login>
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Token refreshed successfully",
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**Error Responses:**
- **401** - Invalid or expired refresh token
- **403** - Refresh token revoked
- **500** - Server error

**Notes:**
- Automatically rotates refresh token for security
- Old refresh token becomes invalid after rotation

---

### 4. Logout

**POST** `/auth/logout`

Revoke refresh token and logout user.

**Headers:**
```
Authorization: Bearer <access-token>
```

**Request Body:**
```json
{}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Logout successful"
}
```

**Error Responses:**
- **401** - Unauthorized (invalid or missing token)
- **500** - Server error

**Notes:**
- Requires valid access token
- Revokes refresh token in database
- Clears refresh token cookie

---

### 5. Get Current User

**GET** `/auth/me`

Get authenticated user's profile information.

**Headers:**
```
Authorization: Bearer <access-token>
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "uuid-here",
      "email": "user@example.com",
      "name": "John Doe",
      "emailVerified": true,
      "createdAt": "2025-12-30T10:00:00.000Z",
      "updatedAt": "2025-12-30T10:00:00.000Z"
    }
  }
}
```

**Error Responses:**
- **401** - Unauthorized (invalid or missing token)
- **403** - Account locked
- **500** - Server error

---

### 6. Verify Email

**GET** `/auth/verify?token=<verification-token>`

Verify user's email address using token from email.

**Query Parameters:**
- `token` (required): Verification token from email

**Success Response (200):**
```json
{
  "success": true,
  "message": "Email verified successfully",
  "data": {
    "user": {
      "id": "uuid-here",
      "email": "user@example.com",
      "emailVerified": true
    }
  }
}
```

**Error Responses:**
- **400** - Invalid or expired token, or email already verified
- **500** - Server error

**Notes:**
- Token expires after 24 hours
- Welcome email sent after successful verification
- Can only verify once

---

### 7. Resend Verification Email

**POST** `/auth/resend-verification`

Request a new verification email.

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Verification email sent. Please check your inbox.",
  "data": {
    "verificationToken": "token-here-in-development-only"
  }
}
```

**Error Responses:**
- **400** - Email already verified
- **404** - User not found
- **429** - Too many requests (rate limit: 3 per hour)
- **500** - Server error

**Notes:**
- Generates new verification token
- Old token becomes invalid
- Rate limited to prevent abuse

---

### 8. Request Password Reset

**POST** `/auth/request-reset`

Request password reset email.

**Request Body:**
```json
{
  "email": "user@example.com"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "If an account exists with this email, a password reset link has been sent.",
  "data": {
    "resetToken": "token-here-in-development-only"
  }
}
```

**Error Responses:**
- **429** - Too many requests (rate limit: 3 per hour)
- **500** - Server error

**Notes:**
- Always returns success to prevent email enumeration
- Reset token expires in 1 hour
- Email sent with reset link
- Rate limited to prevent abuse

---

### 9. Reset Password

**POST** `/auth/reset`

Reset password using token from email.

**Request Body:**
```json
{
  "token": "reset-token-from-email",
  "password": "NewSecurePass123!@#"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Password reset successful"
}
```

**Error Responses:**
- **400** - Invalid or expired token, or weak password
- **500** - Server error

**Notes:**
- Token expires after 1 hour
- Password must meet complexity requirements
- Old token becomes invalid after use

---

## 🌍 Environment Variables

Set these in Postman Environment:

| Variable | Value | Description |
|----------|-------|-------------|
| `baseUrl` | `http://localhost:3000/api` | API base URL |
| `accessToken` | (auto-set) | JWT access token from login |
| `userId` | (auto-set) | User ID from login |
| `email` | `test@example.com` | Test user email |
| `password` | `Test123!@#` | Test user password |

---

## 📝 Common Headers

### For Public Endpoints (Register, Login, etc.)
```
Content-Type: application/json
```

### For Protected Endpoints (Logout, Get User, etc.)
```
Content-Type: application/json
Authorization: Bearer {{accessToken}}
```

---

## ❌ Error Responses

All error responses follow this format:

```json
{
  "success": false,
  "error": "Error message here",
  "details": [
    {
      "field": "email",
      "message": "Invalid email format"
    }
  ]
}
```

### Common HTTP Status Codes

- **200** - Success
- **201** - Created (registration)
- **400** - Bad Request (validation error)
- **401** - Unauthorized (invalid/missing token)
- **403** - Forbidden (account locked, email not verified)
- **404** - Not Found
- **409** - Conflict (email already exists)
- **429** - Too Many Requests (rate limit exceeded)
- **500** - Internal Server Error

---

## 🧪 Testing Workflow

### Complete Authentication Flow

Follow this sequence to test the entire authentication system:

#### 1. Register New User
```bash
POST /auth/register
Body: {
  "email": "testuser@example.com",
  "password": "Test123!@#",
  "confirmPassword": "Test123!@#",
  "name": "Test User"
}
```

**Expected:** 201 Created, verification email sent

#### 2. Check Backend Console
Look for verification token in console logs:
```
Verification token for testuser@example.com: abc123...
```

#### 3. Verify Email
```bash
GET /auth/verify?token=abc123...
```

**Expected:** 200 OK, email verified, welcome email sent

#### 4. Login
```bash
POST /auth/login
Body: {
  "email": "testuser@example.com",
  "password": "Test123!@#"
}
```

**Expected:** 200 OK, access token received

**Save the access token to environment:**
```javascript
// In Postman Tests tab:
pm.environment.set("accessToken", pm.response.json().data.accessToken);
pm.environment.set("userId", pm.response.json().data.user.id);
```

#### 5. Get Current User
```bash
GET /auth/me
Headers: Authorization: Bearer {{accessToken}}
```

**Expected:** 200 OK, user profile returned

#### 6. Refresh Token
```bash
POST /auth/refresh
```

**Expected:** 200 OK, new access token received

#### 7. Request Password Reset
```bash
POST /auth/request-reset
Body: {
  "email": "testuser@example.com"
}
```

**Expected:** 200 OK, reset email sent

#### 8. Check Console for Reset Token
```
Password reset token for testuser@example.com: xyz789...
```

#### 9. Reset Password
```bash
POST /auth/reset
Body: {
  "token": "xyz789...",
  "password": "NewTest123!@#"
}
```

**Expected:** 200 OK, password changed

#### 10. Login with New Password
```bash
POST /auth/login
Body: {
  "email": "testuser@example.com",
  "password": "NewTest123!@#"
}
```

**Expected:** 200 OK, login successful

#### 11. Logout
```bash
POST /auth/logout
Headers: Authorization: Bearer {{accessToken}}
```

**Expected:** 200 OK, logged out

---

## 📧 Email Configuration

### Gmail Setup (Recommended for Testing)

1. **Enable 2-Factor Authentication** on your Gmail account

2. **Generate App Password:**
   - Go to: https://myaccount.google.com/apppasswords
   - Select "Mail" and "Other (Custom name)"
   - Name it "RapidTool-Fixture"
   - Copy the 16-character password

3. **Update `.env` file:**
```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-16-char-app-password
EMAIL_FROM_ADDRESS=your-email@gmail.com
APP_URL=http://localhost:8080
```

4. **Restart backend server**

### Alternative: SendGrid

```env
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=apikey
SMTP_PASS=your-sendgrid-api-key
EMAIL_FROM_ADDRESS=noreply@yourdomain.com
```

### Alternative: Mailtrap (Testing Only)

```env
SMTP_HOST=smtp.mailtrap.io
SMTP_PORT=2525
SMTP_SECURE=false
SMTP_USER=your-mailtrap-username
SMTP_PASS=your-mailtrap-password
EMAIL_FROM_ADDRESS=test@example.com
```

---

## 🔒 Security Notes

1. **Access Tokens:**
   - Short-lived (15 minutes)
   - Stored in memory/localStorage on client
   - Include in Authorization header

2. **Refresh Tokens:**
   - Long-lived (7 days)
   - Stored in HttpOnly cookies
   - Automatically rotated on refresh

3. **Rate Limiting:**
   - Login: 5 attempts per 15 minutes
   - Register: 3 attempts per hour
   - Password Reset: 3 requests per hour
   - Resend Verification: 3 requests per hour

4. **Account Lockout:**
   - Locks after 5 failed login attempts
   - Lockout duration: 15 minutes
   - Automatic unlock after duration

5. **Token Expiry:**
   - Verification token: 24 hours
   - Password reset token: 1 hour
   - Access token: 15 minutes
   - Refresh token: 7 days

---

## 📦 Postman Collection Import

### Quick Import JSON

Save this as `RapidTool-Fixture.postman_collection.json`:

```json
{
  "info": {
    "name": "RapidTool-Fixture API",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "variable": [
    {
      "key": "baseUrl",
      "value": "http://localhost:3000/api"
    }
  ],
  "item": [
    {
      "name": "Auth",
      "item": [
        {
          "name": "Register",
          "request": {
            "method": "POST",
            "header": [
              {
                "key": "Content-Type",
                "value": "application/json"
              }
            ],
            "body": {
              "mode": "raw",
              "raw": "{\n  \"email\": \"{{email}}\",\n  \"password\": \"{{password}}\",\n  \"confirmPassword\": \"{{password}}\",\n  \"name\": \"Test User\"\n}"
            },
            "url": {
              "raw": "{{baseUrl}}/auth/register",
              "host": ["{{baseUrl}}"],
              "path": ["auth", "register"]
            }
          }
        },
        {
          "name": "Login",
          "event": [
            {
              "listen": "test",
              "script": {
                "exec": [
                  "if (pm.response.code === 200) {",
                  "  const response = pm.response.json();",
                  "  pm.environment.set('accessToken', response.data.accessToken);",
                  "  pm.environment.set('userId', response.data.user.id);",
                  "}"
                ]
              }
            }
          ],
          "request": {
            "method": "POST",
            "header": [
              {
                "key": "Content-Type",
                "value": "application/json"
              }
            ],
            "body": {
              "mode": "raw",
              "raw": "{\n  \"email\": \"{{email}}\",\n  \"password\": \"{{password}}\"\n}"
            },
            "url": {
              "raw": "{{baseUrl}}/auth/login",
              "host": ["{{baseUrl}}"],
              "path": ["auth", "login"]
            }
          }
        },
        {
          "name": "Get Current User",
          "request": {
            "method": "GET",
            "header": [
              {
                "key": "Authorization",
                "value": "Bearer {{accessToken}}"
              }
            ],
            "url": {
              "raw": "{{baseUrl}}/auth/me",
              "host": ["{{baseUrl}}"],
              "path": ["auth", "me"]
            }
          }
        },
        {
          "name": "Refresh Token",
          "event": [
            {
              "listen": "test",
              "script": {
                "exec": [
                  "if (pm.response.code === 200) {",
                  "  const response = pm.response.json();",
                  "  pm.environment.set('accessToken', response.data.accessToken);",
                  "}"
                ]
              }
            }
          ],
          "request": {
            "method": "POST",
            "header": [],
            "url": {
              "raw": "{{baseUrl}}/auth/refresh",
              "host": ["{{baseUrl}}"],
              "path": ["auth", "refresh"]
            }
          }
        },
        {
          "name": "Logout",
          "request": {
            "method": "POST",
            "header": [
              {
                "key": "Authorization",
                "value": "Bearer {{accessToken}}"
              }
            ],
            "url": {
              "raw": "{{baseUrl}}/auth/logout",
              "host": ["{{baseUrl}}"],
              "path": ["auth", "logout"]
            }
          }
        },
        {
          "name": "Verify Email",
          "request": {
            "method": "GET",
            "header": [],
            "url": {
              "raw": "{{baseUrl}}/auth/verify?token={{verificationToken}}",
              "host": ["{{baseUrl}}"],
              "path": ["auth", "verify"],
              "query": [
                {
                  "key": "token",
                  "value": "{{verificationToken}}"
                }
              ]
            }
          }
        },
        {
          "name": "Resend Verification",
          "request": {
            "method": "POST",
            "header": [
              {
                "key": "Content-Type",
                "value": "application/json"
              }
            ],
            "body": {
              "mode": "raw",
              "raw": "{\n  \"email\": \"{{email}}\"\n}"
            },
            "url": {
              "raw": "{{baseUrl}}/auth/resend-verification",
              "host": ["{{baseUrl}}"],
              "path": ["auth", "resend-verification"]
            }
          }
        },
        {
          "name": "Request Password Reset",
          "request": {
            "method": "POST",
            "header": [
              {
                "key": "Content-Type",
                "value": "application/json"
              }
            ],
            "body": {
              "mode": "raw",
              "raw": "{\n  \"email\": \"{{email}}\"\n}"
            },
            "url": {
              "raw": "{{baseUrl}}/auth/request-reset",
              "host": ["{{baseUrl}}"],
              "path": ["auth", "request-reset"]
            }
          }
        },
        {
          "name": "Reset Password",
          "request": {
            "method": "POST",
            "header": [
              {
                "key": "Content-Type",
                "value": "application/json"
              }
            ],
            "body": {
              "mode": "raw",
              "raw": "{\n  \"token\": \"{{resetToken}}\",\n  \"password\": \"NewPassword123!@#\"\n}"
            },
            "url": {
              "raw": "{{baseUrl}}/auth/reset",
              "host": ["{{baseUrl}}"],
              "path": ["auth", "reset"]
            }
          }
        }
      ]
    }
  ]
}
```

### Import Steps:
1. Open Postman
2. Click "Import" button
3. Select the JSON file
4. Collection will be imported with all endpoints

---

## 🎯 Quick Test Commands (cURL)

### Register
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Test123!@#",
    "confirmPassword": "Test123!@#",
    "name": "Test User"
  }'
```

### Login
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Test123!@#"
  }' \
  -c cookies.txt
```

### Get Current User
```bash
curl -X GET http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

### Logout
```bash
curl -X POST http://localhost:3000/api/auth/logout \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -b cookies.txt
```

---

## 📞 Support

For issues or questions:
- Check backend console logs for detailed error messages
- Verify email configuration in `.env` file
- Ensure database is running and accessible
- Check rate limits if requests are being blocked

---

**Last Updated:** December 30, 2025  
**API Version:** 1.0  
**Documentation Version:** 1.0
