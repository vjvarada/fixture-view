/**
 * Email Configuration
 * 
 * Centralized email settings for SMTP and email templates.
 * Supports multiple providers: Gmail, SendGrid, Custom SMTP
 */

export const emailConfig = {
  // SMTP Configuration
  smtp: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER || '',
      pass: process.env.SMTP_PASS || '',
    },
  },

  // Email Sender Info
  from: {
    name: process.env.EMAIL_FROM_NAME || 'RapidTool-Fixture',
    address: process.env.EMAIL_FROM_ADDRESS || process.env.SMTP_USER || 'noreply@rapidtool-fixture.com',
  },

  // Application URLs
  appUrl: process.env.APP_URL || 'http://localhost:8080',

  // Email Templates
  templates: {
    verification: {
      subject: 'Verify Your Email - RapidTool-Fixture',
    },
    passwordReset: {
      subject: 'Reset Your Password - RapidTool-Fixture',
    },
    welcome: {
      subject: 'Welcome to RapidTool-Fixture!',
    },
  },
};

/**
 * Validate email configuration
 */
export function validateEmailConfig(): void {
  if (process.env.NODE_ENV === 'production') {
    const requiredVars = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM_ADDRESS'];
    const missing = requiredVars.filter(varName => !process.env[varName]);
    
    if (missing.length > 0) {
      console.warn(
        `⚠️  Missing email environment variables: ${missing.join(', ')}. Email functionality will be disabled.`
      );
    }
  }
}
