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
//
// Content Security Policy — production-ready, no unsafe-inline or unsafe-eval.
//
// Verified against the current production build (client/dist):
//   • index.html has zero inline <script> or <style> blocks — Vite externalises
//     everything to hashed asset files in /assets/.
//   • All JS and CSS are same-origin (/assets/*).
//   • No external CDN resources (no googleapis, fonts, cdn.*, etc.).
//   • blob: is required for AudioRecorder: URL.createObjectURL(audioBlob) creates
//     a blob: URL used as the <audio> playback src.
//   • jsPDF calls doc.save() which triggers a browser download via Blob internally.
//     It does NOT inject data: URLs into DOM image elements, so img-src 'self'
//     (no data:) is correct.
//   • No Web Workers, Service Workers, or SharedWorkers are used anywhere.
//   • upgradeInsecureRequests is intentionally omitted: behind a load balancer
//     the server may receive plain HTTP from the balancer; including this
//     directive can cause redirect loops. TLS termination is handled at the
//     CloudFront / ALB layer.
//
// The X-Frame-Options: SAMEORIGIN header is also set by helmet's default
// frameguard middleware. frame-ancestors 'none' in CSP supersedes it for
// browsers that understand CSP level 2+, so both are present for maximum
// compatibility.
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      ["'self'"],
      styleSrc:       ["'self'"],
      imgSrc:         ["'self'"],
      fontSrc:        ["'self'"],
      connectSrc:     ["'self'"],
      // blob: required for AudioRecorder audio playback
      // (URL.createObjectURL → <audio src="blob:...">)
      mediaSrc:       ["'self'", 'blob:'],
      objectSrc:      ["'none'"],
      baseUri:        ["'self'"],
      formAction:     ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
}));

// ── CORS ──────────────────────────────────────────────────────────────────
// credentials: true is required so the browser sends the HTTP-only refresh
// token cookie on cross-origin requests to /api/auth/refresh.
// The origin is a single exact string from CLIENT_ORIGIN — never a wildcard.
app.use(cors({ origin: clientOrigin, credentials: true }));

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
