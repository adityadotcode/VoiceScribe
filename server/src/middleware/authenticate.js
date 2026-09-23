const { verifyAccessToken } = require('../services/authService');

/**
 * Authentication middleware — Phase 1A
 *
 * Reads the access token from:
 *   Authorization: Bearer <token>
 *
 * On success: attaches req.user = { id, email, role } and calls next().
 * On failure: returns HTTP 401 — never 403, to avoid leaking resource existence.
 *
 * Identity is taken EXCLUSIVELY from the verified JWT payload.
 * req.body, req.params, and req.query are NEVER trusted for identity.
 */
function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'] || '';

  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required.',
    });
  }

  const token = authHeader.slice(7).trim();

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required.',
    });
  }

  try {
    const payload = verifyAccessToken(token);

    // Attach verified identity — do NOT expose JWT internals.
    req.user = {
      id:    payload.sub,
      email: payload.email,
      role:  payload.role,
    };

    next();
  } catch {
    // jwt.verify throws for expired, invalid signature, malformed, etc.
    // All cases return the same 401 to avoid leaking token validation details.
    return res.status(401).json({
      success: false,
      message: 'Authentication required.',
    });
  }
}

module.exports = { authenticate };
