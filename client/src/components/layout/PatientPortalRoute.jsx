import { Navigate, Outlet } from 'react-router-dom';
import { usePatientAuth } from '../../contexts/PatientPortalAuthContext.jsx';

/**
 * PatientPortalRoute — guards /portal/* routes.
 * Mirrors PrivateRoute but uses PatientPortalAuthContext.
 */
export default function PatientPortalRoute() {
  const { isAuthenticated, isLoading } = usePatientAuth();

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
    : <Navigate to="/portal/login" replace />;
}
