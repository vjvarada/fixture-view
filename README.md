# RapidTool-Fixture

**Automated 3D Fixture Designer** - Part of the RapidTool Suite

A web-based application for designing custom manufacturing fixtures with automated support generation, intelligent clamping, and precision tooling features.

---

## 🚀 Quick Start

```bash
# Install dependencies
npm install
cd backend && npm install

# Set up environment
cp backend/.env.example backend/.env
# Edit backend/.env with your database credentials

# Run database migrations
cd backend
npx prisma migrate deploy
npx prisma generate

# Start development servers
npm run dev          # Frontend (http://localhost:8080)
cd backend && npm run dev  # Backend (http://localhost:3000)
```

---

## 🛠️ Tech Stack

### Frontend
- **React 18.3** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool
- **Three.js** - 3D rendering
- **Tailwind CSS** - Styling
- **shadcn/ui** - UI components
- **Zustand** - State management
- **React Router v7** - Routing

### Backend
- **Node.js + Express** - API server
- **TypeScript** - Type safety
- **Prisma ORM** - Database access
- **PostgreSQL** - Database (Supabase)
- **JWT** - Authentication
- **Zod** - Validation
- **Nodemailer** - Email service

---

## 📚 Documentation

Comprehensive documentation is available in the [`docs/`](./docs) directory:

- **[Setup Guide](./docs/SETUP_GUIDE.md)** - Installation and configuration
- **[Architecture](./docs/ARCHITECTURE.md)** - System design and structure
- **[Authentication](./docs/AUTH_SYSTEM.md)** - Auth system documentation
- **[API Documentation](./docs/POSTMAN_API_COLLECTION.md)** - API endpoints and testing
- **[Database Setup](./docs/DATABASE_SETUP.md)** - Database configuration
- **[Testing Guide](./docs/TESTING_GUIDE.md)** - Testing instructions
- **[Frontend Integration](./docs/FRONTEND_INTEGRATION.md)** - Frontend architecture
- **[Coordinate System](./docs/COORDINATE_SYSTEM.md)** - 3D coordinate system

---

## ✨ Features

### 3D Modeling
- Import STL/OBJ files
- Real-time 3D visualization
- Interactive model manipulation
- Mesh analysis and validation

### Automated Design
- **Support Generation** - Automatic overhang detection and support placement
- **Clamp Placement** - Intelligent clamping mechanism positioning
- **Base Plate** - Customizable fixture base generation
- **Mount Holes** - Precision mounting hole placement
- **Cavity Generation** - Negative space creation for fixtures

### Project Management
- Save and load projects
- Version history
- Cloud backup (optional)
- Project sharing
- Export to multiple formats

### Authentication & Security
- User registration and login
- Email verification
- Password reset
- JWT-based authentication
- Rate limiting
- Audit logging

---

## 🔐 Environment Variables

See [`backend/.env.example`](./backend/.env.example) for all required environment variables.

**Required:**
- `DATABASE_URL` - PostgreSQL connection string
- `JWT_ACCESS_SECRET` - JWT access token secret
- `JWT_REFRESH_SECRET` - JWT refresh token secret

**Optional:**
- Email service configuration (SMTP)
- Rate limiting settings
- Security settings

---

## 🧪 Testing

```bash
# Frontend tests
npm test

# Backend tests
cd backend
npm test

# API testing with Postman
# Import collection from docs/POSTMAN_API_COLLECTION.md
```

---

## 🚢 Deployment

### Docker
```bash
docker-compose up -d
```

### Manual Deployment
```bash
# Build frontend
npm run build

# Build backend
cd backend
npm run build

# Start production
npm start
```

See [`archive/DEPLOYMENT_READY_CHECKLIST.md`](./archive/DEPLOYMENT_READY_CHECKLIST.md) for detailed deployment instructions.

---

## 📄 License

Proprietary - See [PATENT_DOCUMENTATION.md](./PATENT_DOCUMENTATION.md) for IP information.

---

## 🤝 Contributing

This is a proprietary project. For questions or support, please contact the development team.

---

**Built with ❤️ by the RapidTool Team**
