const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { clientOrigin } = require('./config/env');
const apiRoutes = require('./routes');
const { errorHandler } = require('./middleware/errorHandler');

const app = express();

// ── Security headers ──────────────────────────────────────────────────────
// helmet sets a conservative set of HTTP security headers.
// contentSecurityPolicy is disabled here because the React SPA uses inline
// scripts injected by Vite; a proper CSP will be configured in Phase 7
// (security hardening) once the frontend build pipeline is finalised.
app.use(helmet({ contentSecurityPolicy: false }));

// ── CORS ──────────────────────────────────────────────────────────────────
app.use(cors({ origin: clientOrigin }));

// ── Body parsing ──────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));

// ── Cookie parsing ────────────────────────────────────────────────────────
// Required for Phase 1 authentication (HTTP-only refresh token cookie).
// No cookies are created or read in Phase 0 — this is purely preparation.
app.use(cookieParser());

// ── API routes (always active) ────────────────────────────────────────────
app.use('/api', apiRoutes);

// ── Serve React production build (production only) ────────────────────────
// In development the Vite dev server serves the frontend separately.
// On EC2 (NODE_ENV=production) Express serves client/dist and handles
// client-side routing by returning index.html for any non-API path.
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '../../client/dist');

  // Serve static assets (JS, CSS, images, etc.)
  app.use(express.static(distPath));

  // For any path that is not under /api, return index.html so that
  // React Router (if ever added) and direct URL navigation work correctly.
  // Express 5 requires a named wildcard parameter — '/{*path}' covers all paths.
  app.get('/{*path}', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

app.use(errorHandler);

module.exports = app;
