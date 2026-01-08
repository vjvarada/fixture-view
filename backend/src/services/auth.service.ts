/**
 * Authentication Service
 * 
 * Core business logic for user authentication, registration, and token management.
 */

import { PrismaClient } from '@prisma/client';
import { hashPassword, comparePassword } from '../utils/password.util';
import {
  generateAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  getRefreshTokenExpiry,
  generateVerificationToken,
  generatePasswordResetToken,
} from '../utils/jwt.util';
import { authConfig } from '../config/auth.config';
import { sendVerificationEmail, sendPasswordResetEmail, sendWelcomeEmail } from './email.service';

const prisma = new PrismaClient();

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface UserResponse {
  id: string;
  email: string;
  emailVerified: boolean;
  createdAt: Date;
}

/**
 * Register a new user
 */
export async function registerUser(email: string, password: string, name?: string): Promise<{
  user: UserResponse;
  verificationToken: string;
}> {
  // Check if user already exists
  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  if (existingUser) {
    throw new Error('User with this email already exists');
  }

  // Hash password
  const passwordHash = await hashPassword(password);

  // Generate email verification token
  const verificationToken = generateVerificationToken();

  // Create user
  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      verificationToken,
      emailVerified: false,
      name: name || null,
    },
    select: {
      id: true,
      email: true,
      emailVerified: true,
      createdAt: true,
    },
  });

  // Send verification email
  try {
    await sendVerificationEmail(email, verificationToken);
  } catch (error) {
    console.error('Failed to send verification email:', error);
    // Don't fail registration if email fails
  }

  return { user, verificationToken };
}

/**
 * Login user with email and password
 */
export async function loginUser(
  email: string,
  password: string,
  ipAddress?: string
): Promise<{
  user: UserResponse;
  tokens: AuthTokens;
}> {
  // Find user
  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    throw new Error('Invalid email or password');
  }

  // Check if account is locked
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const remainingMinutes = Math.ceil(
      (user.lockedUntil.getTime() - Date.now()) / 60000
    );
    throw new Error(`Account is locked. Try again in ${remainingMinutes} minutes`);
  }

  // Verify password
  const isPasswordValid = await comparePassword(password, user.passwordHash);

  if (!isPasswordValid) {
    // Increment failed attempts
    const failedAttempts = user.failedLoginAttempts + 1;
    const updateData: any = { failedLoginAttempts: failedAttempts };

    // Lock account if max attempts reached
    if (failedAttempts >= authConfig.security.maxLoginAttempts) {
      updateData.lockedUntil = new Date(
        Date.now() + authConfig.security.lockoutDuration
      );
    }

    await prisma.user.update({
      where: { id: user.id },
      data: updateData,
    });

    throw new Error('Invalid email or password');
  }

  // Reset failed attempts and update last login
  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
    },
  });

  // Generate tokens
  const accessToken = generateAccessToken({
    userId: user.id,
    email: user.email,
  });

  const { token: refreshToken, tokenHash } = generateRefreshToken();

  // Store refresh token in database
  await prisma.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt: getRefreshTokenExpiry(),
    },
  });

  // Log audit event
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: 'LOGIN',
      resource: 'auth',
      status: 'success',
      ipAddress,
      metadata: { email },
    },
  });

  return {
    user: {
      id: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
      createdAt: user.createdAt,
    },
    tokens: {
      accessToken,
      refreshToken,
    },
  };
}

/**
 * Refresh access token using refresh token
 */
export async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken: string;
}> {
  const tokenHash = hashRefreshToken(refreshToken);

  // Find refresh token in database
  const storedToken = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });

  if (!storedToken) {
    throw new Error('Invalid refresh token');
  }

  // Check if token is expired
  if (storedToken.expiresAt < new Date()) {
    throw new Error('Refresh token expired');
  }

  // Check if token is revoked
  if (storedToken.revoked) {
    // Possible token reuse attack - revoke all user tokens
    await prisma.refreshToken.updateMany({
      where: { userId: storedToken.userId },
      data: { revoked: true },
    });
    throw new Error('Refresh token has been revoked');
  }

  // Generate new tokens (rotation)
  const newAccessToken = generateAccessToken({
    userId: storedToken.user.id,
    email: storedToken.user.email,
  });

  const { token: newRefreshToken, tokenHash: newTokenHash } = generateRefreshToken();

  // Revoke old refresh token and create new one
  await prisma.$transaction([
    prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: {
        revoked: true,
        replacedByToken: newTokenHash,
      },
    }),
    prisma.refreshToken.create({
      data: {
        userId: storedToken.userId,
        tokenHash: newTokenHash,
        expiresAt: getRefreshTokenExpiry(),
      },
    }),
  ]);

  return {
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
  };
}

