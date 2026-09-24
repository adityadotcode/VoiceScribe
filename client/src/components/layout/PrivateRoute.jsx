import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext.jsx';

/**
 * PrivateRoute — wraps protected routes.
 *
 * While auth state is initialising (silent refresh in-flight):
 *   Render a minimal loading indicator. This prevents a redirect loop
 *   caused by the user appearing unauthenticated for the brief moment
 *   before the refresh result arrives.
 *
 * Once loaded:
 *   Authenticated   → render <Outlet /> (the child route)
 *   Unauthenticated → redirect to /login (replace so back-button works)
 *
 * NOTE: this component is a frontend convenience, not a security boundary.
 * The backend enforces authorization on every API request.
 */
export default function PrivateRoute() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="auth-loading" role="status" aria-label="Restoring session…">
        <span className="auth-loading-spinner" aria-hidden="true" />
        <span className="auth-loading-text">Restoring session…</span>
      </div>
    );
  }

  return isAuthenticated
    ? <Outlet />
    : <Navigate to="/login" replace />;
}
