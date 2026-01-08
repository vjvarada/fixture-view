/**
 * JWT Token Utility Functions
 * 
 * Handles JWT token generation, verification, and refresh token management.
 */

import jwt, { SignOptions } from 'jsonwebtoken';
import crypto from 'crypto';
import { authConfig } from '../config/auth.config';

export interface JWTPayload {
  userId: string;
  email: string;
  iat?: number;
  exp?: number;
}

/**
 * Generate an access token (short-lived, stored in memory)
 * @param payload - User data to encode in token
 * @returns Signed JWT access token
 */
export function generateAccessToken(payload: { userId: string; email: string }): string {
  const options: SignOptions = {
    expiresIn: '15m',
    algorithm: 'HS256',
  };
  
  return jwt.sign(payload, authConfig.jwt.accessToken.secret, options as any);
}

/**
 * Generate a refresh token (long-lived, stored in HttpOnly cookie)
 * @returns Object with raw token and hashed token for database storage
 */
export function generateRefreshToken(): { token: string; tokenHash: string } {
  // Generate a cryptographically secure random token
  const token = crypto.randomBytes(64).toString('hex');
  
  // Hash the token before storing in database (prevents token theft if DB is compromised)
  const tokenHash = crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');

  return { token, tokenHash };
}

/**
 * Hash a refresh token for database storage
 * @param token - Raw refresh token
 * @returns Hashed token
 */
export function hashRefreshToken(token: string): string {
  return crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');
}

/**
 * Verify and decode an access token
 * @param token - JWT access token
 * @returns Decoded payload or null if invalid
 */
export function verifyAccessToken(token: string): JWTPayload | null {
  try {
    const decoded = jwt.verify(
      token,
      authConfig.jwt.accessToken.secret,
      { algorithms: [authConfig.jwt.accessToken.algorithm] }
    ) as JWTPayload;
    
    return decoded;
  } catch (error) {
    // Token is invalid, expired, or malformed
    return null;
  }
}

/**
 * Calculate expiry date for refresh token
 * @returns Date object representing token expiry
 */
export function getRefreshTokenExpiry(): Date {
  const expiresIn = authConfig.jwt.refreshToken.expiresIn;
  const match = expiresIn.match(/^(\d+)([dhms])$/);
  
  if (!match) {
    throw new Error('Invalid refresh token expiry format');
  }

  const [, value, unit] = match;
  const now = new Date();
  const numValue = parseInt(value, 10);

  switch (unit) {
    case 'd':
      return new Date(now.getTime() + numValue * 24 * 60 * 60 * 1000);
    case 'h':
      return new Date(now.getTime() + numValue * 60 * 60 * 1000);
    case 'm':
      return new Date(now.getTime() + numValue * 60 * 1000);
    case 's':
      return new Date(now.getTime() + numValue * 1000);
    default:
      throw new Error('Invalid time unit');
  }
}

/**
 * Generate a verification token for email verification
 * @returns Secure random token
 */
export function generateVerificationToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Generate a password reset token
 * @returns Object with raw token and hashed token
 */
export function generatePasswordResetToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');

  return { token, tokenHash };
}
