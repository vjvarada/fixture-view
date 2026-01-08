/**
 * Authentication Configuration
 * 
 * Centralized auth settings for JWT tokens, password policies, and security parameters.
 * All values are loaded from environment variables with secure defaults.
 */

export const authConfig = {
  // JWT Configuration
  jwt: {
    // Access token: short-lived, stored in memory on client
    accessToken: {
      secret: process.env.JWT_ACCESS_SECRET || 'change-this-in-production-access-secret',
      expiresIn: process.env.JWT_ACCESS_EXPIRES || '15m', // 15 minutes
      algorithm: 'HS256' as const,
    },
    
    // Refresh token: long-lived, stored in HttpOnly cookie
    refreshToken: {
      secret: process.env.JWT_REFRESH_SECRET || 'change-this-in-production-refresh-secret',
      expiresIn: process.env.JWT_REFRESH_EXPIRES || '7d', // 7 days
      algorithm: 'HS256' as const,
      cookieName: 'refresh_token',
      cookieOptions: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production', // HTTPS only in production
        sameSite: 'strict' as const,
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days in milliseconds
        path: '/api/auth',
      },
    },
  },

  // Password Policy
  password: {
    minLength: 8,
    requireUppercase: true,
    requireLowercase: true,
    requireNumbers: true,
    requireSpecialChars: true,
    bcryptRounds: 12, // Salt rounds for bcrypt hashing
  },

  // Account Security
  security: {
    maxLoginAttempts: 5,
    lockoutDuration: 15 * 60 * 1000, // 15 minutes in milliseconds
    verificationTokenExpiry: 24 * 60 * 60 * 1000, // 24 hours
    passwordResetExpiry: 1 * 60 * 60 * 1000, // 1 hour
  },

  // Email Configuration
  email: {
    from: process.env.EMAIL_FROM || 'noreply@rapidtool-fixture.com',
    verificationSubject: 'Verify your RapidTool-Fixture account',
    resetSubject: 'Reset your RapidTool-Fixture password',
  },

  // Rate Limiting
  rateLimit: {
    // Login endpoint
    login: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 5, // 5 attempts per window
      message: 'Too many login attempts, please try again later',
    },
    
    // Registration endpoint
    register: {
      windowMs: 60 * 60 * 1000, // 1 hour
      max: 3, // 3 registrations per hour per IP
      message: 'Too many registration attempts, please try again later',
    },
    
    // Password reset request
    resetRequest: {
      windowMs: 60 * 60 * 1000, // 1 hour
      max: 3, // 3 reset requests per hour
      message: 'Too many password reset requests, please try again later',
    },
  },
};

/**
 * Validate that required environment variables are set in production
 */
export function validateAuthConfig(): void {
  if (process.env.NODE_ENV === 'production') {
    const requiredVars = [
      'JWT_ACCESS_SECRET',
      'JWT_REFRESH_SECRET',
      'DATABASE_URL',
    ];

    const missing = requiredVars.filter(varName => !process.env[varName]);
    
    if (missing.length > 0) {
      throw new Error(
        `Missing required environment variables in production: ${missing.join(', ')}`
      );
    }

    // Warn about default secrets
    if (
      process.env.JWT_ACCESS_SECRET?.includes('change-this') ||
      process.env.JWT_REFRESH_SECRET?.includes('change-this')
    ) {
      throw new Error('Default JWT secrets detected in production. Please set secure secrets.');
    }
  }
}
