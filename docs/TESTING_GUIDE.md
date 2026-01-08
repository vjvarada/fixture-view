# 🧪 Authentication System - Testing Guide

## ✅ System Status

### Backend
- **Status:** ✅ RUNNING
- **Port:** 3000
- **Database:** ✅ Connected (Supabase)
- **Health:** http://localhost:3000/api/health

### Frontend
- **Status:** ✅ READY
- **Port:** 5173 (when started)
- **Environment:** ✅ Configured

---

## 🚀 Quick Start Testing

### Step 1: Start Backend (Already Running)
```bash
cd backend
npm run dev
```
**Verify:** http://localhost:3000/api/health should return `{"status":"ok","uptime":...}`

### Step 2: Start Frontend
```bash
# In root directory
npm run dev
```
**Access:** http://localhost:5173

---

## 📋 Manual Testing Checklist

### ✅ Test 1: User Registration

**Steps:**
1. Navigate to http://localhost:5173/auth/register
2. Fill in the form:
   - **Name:** Test User
   - **Email:** testuser@example.com
   - **Password:** Test123!@# (must have uppercase, lowercase, number)
   - **Confirm Password:** Test123!@#
3. Click "Create Account"

**Expected Result:**
- ✅ Green success message appears
- ✅ "Registration successful! Redirecting to login..."
- ✅ Auto-redirect to login page after 2 seconds
- ✅ Email field pre-filled on login page
- ✅ Green success banner on login page

**Backend Verification:**
```powershell
# Check user was created in database
cd backend
npx prisma studio
# Navigate to User table and verify new user exists
```

---

### ✅ Test 2: User Login

