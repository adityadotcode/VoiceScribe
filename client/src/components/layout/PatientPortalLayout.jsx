/**
 * PatientPortalLayout — Milestone 1 / Part B
 *
 * Shared layout for all authenticated patient portal pages.
 * Absorbs the auth-guard responsibility of PatientPortalRoute so that
 * App.jsx only needs one wrapper element for protected portal routes.
 *
 * Responsibilities:
 *   1. Auth guard: redirect unauthenticated users to /portal/login.
 *   2. Session-restore spinner while the refresh call is in-flight.
 *   3. Shared header: branding, "My records" nav link, patient display name,
 *      and a "Sign out" button that clears the session and navigates to login.
 *   4. Renders <Outlet /> for the matched child route (history, consultation).
 *
 * Pages that use this layout (via App.jsx Route nesting):
 *   /portal/history
 *   /portal/consultation/:id
 *
 * Pages that do NOT use this layout (standalone auth-shell):
 *   /portal/login
 *   /portal/register
 */

import { Link, Navigate, Outlet, useNavigate } from 'react-router-dom';
import { usePatientAuth } from '../../contexts/PatientPortalAuthContext.jsx';

export default function PatientPortalLayout() {
  const { account, isAuthenticated, isLoading, logout } = usePatientAuth();
  const navigate = useNavigate();

  // ── 1. Session-restore spinner ────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="auth-loading" role="status" aria-label="Restoring session…">
        <span className="auth-loading-spinner" aria-hidden="true" />
        <span className="auth-loading-text">Restoring session…</span>
      </div>
    );
  }

  // ── 2. Auth guard ─────────────────────────────────────────────────────
  if (!isAuthenticated) {
    return <Navigate to="/portal/login" replace />;
  }

  // ── 3. Logout handler ─────────────────────────────────────────────────
  async function handleLogout() {
    await logout();
    navigate('/portal/login', { replace: true });
  }

  // ── 4. Render layout + child route ────────────────────────────────────
  return (
    <div className="portal-page">
      <header className="portal-header" role="banner">
        {/* Brand */}
        <div className="portal-brand">
          <span className="app-logo-mark" aria-hidden="true">VS</span>
          <span className="portal-brand-name">VoiceScribe</span>
          <span className="portal-brand-sub" aria-hidden="true">Patient portal</span>
        </div>

        {/* Navigation */}
        <nav className="portal-nav" aria-label="Portal navigation">
          <Link to="/portal/history" className="portal-nav-link">
            My records
          </Link>
        </nav>

        {/* Account identity + logout */}
        <div className="portal-header-right">
          {account?.displayName && (
            <span className="portal-user-name" aria-label={`Signed in as ${account.displayName}`}>
              {account.displayName}
            </span>
          )}
          <button
            type="button"
            className="portal-logout-btn"
            onClick={handleLogout}
            aria-label="Sign out of patient portal"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Child page content */}
      <main className="portal-main">
        <Outlet />
      </main>
    </div>
  );
}
