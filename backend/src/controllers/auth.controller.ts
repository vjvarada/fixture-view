/**
 * Authentication Controller
 * 
 * HTTP request handlers for authentication endpoints.
 * Handles registration, login, logout, token refresh, email verification, and password reset.
 */

import { Request, Response } from 'express';
import {
  registerUser,
  loginUser,
  refreshAccessToken,
  logoutUser,
  verifyEmail,
  resendVerificationEmail,
  requestPasswordReset,
  resetPassword,
} from '../services/auth.service';
import {
  registerSchema,
  loginSchema,
  resetRequestSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '../validators/auth.validator';
import { authConfig } from '../config/auth.config';
import { ZodError } from 'zod';

/**
 * Handle validation errors from Zod
 */
function handleValidationError(error: ZodError, res: Response): void {
  const errors = error.errors.map((err) => ({
    field: err.path.join('.'),
    message: err.message,
  }));

  res.status(400).json({
    success: false,
    error: 'Validation failed',
    details: errors,
  });
}

/**
 * POST /api/auth/register
 * Register a new user account
 */
export async function register(req: Request, res: Response): Promise<void> {
  try {
    // Validate request body
    const validatedData = registerSchema.parse(req.body);

    // Register user
    const { user, verificationToken } = await registerUser(
      validatedData.email,
      validatedData.password,
      validatedData.name
    );

    // Verification email sent via email service

    res.status(201).json({
      success: true,
      message: 'Registration successful. Please check your email to verify your account.',
      data: {
        user: {
          id: user.id,
          email: user.email,
          emailVerified: user.emailVerified,
        },
        // Remove this in production - verification token should only be sent via email
        verificationToken: process.env.NODE_ENV === 'development' ? verificationToken : undefined,
      },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      handleValidationError(error, res);
      return;
    }

    if (error instanceof Error) {
      if (error.message.includes('already exists')) {
        res.status(409).json({
          success: false,
          error: error.message,
        });
        return;
      }
    }

    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      error: 'Registration failed',
    });
  }
}

/**
 * POST /api/auth/login
 * Login with email and password
 */
export async function login(req: Request, res: Response): Promise<void> {
  try {
    // Validate request body
    const validatedData = loginSchema.parse(req.body);

    // Get IP address for audit logging
    const ipAddress = req.ip || req.socket.remoteAddress;

    // Login user
    const { user, tokens } = await loginUser(
      validatedData.email,
      validatedData.password,
      ipAddress
    );

    // Set refresh token in HttpOnly cookie
    res.cookie(
      authConfig.jwt.refreshToken.cookieName,
      tokens.refreshToken,
      authConfig.jwt.refreshToken.cookieOptions
    );

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        user: {
          id: user.id,
          email: user.email,
          emailVerified: user.emailVerified,
        },
        accessToken: tokens.accessToken,
      },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      handleValidationError(error, res);
      return;
    }

    if (error instanceof Error) {
      if (error.message.includes('Invalid email or password')) {
        res.status(401).json({
          success: false,
          error: 'Invalid email or password',
        });
        return;
      }

      if (error.message.includes('locked')) {
        res.status(403).json({
          success: false,
          error: error.message,
        });
        return;
      }
    }

    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      error: 'Login failed',
    });
  }
}

/**
 * POST /api/auth/refresh
 * Refresh access token using refresh token
 */
export async function refresh(req: Request, res: Response): Promise<void> {
  try {
    // Get refresh token from cookie or body
    const refreshToken =
      req.cookies[authConfig.jwt.refreshToken.cookieName] ||
      req.body.refreshToken;

    if (!refreshToken) {
      res.status(401).json({
        success: false,
        error: 'Refresh token required',
      });
      return;
    }

    // Refresh tokens
    const tokens = await refreshAccessToken(refreshToken);

    // Set new refresh token in cookie
    res.cookie(
      authConfig.jwt.refreshToken.cookieName,
      tokens.refreshToken,
      authConfig.jwt.refreshToken.cookieOptions
    );

    res.status(200).json({
      success: true,
      message: 'Token refreshed successfully',
      data: {
        accessToken: tokens.accessToken,
      },
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message.includes('Invalid') || error.message.includes('expired')) {
        res.status(401).json({
          success: false,
          error: error.message,
        });
        return;
      }

      if (error.message.includes('revoked')) {
        res.status(403).json({
          success: false,
          error: 'Refresh token has been revoked. Please login again.',
        });
        return;
      }
    }

    console.error('Token refresh error:', error);
    res.status(500).json({
      success: false,
      error: 'Token refresh failed',
    });
  }
}