**Steps:**
1. On login page (or navigate to http://localhost:5173/auth/login)
2. Enter credentials:
   - **Email:** testuser@example.com
   - **Password:** Test123!@#
3. Click "Sign In"

**Expected Result:**
- ✅ Loading spinner appears
- ✅ Redirect to main application (/)
- ✅ User is authenticated
- ✅ Access token stored in localStorage
- ✅ Refresh token stored in cookie (HttpOnly)

**Verification:**
```javascript
// Open browser DevTools → Console
localStorage.getItem('accessToken')  // Should return JWT token
document.cookie  // Should show refresh token cookie
```

---

### ✅ Test 3: Protected Routes

**Steps:**
1. After login, you should be on main app
2. Try to access http://localhost:5173/auth/login again

**Expected Result:**
- ✅ Should redirect to main app (already authenticated)

**Test Logout:**
1. Click logout button in app
2. Should redirect to /auth/login
3. Try accessing http://localhost:5173/
4. Should redirect to /auth/login (not authenticated)

---

### ✅ Test 4: Form Validation

**Registration Page:**
1. Try submitting empty form
   - ✅ Should show "Name is required"
   - ✅ Should show "Email is required"
   - ✅ Should show "Password is required"

2. Try invalid email: "notanemail"
   - ✅ Should show "Invalid email format"

3. Try weak password: "test"
   - ✅ Should show "Password must be at least 8 characters"
   - ✅ Should show "Must contain uppercase, lowercase, and number"

4. Try mismatched passwords:
   - Password: Test123!@#
   - Confirm: Test456!@#
   - ✅ Should show "Passwords do not match"

5. Watch password strength indicator:
   - "test" → RED (weak)
   - "Test1234" → YELLOW (medium)
   - "Test123!@#" → GREEN (strong)

**Login Page:**
1. Try empty form
   - ✅ Should show validation errors

2. Try invalid credentials
   - ✅ Should show "Invalid email or password"

---

### ✅ Test 5: Forgot Password

**Steps:**
1. Navigate to http://localhost:5173/auth/forgot-password
2. Enter email: testuser@example.com
3. Click "Send Reset Instructions"

**Expected Result:**
- ✅ Success page appears
- ✅ "Check Your Email" message
- ✅ Shows email address
- ✅ "Back to Login" button works

**Note:** Email not actually sent (SMTP not configured), but endpoint works.

---

### ✅ Test 6: Token Refresh (Automatic)

**Steps:**
1. Login to application
2. Wait 15 minutes (access token expires)
3. Make any API call

**Expected Result:**
- ✅ Token automatically refreshed
- ✅ No logout/redirect
- ✅ Seamless experience

**Manual Test:**
```javascript
// In browser console after login
// Delete access token to simulate expiry
localStorage.removeItem('accessToken');

// Try to access protected endpoint
fetch('http://localhost:3000/api/auth/me', {
  headers: { 'Authorization': 'Bearer invalid' }
});

// Should trigger auto-refresh and work
```

---

### ✅ Test 7: Security Features

**Test Account Lockout:**
1. Try logging in with wrong password 5 times
2. On 6th attempt:
   - ✅ Should show "Account locked" message
   - ✅ Wait 15 minutes or check database

**Test Rate Limiting:**
1. Try registering multiple accounts quickly
2. Should see "Too many registration attempts"

**Test XSS Protection:**
1. Try entering `<script>alert('xss')</script>` in name field
2. Should be sanitized/escaped

---

## 🔧 Backend API Testing (PowerShell)

### Test Health Endpoint
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/health" -Method Get
```

### Test Registration
```powershell
$body = @{
    email = "newuser@example.com"
    password = "Test123!@#"
    confirmPassword = "Test123!@#"
    name = "New User"
} | ConvertTo-Json

Invoke-RestMethod -Uri "http://localhost:3000/api/auth/register" `
    -Method Post `
    -ContentType "application/json" `
    -Body $body
```

### Test Login
```powershell
$body = @{
    email = "newuser@example.com"
    password = "Test123!@#"
} | ConvertTo-Json

$response = Invoke-RestMethod -Uri "http://localhost:3000/api/auth/login" `
    -Method Post `
    -ContentType "application/json" `
    -Body $body

$accessToken = $response.data.accessToken
Write-Host "Access Token: $accessToken"
```

### Test Get Current User
```powershell
$headers = @{
    "Authorization" = "Bearer $accessToken"
}

Invoke-RestMethod -Uri "http://localhost:3000/api/auth/me" `
    -Method Get `
    -Headers $headers
```

### Test Logout
```powershell
Invoke-RestMethod -Uri "http://localhost:3000/api/auth/logout" `
    -Method Post `
    -Headers $headers
```

---

## 🐛 Troubleshooting

### Issue: Backend not starting
**Solution:**
```bash
cd backend
npm install
npx prisma generate
npm run dev
```

### Issue: Frontend not connecting to backend
**Check:**
1. `.env` file has `VITE_API_URL=http://localhost:3000`
2. Backend is running on port 3000
3. No CORS errors in browser console

### Issue: "Network Error" on login
**Solution:**
1. Check backend is running: http://localhost:3000/api/health
2. Check browser console for CORS errors
3. Verify `.env` configuration

### Issue: Token refresh not working
**Check:**
1. Refresh token cookie is set (check DevTools → Application → Cookies)
2. Cookie domain matches (localhost)
3. Backend refresh endpoint working

### Issue: Can't register new users
**Possible causes:**
1. Rate limiting (wait a few minutes)
2. Email already exists (use different email)
3. Database connection issue (check backend logs)

---

## 📊 Database Verification

### View Users
```bash
cd backend
npx prisma studio
```
Navigate to: http://localhost:5555

**Check:**
- User table has entries
- Passwords are hashed (bcrypt)
- Timestamps are correct
- Email verified status

### View Audit Logs
In Prisma Studio:
- Navigate to AuditLog table
- Should see LOGIN, LOGOUT, REGISTER events
- IP addresses logged
- Timestamps correct

### View Refresh Tokens
In Prisma Studio:
- Navigate to RefreshToken table
- Should see active tokens
- Expiry dates set correctly
- Revoked tokens marked

---

## ✅ Final Verification Checklist

### Backend
- [ ] Server running on port 3000
- [ ] Health endpoint responds
- [ ] Database connected
- [ ] All 8 tables created
- [ ] Prisma Client generated

### Frontend
- [ ] Server running on port 5173
- [ ] Environment variables configured
- [ ] Can access /auth/login
- [ ] Can access /auth/register
- [ ] Can access /auth/forgot-password

### User Lifecycle
- [ ] Can register new user
- [ ] Registration shows success message
- [ ] Redirects to login after registration
- [ ] Can login with credentials
- [ ] Redirects to main app after login
- [ ] Protected routes work
- [ ] Can access user profile
- [ ] Can logout
- [ ] Logout redirects to login

### Security
- [ ] Passwords are hashed
- [ ] Tokens expire correctly
- [ ] Token refresh works
- [ ] Account lockout after failed attempts
- [ ] Rate limiting active
- [ ] Audit logs created
- [ ] HttpOnly cookies for refresh token

### UI/UX
- [ ] Form validation works
- [ ] Error messages display
- [ ] Success messages display
- [ ] Loading states show
- [ ] Password strength indicator works
- [ ] Responsive design
- [ ] No console errors

---

## 🎯 Next Steps After Testing

### If Everything Works ✅
1. Test with multiple users
2. Test concurrent sessions
3. Test on different browsers
4. Configure email service (SMTP)
5. Add profile management
6. Deploy to staging

### If Issues Found ❌
1. Check browser console for errors
2. Check backend logs
3. Verify database connection
4. Check `.env` configuration
5. Review error messages
6. Consult `AUTH_SYSTEM_STATUS.md`

---

## 📞 Support

**Documentation:**
- `docs/AUTH_SYSTEM_STATUS.md` - Complete system status
- `docs/FRONTEND_INTEGRATION.md` - Frontend integration guide
- `docs/ARCHITECTURE_ANALYSIS.md` - Architecture recommendations

**Testing Scripts:**
- `backend/scripts/test-auth-complete.ps1` - Complete backend test
- `backend/scripts/test-backend.ps1` - Quick backend test

**Database:**
- Prisma Studio: `cd backend && npx prisma studio`
- Schema: `backend/prisma/schema.prisma`

---

## 🎉 Success Criteria

**System is ready when:**
1. ✅ User can register
2. ✅ User can login
3. ✅ User can access protected routes
4. ✅ User can logout
5. ✅ Tokens refresh automatically
6. ✅ Security features work
7. ✅ No console errors
8. ✅ Database records created
9. ✅ Audit logs generated
10. ✅ All endpoints respond correctly

**Current Status: READY FOR TESTING** 🚀
