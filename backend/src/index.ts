import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import authRoutes from './routes/auth.routes';
import { validateAuthConfig } from './config/auth.config';

dotenv.config();

// Validate auth configuration in production
validateAuthConfig();

const app = express();

// Security middleware
app.use(helmet());
app.use(cors({ 
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true, // Allow cookies to be sent
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(morgan('combined'));

// Health check endpoint
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// Auth routes
app.use('/api/auth', authRoutes);

// Placeholder upload route: returns a signed-url stub or job id
app.post('/api/models/upload', (req, res) => {
  // Expecting client to send metadata; actual upload should go to S3 with signed URL
  const { filename, size } = req.body || {};
  if (!filename || !size) {
    return res.status(400).json({ error: 'filename and size are required' });
  }

  // TODO: create job in queue, generate signed URL, persist metadata
  const uploadId = `upl_${Date.now()}`;
  return res.json({ uploadId, uploadUrl: `https://example-s3-signed-url/${filename}` });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Backend listening on port ${port}`);
});

export default app;