/**
 * Logout user by revoking refresh token
 */
export async function logoutUser(refreshToken: string, userId: string): Promise<void> {
  const tokenHash = hashRefreshToken(refreshToken);

  await prisma.refreshToken.updateMany({
    where: {
      tokenHash,
      userId,
    },
    data: {
      revoked: true,
    },
  });

  // Log audit event
  await prisma.auditLog.create({
    data: {
      userId,
      action: 'LOGOUT',
      resource: 'auth',
      status: 'success',
    },
  });
}

/**
 * Verify user email
 */
export async function verifyEmail(token: string): Promise<UserResponse> {
  const user = await prisma.user.findFirst({
    where: { verificationToken: token },
  });

  if (!user) {
    throw new Error('Invalid verification token');
  }

  if (user.emailVerified) {
    throw new Error('Email already verified');
  }

  const updatedUser = await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerified: true,
      verificationToken: null,
    },
    select: {
      id: true,
      email: true,
      emailVerified: true,
      createdAt: true,
      name: true,
    },
  });

  // Send welcome email after successful verification
  try {
    await sendWelcomeEmail(updatedUser.email, updatedUser.name || undefined);
  } catch (error) {
    console.error('Failed to send welcome email:', error);
    // Don't fail verification if welcome email fails
  }

  return updatedUser;
}

/**
 * Resend email verification token
 */
export async function resendVerificationEmail(email: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    throw new Error('User not found');
  }

  if (user.emailVerified) {
    throw new Error('Email already verified');
  }

  // Generate new verification token
  const verificationToken = generateVerificationToken();
  const verificationTokenExpiry = new Date(Date.now() + authConfig.security.verificationTokenExpiry);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      verificationToken,
      verificationTokenExpiry,
    },
  });

  // Send verification email
  try {
    await sendVerificationEmail(email, verificationToken);
  } catch (error) {
    console.error('Failed to resend verification email:', error);
    throw new Error('Failed to send verification email');
  }

  return verificationToken;
}

/**
 * Request password reset
 */
export async function requestPasswordReset(email: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { email },
  });

  if (!user) {
    // Don't reveal if user exists - return success anyway
    return '';
  }

  const { token, tokenHash } = generatePasswordResetToken();
  const passwordResetExpiry = new Date(
    Date.now() + authConfig.security.passwordResetExpiry
  );

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordResetToken: tokenHash,
      passwordResetExpiry,
    },
  });

  // Send password reset email
  try {
    await sendPasswordResetEmail(user.email, token);
  } catch (error) {
    console.error('Failed to send password reset email:', error);
    // Don't throw error - we don't want to reveal if user exists
  }

  return token;
}

/**
 * Reset password using reset token
 */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const tokenHash = hashRefreshToken(token);

  const user = await prisma.user.findFirst({
    where: {
      passwordResetToken: tokenHash,
      passwordResetExpiry: {
        gt: new Date(),
      },
    },
  });

  if (!user) {
    throw new Error('Invalid or expired reset token');
  }

  const passwordHash = await hashPassword(newPassword);

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      passwordResetToken: null,
      passwordResetExpiry: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
    },
  });

  // Revoke all refresh tokens for security
  await prisma.refreshToken.updateMany({
    where: { userId: user.id },
    data: { revoked: true },
  });
}

/**
 * Clean up expired refresh tokens (should be run periodically)
 */
export async function cleanupExpiredTokens(): Promise<number> {
  const result = await prisma.refreshToken.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date() } },
        { revoked: true },
      ],
    },
  });

  return result.count;
}