/**
 * POST /api/auth/logout
 * Logout user and revoke refresh token
 */
export async function logout(req: Request, res: Response): Promise<void> {
  try {
    const refreshToken = req.cookies[authConfig.jwt.refreshToken.cookieName];
    const userId = req.user?.userId;

    if (refreshToken && userId) {
      await logoutUser(refreshToken, userId);
    }

    // Clear refresh token cookie
    res.clearCookie(
      authConfig.jwt.refreshToken.cookieName,
      authConfig.jwt.refreshToken.cookieOptions
    );

    res.status(200).json({
      success: true,
      message: 'Logout successful',
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({
      success: false,
      error: 'Logout failed',
    });
  }
}

/**
 * GET /api/auth/verify
 * Verify user email with token
 */
export async function verify(req: Request, res: Response): Promise<void> {
  try {
    const validatedData = verifyEmailSchema.parse({
      token: req.query.token,
    });

    const user = await verifyEmail(validatedData.token);

    res.status(200).json({
      success: true,
      message: 'Email verified successfully',
      data: {
        user: {
          id: user.id,
          email: user.email,
          emailVerified: user.emailVerified,
        },
      },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      handleValidationError(error, res);
      return;
    }

    if (error instanceof Error) {
      if (error.message.includes('Invalid') || error.message.includes('already verified')) {
        res.status(400).json({
          success: false,
          error: error.message,
        });
        return;
      }
    }

    console.error('Email verification error:', error);
    res.status(500).json({
      success: false,
      error: 'Email verification failed',
    });
  }
}

/**
 * POST /api/auth/resend-verification
 * Resend email verification link
 */
export async function resendVerification(req: Request, res: Response): Promise<void> {
  try {
    const validatedData = resetRequestSchema.parse(req.body); // Reuse email validation

    const verificationToken = await resendVerificationEmail(validatedData.email);

    // Verification email sent via email service

    res.status(200).json({
      success: true,
      message: 'Verification email sent. Please check your inbox.',
      // Remove this in production - verification token should only be sent via email
      data: process.env.NODE_ENV === 'development' ? { verificationToken } : undefined,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      handleValidationError(error, res);
      return;
    }

    if (error instanceof Error) {
      if (error.message.includes('not found')) {
        res.status(404).json({
          success: false,
          error: 'User not found',
        });
        return;
      }
      if (error.message.includes('already verified')) {
        res.status(400).json({
          success: false,
          error: 'Email already verified',
        });
        return;
      }
    }

    console.error('Resend verification error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to resend verification email',
    });
  }
}

/**
 * POST /api/auth/request-reset
 * Request password reset email
 */
export async function requestReset(req: Request, res: Response): Promise<void> {
  try {
    const validatedData = resetRequestSchema.parse(req.body);

    const resetToken = await requestPasswordReset(validatedData.email);

    // Password reset email sent via email service

    // Always return success to prevent email enumeration
    res.status(200).json({
      success: true,
      message: 'If an account exists with this email, a password reset link has been sent.',
      // Remove this in production - reset token should only be sent via email
      data: process.env.NODE_ENV === 'development' && resetToken ? { resetToken } : undefined,
    });
  } catch (error) {
    if (error instanceof ZodError) {
      handleValidationError(error, res);
      return;
    }

    console.error('Password reset request error:', error);
    res.status(500).json({
      success: false,
      error: 'Password reset request failed',
    });
  }
}

/**
 * POST /api/auth/reset
 * Reset password using reset token
 */
export async function resetPass(req: Request, res: Response): Promise<void> {
  try {
    const validatedData = resetPasswordSchema.parse(req.body);

    await resetPassword(validatedData.token, validatedData.password);

    res.status(200).json({
      success: true,
      message: 'Password reset successful. Please login with your new password.',
    });
  } catch (error) {
    if (error instanceof ZodError) {
      handleValidationError(error, res);
      return;
    }

    if (error instanceof Error) {
      if (error.message.includes('Invalid') || error.message.includes('expired')) {
        res.status(400).json({
          success: false,
          error: 'Invalid or expired reset token',
        });
        return;
      }
    }

    console.error('Password reset error:', error);
    res.status(500).json({
      success: false,
      error: 'Password reset failed',
    });
  }
}

/**
 * GET /api/auth/me
 * Get current authenticated user info
 */
export async function getCurrentUser(req: Request, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: 'Not authenticated',
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        user: req.user,
      },
    });
  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get user info',
    });
  }
}
