/**
 * Email Service
 * 
 * Handles sending emails using Nodemailer with support for multiple providers.
 * Includes email templates for verification, password reset, and welcome emails.
 */

import nodemailer, { Transporter } from 'nodemailer';
import { emailConfig } from '../config/email.config';

let transporter: Transporter | null = null;

/**
 * Initialize email transporter
 */
function getTransporter(): Transporter {
  if (!transporter) {
    // Check if email is configured
    if (!emailConfig.smtp.auth.user || !emailConfig.smtp.auth.pass) {
      console.warn('⚠️  Email not configured. Emails will be logged to console instead.');
      // Create a test account for development
      transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        secure: false,
        auth: {
          user: 'test@ethereal.email',
          pass: 'test',
        },
      });
    } else {
      transporter = nodemailer.createTransport({
        host: emailConfig.smtp.host,
        port: emailConfig.smtp.port,
        secure: emailConfig.smtp.secure,
        auth: {
          user: emailConfig.smtp.auth.user,
          pass: emailConfig.smtp.auth.pass,
        },
      });
    }
  }
  return transporter;
}

/**
 * Send email verification email
 */
export async function sendVerificationEmail(
  email: string,
  verificationToken: string
): Promise<void> {
  const verificationUrl = `${emailConfig.appUrl}/auth/verify?token=${verificationToken}`;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .button { display: inline-block; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
        .token { background: #e9ecef; padding: 10px; border-radius: 5px; font-family: monospace; word-break: break-all; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🔧 RapidTool-Fixture</h1>
          <p>Verify Your Email Address</p>
        </div>
        <div class="content">
          <h2>Welcome!</h2>
          <p>Thank you for registering with RapidTool-Fixture. To complete your registration and start designing fixtures, please verify your email address.</p>
          
          <p style="text-align: center;">
            <a href="${verificationUrl}" class="button">Verify Email Address</a>
          </p>
          
          <p>Or copy and paste this link into your browser:</p>
          <div class="token">${verificationUrl}</div>
          
          <p><strong>This link will expire in 24 hours.</strong></p>
          
          <p>If you didn't create an account with RapidTool-Fixture, you can safely ignore this email.</p>
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} RapidTool-Fixture. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const textContent = `
    Welcome to RapidTool-Fixture!
    
    Thank you for registering. To complete your registration, please verify your email address by clicking the link below:
    
    ${verificationUrl}
    
    This link will expire in 24 hours.
    
    If you didn't create an account with RapidTool-Fixture, you can safely ignore this email.
    
    © ${new Date().getFullYear()} RapidTool-Fixture
  `;

  try {
    const info = await getTransporter().sendMail({
      from: `"${emailConfig.from.name}" <${emailConfig.from.address}>`,
      to: email,
      subject: emailConfig.templates.verification.subject,
      text: textContent,
      html: htmlContent,
    });

    console.log('✅ Verification email sent:', info.messageId);
    if (process.env.NODE_ENV === 'development') {
      console.log('📧 Preview URL:', nodemailer.getTestMessageUrl(info));
    }
  } catch (error) {
    console.error('❌ Failed to send verification email:', error);
    // In development, log the verification URL
    if (process.env.NODE_ENV === 'development') {
      console.log('🔗 Verification URL (email failed):', verificationUrl);
    }
    throw new Error('Failed to send verification email');
  }
}

/**
 * Send password reset email
 */
export async function sendPasswordResetEmail(
  email: string,
  resetToken: string
): Promise<void> {
  const resetUrl = `${emailConfig.appUrl}/auth/reset-password?token=${resetToken}`;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .button { display: inline-block; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
        .token { background: #e9ecef; padding: 10px; border-radius: 5px; font-family: monospace; word-break: break-all; }
        .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🔧 RapidTool-Fixture</h1>
          <p>Password Reset Request</p>
        </div>
        <div class="content">
          <h2>Reset Your Password</h2>
          <p>We received a request to reset your password. Click the button below to create a new password:</p>
          
          <p style="text-align: center;">
            <a href="${resetUrl}" class="button">Reset Password</a>
          </p>
          
          <p>Or copy and paste this link into your browser:</p>
          <div class="token">${resetUrl}</div>
          
          <div class="warning">
            <strong>⚠️ Security Notice:</strong>
            <ul style="margin: 10px 0;">
              <li>This link will expire in 1 hour</li>
              <li>If you didn't request this reset, please ignore this email</li>
              <li>Your password will remain unchanged until you create a new one</li>
            </ul>
          </div>
          
          <p>If you're having trouble, contact our support team.</p>
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} RapidTool-Fixture. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const textContent = `
    Password Reset Request - RapidTool-Fixture
    
    We received a request to reset your password. Click the link below to create a new password:
    
    ${resetUrl}
    
    This link will expire in 1 hour.
    
    If you didn't request this reset, please ignore this email. Your password will remain unchanged.
    
    © ${new Date().getFullYear()} RapidTool-Fixture
  `;

  try {
    const info = await getTransporter().sendMail({
      from: `"${emailConfig.from.name}" <${emailConfig.from.address}>`,
      to: email,
      subject: emailConfig.templates.passwordReset.subject,
      text: textContent,
      html: htmlContent,
    });

    console.log('✅ Password reset email sent:', info.messageId);
    if (process.env.NODE_ENV === 'development') {
      console.log('📧 Preview URL:', nodemailer.getTestMessageUrl(info));
    }
  } catch (error) {
    console.error('❌ Failed to send password reset email:', error);
    // In development, log the reset URL
    if (process.env.NODE_ENV === 'development') {
      console.log('🔗 Reset URL (email failed):', resetUrl);
    }
    throw new Error('Failed to send password reset email');
  }
}

/**
 * Send welcome email after successful verification
 */
export async function sendWelcomeEmail(email: string, name?: string): Promise<void> {
  const displayName = name || email.split('@')[0];
  const loginUrl = `${emailConfig.appUrl}/auth/login`;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
        .button { display: inline-block; padding: 12px 30px; background: #667eea; color: white; text-decoration: none; border-radius: 5px; margin: 20px 0; }
        .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
        .features { background: white; padding: 20px; border-radius: 5px; margin: 20px 0; }
        .feature { margin: 15px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🎉 Welcome to RapidTool-Fixture!</h1>
        </div>
        <div class="content">
          <h2>Hi ${displayName}!</h2>
          <p>Your email has been verified and your account is now active. You're ready to start designing custom fixtures!</p>
          
          <div class="features">
            <h3>🚀 What You Can Do:</h3>
            <div class="feature">✅ Import STL, STEP, and 3MF files</div>
            <div class="feature">✅ Design custom baseplates and supports</div>
            <div class="feature">✅ Add clamps and mounting holes</div>
            <div class="feature">✅ Create cavity fixtures</div>
            <div class="feature">✅ Export for 3D printing</div>
          </div>
          
          <p style="text-align: center;">
            <a href="${loginUrl}" class="button">Start Designing</a>
          </p>
          
          <p>If you have any questions or need help, don't hesitate to reach out to our support team.</p>
        </div>
        <div class="footer">
          <p>© ${new Date().getFullYear()} RapidTool-Fixture. All rights reserved.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const textContent = `
    Welcome to RapidTool-Fixture!
    
    Hi ${displayName}!
    
    Your email has been verified and your account is now active. You're ready to start designing custom fixtures!
    
    What You Can Do:
    - Import STL, STEP, and 3MF files
    - Design custom baseplates and supports
    - Add clamps and mounting holes
    - Create cavity fixtures
    - Export for 3D printing
    
    Start designing: ${loginUrl}
    
    If you have any questions, contact our support team.
    
    © ${new Date().getFullYear()} RapidTool-Fixture
  `;

  try {
    const info = await getTransporter().sendMail({
      from: `"${emailConfig.from.name}" <${emailConfig.from.address}>`,
      to: email,
      subject: emailConfig.templates.welcome.subject,
      text: textContent,
      html: htmlContent,
    });

    console.log('✅ Welcome email sent:', info.messageId);
    if (process.env.NODE_ENV === 'development') {
      console.log('📧 Preview URL:', nodemailer.getTestMessageUrl(info));
    }
  } catch (error) {
    console.error('❌ Failed to send welcome email:', error);
    // Don't throw error for welcome email - it's not critical
  }
}
