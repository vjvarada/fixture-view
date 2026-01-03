/**
 * Authentication Routes
 * 
 * Defines all auth-related endpoints with rate limiting and middleware.
 */

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  register,
  login,
  refresh,
  logout,
  verify,
  resendVerification,
  requestReset,
  resetPass,
  getCurrentUser,
} from '../controllers/auth.controller';
import { authenticateToken } from '../middleware/auth.middleware';
import { authConfig } from '../config/auth.config';

const router = Router();

// Rate limiters for different endpoints
const loginLimiter = rateLimit(authConfig.rateLimit.login);
const registerLimiter = rateLimit(authConfig.rateLimit.register);
const resetLimiter = rateLimit(authConfig.rateLimit.resetRequest);

/**
 * Public routes (no authentication required)
 */

// POST /api/auth/register - Register new user
router.post('/register', registerLimiter, register);

// POST /api/auth/login - Login with email/password
router.post('/login', loginLimiter, login);

// POST /api/auth/refresh - Refresh access token
router.post('/refresh', refresh);

// GET /api/auth/verify?token=xxx - Verify email
router.get('/verify', verify);

// POST /api/auth/resend-verification - Resend verification email
router.post('/resend-verification', resetLimiter, resendVerification);

// POST /api/auth/request-reset - Request password reset
router.post('/request-reset', resetLimiter, requestReset);

// POST /api/auth/reset - Reset password with token
router.post('/reset', resetPass);

/**
 * Protected routes (authentication required)
 */

// POST /api/auth/logout - Logout and revoke refresh token
router.post('/logout', authenticateToken, logout);

// GET /api/auth/me - Get current user info
router.get('/me', authenticateToken, getCurrentUser);

export default router;
